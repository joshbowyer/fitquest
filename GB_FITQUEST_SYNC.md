# Gadgetbridge → FitQuest Auto-Sync

> **Audience**: future-me (or anyone) post-compaction, picking this back up cold.
> The goal of this doc is: zero additional research required to start the
> GB-side implementation. Read the doc, follow the file map, copy the
> HealthConnect patterns, ship the PR.

---

## 0. Status (as of this doc's date)

- **PR #6332 in upstream Codeberg `Freeyourgadget/Gadgetbridge`**:
  "FitQuest: integrate as a third 'Online fitness tracker' option".
  - Mirrors the Endurain PR (#5809) — manual upload of workout FITs
    from the workout details screen.
  - Uses `/import` (the existing FitQuest endpoint that already
    accepts every FIT kind: activity, sleep, hrv, monitor, metrics).
  - **Merged upstream? No — open as of this doc.** Awaiting
    `joshbullock` to finish his second-pass review + scream to
    get it merged. Re-check PR status before starting work.
- **`FitQuestBridge` APK at `/home/josh/claw-code/fitquest-bridge/`**:
  - The OTHER way FitQuest currently syncs from GB. Watches
    `GB/files/{mac}/{TYPE}/{YEAR}/*.fit` and POSTs each file to
    FitQuest's `/import`. **Bounded by what GB writes to the FIT
    files** — body battery is NOT in FIT for the Tactix 7 (and
    many other watches), so the bridge can't get it. That's the
    whole reason this design exists.
- **FitQuest server side is ready** for GB-native sync:
  - `POST /vitals` accepts batched JSON time-series data, upserts
    into `Measurement` keyed on `(userId, metric, recordedAt)`.
  - `GET /vitals?since=ISO` returns existing samples for cursor
    reconciliation.
  - Both routes ship in FitQuest v1.0.35 (next release after this
    doc lands).
- **The "auto-sync" feature is the missing piece**: a GB-side
  service that polls GB's local DB and POSTs the time-series
  health data to FitQuest's `/vitals`. This is the body of this
  doc.

---

## 1. The problem in one paragraph

GB has device-side data (steps, HR, sleep stages, **body
battery**, SpO2, stress, respiration) in its local SQLite. Today
that data either sits in GB or is exported to `.fit` files. The
FitQuestBridge APK polls the FIT exports, but **the FIT format
excludes body battery** (Garmin's body battery lives in
non-FIT memory, and the FIT export doesn't carry it). To get
"everything GB has" into FitQuest, the sync must originate
**inside GB** where the full data model is available.

---

## 2. The architecture in one diagram

```
Gadgetbridge app
└── GB local SQLite
    ├── ActivitySample (per-minute steps/HR/distance/calories)
    ├── BodyEnergySample (body battery 0-100)        ← NEW: this is the win
    ├── StressSample (0-100, per-15min typically)
    ├── HrvSummarySample, HrvValueSample
    ├── SleepStageSample, SleepScoreSample
    ├── Spo2Sample
    ├── RespiratoryRateSample
    └── ... (Workout, etc.)

GB-side auto-sync (THIS PR — what this doc specifies):
    Tracker-agnostic syncer framework, modeled on
    `util/healthconnect/syncers/AbstractTimeSampleSyncer`
    ↓
    FitQuestApiClient.uploadVitals(kind, samples) → POST /vitals
    ↓
FitQuest server
    /vitals route → upsert into Measurement (idempotent)
    → morning report, body-comp insights, dashboard widgets

Endurain (future): same framework, different tracker impl.
Wanderer (future): same, GPX-only.
```

---

## 3. The template: HealthConnect's sync framework

The pattern is already proven in GB. Copy it.

### 3.1 Files to study (all in `/home/josh/claw-code/Gadgetbridge/`)

```
app/src/main/java/.../util/healthconnect/
  HealthConnectSyncWorker.kt            (the WorkManager job)
  HealthConnectClientProvider.kt
  HealthConnectPermissionManager.kt
  HealthConnectUtils.kt

app/src/main/java/.../util/healthconnect/syncers/
  HealthConnectSyncer.kt                (the interface)
  AbstractTimeSampleSyncer.kt           (the base class — KEY FILE)
  StepsSyncer.kt                        (per-metric concrete impl)
  HeartRateSync.kt
  HrvSyncer.kt
  SleepSyncer.kt
  Spo2Syncer.kt
  ActiveCaloriesSyncer.kt
  RespiratoryRateSyncer.kt
  RestingHeartRateSyncer.kt
  WeightSyncer.kt
  TemperatureSyncer.kt
  BloodGlucoseSyncer.kt
  Vo2MaxSyncer.kt
  RecordedWorkoutSyncer.kt
  DistanceSyncer.kt

app/src/main/java/.../activities/preferences/
  HealthConnectPreferencesLogic.kt      (UI: permissions, when to sync)

app/src/main/java/.../activities/HealthConnectResetDialogFragment.kt
app/src/main/java/.../activities/debug/HealthConnectDebugFragment.kt
```

### 3.2 The HealthConnect syncer pattern (mental model)

```
sealed interface HealthConnectSyncer {
  suspend fun sync(
    healthConnectClient: HealthConnectClient,    // destination
    gbDevice: GBDevice,
    metadata: Metadata,
    offset: ZoneId,
    sliceStartBoundary: Instant,                  // since-cursor
    sliceEndBoundary: Instant,                    // now
    grantedPermissions: Set<String>,
  ): SyncerStatistics
}

abstract class AbstractTimeSampleSyncer<TSample : TimeSample, TRecord : Record>
    : HealthConnectSyncer {
  // Subclasses provide:
  //   recordClass: KClass<TRecord>
  //   getSampleProvider(gbDevice, dao): TimeSampleProvider<out TSample>?
  //   convertSample(sample, offset, metadata, deviceName, version): TRecord?
  //
  // The base class handles:
  //   - permission check (HealthConnect-style — FitQuest has none)
  //   - fetching the GB-side samples between [sliceStart, sliceEnd]
  //   - calling convertSample() to map GB row → external record
  //   - skip-out-of-range (logged, not errored)
  //   - returning SyncerStatistics { recordsSynced, recordsSkipped, ... }
}

object StepsSyncer : AbstractActivitySampleSyncer<StepsRecord>() {
  override val recordClass = StepsRecord::class
  override fun convertSample(s, offset, metadata, deviceName, version) =
    StepsRecord(...) if s.steps > 0 else null
}
```

`AbstractTimeSampleSyncer` is a **`abstract class with two
type parameters`** because of JVM type erasure — generic info
isn't available at runtime, so the subclass has to provide a
`KClass<TRecord>` alongside the `TSample` generic.

---

## 4. The plan: copy the HealthConnect pattern for FitQuest

### 4.1 New file layout in GB

```
app/src/main/java/.../activities/onlinefitness/      (NEW PACKAGE)
  OnlineFitnessTracker.kt            (interface — the destination abstraction)
  FitQuestTracker.kt                  (impl — wraps FitQuestApiClient)
  EndurainTracker.kt                  (impl — wraps EndurainApiClient)  [optional / future]
  WandererTracker.kt                  (impl — GPX-only)                  [optional / future]
  TrackerRegistry.kt                  (singleton — "what's the user configured?")

  syncers/
    AbstractVitalsSampleSyncer.kt    (the base class — KEY FILE, mirror of AbstractTimeSampleSyncer)
    StepsFitQuestSyncer.kt
    HeartRateFitQuestSyncer.kt
    StressFitQuestSyncer.kt
    HrvSummaryFitQuestSyncer.kt
    HrvValueFitQuestSyncer.kt
    BodyEnergyFitQuestSyncer.kt      ← the new win
    SleepStageFitQuestSyncer.kt
    SleepScoreFitQuestSyncer.kt
    Spo2FitQuestSyncer.kt
    RespirationRateFitQuestSyncer.kt
    RestingHeartRateFitQuestSyncer.kt
    WeightFitQuestSyncer.kt

  sync/
    VitalsSyncWorker.kt              (WorkManager job, parallel of HealthConnectSyncWorker)
    VitalsSyncScheduler.kt           (schedules / cancels the worker)
    VitalsSyncCursorStore.kt         (per-user, per-metric, per-tracker cursor)
```

That's 4 shared + 11 metric syncers = 15 new files. The shared
bits are written once; per-metric concrete syncers are tiny
(5-15 lines each).

### 4.2 The shared interface

```kotlin
// activities/onlinefitness/OnlineFitnessTracker.kt
internal interface OnlineFitnessTracker {
    val key: String                  // "fitquest" / "endurain" / ...
    val displayName: String

    fun tokenManager(): OnlineFitnessTokenManager

    /// Push a batch of vitals samples. Returns Success (with
    /// the latest timestamp ingested) or NotLoggedIn /
    /// NotConfigured (no retry without user action).
    suspend fun pushVitals(
        kind: String,
        unit: String,
        samples: List<SamplePoint>,   // [(timestamp, value)]
    ): PushResult
}

internal data class SamplePoint(
    val ts: java.time.Instant,
    val value: Double,
)

internal sealed class PushResult {
    data class Success(val advancedTo: java.time.Instant) : PushResult()
    data object NotLoggedIn : PushResult()
    data object NotConfigured : PushResult()
    data class Failed(val message: String) : PushResult()
}
```

### 4.3 The concrete FitQuest tracker

```kotlin
// activities/onlinefitness/FitQuestTracker.kt
internal class FitQuestTracker(ctx: Context) : OnlineFitnessTracker {
    override val key = "fitquest"
    override val displayName = "FitQuest"
    private val tm = FitQuestTokenManager(ctx)
    override fun tokenManager() = tm as OnlineFitnessTokenManager

    override suspend fun pushVitals(
        kind: String, unit: String, samples: List<SamplePoint>
    ): PushResult = withContext(Dispatchers.IO) {
        val cookie = tm.getSessionCookie() ?: return@withContext NotLoggedIn
        val server = tm.getServerUrl() ?: return@withContext NotConfigured
        val body = JSONObject().apply {
            put("kind", kind); put("unit", unit); put("source", "gadgetbridge")
            put("samples", JSONArray(samples.map {
                JSONObject().put("ts", it.ts.toString()).put("value", it.value)
            }))
        }.toString()
        val req = Request.Builder()
            .url("$server/vitals")
            .addHeader("Cookie", "fitquest_session=$cookie")
            .addHeader("Content-Type", "application/json")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        OkHttpClient().newCall(req).execute().use { res ->
            when {
                res.isSuccessful -> Success(Instant.now())  // approximate
                res.code == 401 -> NotLoggedIn
                else -> Failed(res.body?.string()?.take(200) ?: "HTTP ${res.code}")
            }
        }
    }
}
```

### 4.4 The abstract syncer (mirror of HealthConnect's)

```kotlin
// activities/onlinefitness/syncers/AbstractVitalsSampleSyncer.kt
internal abstract class AbstractVitalsSampleSyncer<TSample : TimeSample> {
    protected abstract val logger: Logger
    protected abstract val metricName: String       // "STEPS", "HRV", ...
    protected abstract val metricUnit: String       // "/100", "bpm", "ms", ...

    protected abstract fun getSampleProvider(
        gbDevice: GBDevice, dao: DaoSession,
    ): TimeSampleProvider<out TSample>?

    /** Skip out-of-range, return null to drop. */
    protected open fun convertSample(sample: TSample): SamplePoint? {
        val v = extractValue(sample) ?: return null
        return SamplePoint(Instant.ofEpochMilli(sample.timestamp), v)
    }
    protected abstract fun extractValue(sample: TSample): Double?

    /**
     * Reads samples from GB DB since `cursor`, POSTs to whichever
     * tracker is configured, advances the cursor on success.
     */
    suspend fun runOnce(
        ctx: Context, gbDevice: GBDevice, cursor: Instant,
    ): Instant? {
        val tracker = TrackerRegistry.getConfigured(ctx) ?: return null
        val batch = GBApplication.acquireDbReadOnly().use { db ->
            val provider = getSampleProvider(gbDevice, db.daoSession) ?: return null
            provider.getAllSamples(cursor.toEpochMilli(), Instant.now().toEpochMilli())
        }.mapNotNull(::convertSample)
        if (batch.isEmpty()) return cursor
        val r = tracker.pushVitals(metricName, metricUnit, batch)
        if (r is PushResult.Success) {
            VitalsSyncCursorStore.advance(ctx, tracker.key, metricName, batch.last().ts)
            return batch.last().ts
        }
        // Don't advance cursor on failure — we'll retry next time.
        logger.warn("Vitals sync failed for $metricName on ${tracker.key}: $r")
        return null
    }
}
```

### 4.5 The concrete syncers (the 11 small files)

Each is 5-15 lines. Example:

```kotlin
// activities/onlinefitness/syncers/StepsFitQuestSyncer.kt
internal object StepsFitQuestSyncer : AbstractVitalsSampleSyncer<ActivitySample>() {
    override val logger = LoggerFactory.getLogger(StepsFitQuestSyncer::class.java)
    override val metricName = "STEPS"
    override val metricUnit = ""
    override fun getSampleProvider(gbDevice, dao) = gbDevice.deviceCoordinator
        .getActivitySampleProvider(gbDevice, dao)
    override fun extractValue(sample: ActivitySample) = sample.steps.toDouble()
}
```

That's it. Same shape for every other metric — just swap the
provider, name, unit, and value extraction.

The killer one for the user:
```kotlin
internal object BodyEnergyFitQuestSyncer : AbstractVitalsSampleSyncer<BodyEnergySample>() {
    override val metricName = "BODY_BATTERY"
    override val metricUnit = "/100"
    override fun getSampleProvider(gbDevice, dao) = gbDevice.deviceCoordinator
        .getBodyEnergySampleProvider(gbDevice, dao)
    override fun extractValue(sample: BodyEnergySample) = sample.energy.toDouble()
}
```

The Tactix 7 has body battery. GB sees it. With this syncer,
FitQuest sees it. Body battery lands in the morning report's
recovery score. **This is the whole reason this design exists.**

### 4.6 The orchestrator

```kotlin
// activities/onlinefitness/sync/VitalsSyncWorker.kt
class VitalsSyncWorker(
    ctx: Context, params: WorkerParameters,
) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val tracker = TrackerRegistry.getConfigured(ctx) ?: return Result.success()
        val gbDevice = GBApplication.app().gbDevice ?: return Result.success()
        val syncers = listOf(
            StepsFitQuestSyncer, HeartRateFitQuestSyncer,
            StressFitQuestSyncer, HrvSummaryFitQuestSyncer,
            HrvValueFitQuestSyncer, BodyEnergyFitQuestSyncer,
            SleepStageFitQuestSyncer, SleepScoreFitQuestSyncer,
            Spo2FitQuestSyncer, RespirationRateFitQuestSyncer,
            RestingHeartRateFitQuestSyncer, WeightFitQuestSyncer,
        )
        for (syncer in syncers) {
            try {
                val cursor = VitalsSyncCursorStore.get(ctx, tracker.key, syncer.metricName)
                    ?: Instant.EPOCH  // first run: backfill everything
                syncer.runOnce(ctx, gbDevice, cursor)
            } catch (e: Exception) {
                logger.warn("Sync failed for ${syncer.metricName}: $e")
            }
        }
        return Result.success()
    }
}
```

### 4.7 The scheduler

```kotlin
// activities/onlinefitness/sync/VitalsSyncScheduler.kt
object VitalsSyncScheduler {
    const val WORK_NAME = "fitquest-vitals-sync"
    fun schedule(ctx: Context) {
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
            WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<VitalsSyncWorker>(
                3, TimeUnit.HOURS,                 // tune later
            ).setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            ).build(),
        )
    }
    fun cancel(ctx: Context) =
        WorkManager.getInstance(ctx).cancelUniqueWork(WORK_NAME)
}
```

### 4.8 The cursor store

```kotlin
internal object VitalsSyncCursorStore {
    fun get(ctx: Context, tracker: String, metric: String): Instant? {
        val v = prefs(ctx).getLong("cursor.$tracker.$metric", 0L)
        return if (v == 0L) null else Instant.ofEpochMilli(v)
    }
    fun advance(ctx: Context, tracker: String, metric: String, to: Instant) {
        prefs(ctx).edit().putLong("cursor.$tracker.$metric", to.toEpochMilli()).apply()
    }
    private fun prefs(ctx: Context) = ctx.getSharedPreferences(
        "gadgetbridge-onlinefitness-sync", Context.MODE_PRIVATE
    )
}
```

### 4.9 Integration with PR #6332

The existing manual-upload flow in
`WorkoutDetailsFragment.kt` stays **as-is** — it's a fallback
path for users who don't want background sync. The new code
adds background sync on top.

Both share the same `FitQuestApiClient` and `FitQuestTokenManager`
— no duplication. `FitQuestApiClient` gets one new method:

```kotlin
suspend fun uploadVitals(
    kind: String, unit: String, samples: List<SamplePoint>,
): PushResult
```

The auto-sync triggers:

| Event | Action |
|---|---|
| User logs in to FitQuest (via `FitQuestSetupBottomSheet`) | Call `VitalsSyncScheduler.schedule(ctx)` |
| User logs out | Call `VitalsSyncScheduler.cancel(ctx)` |
| Periodic 3h interval | WorkManager fires `VitalsSyncWorker` |
| Device finishes syncing (Activity sync / Sleep sync done) | One-shot `OneTimeWorkRequest` to fire `VitalsSyncWorker` immediately |
| User clicks "Sync now" in prefs | Same one-shot work request |

The "device finishes syncing" hook is the most useful — it
pushes new data the moment GB finishes syncing from the watch,
not on a 3h timer. Find the existing hook in
`ServiceDeviceSupport.onFindDeviceLost` / `onDeviceConnect` or
similar (search for existing auto-sync triggers in GB).

---

## 5. Server side: what FitQuest already has

`/vitals` is already implemented in `api/src/routes/vitals.ts` (next
release). The contract:

```
POST /vitals
Cookie: fitquest_session=...
Content-Type: application/json

{
  "kind": "STEPS",                      // or any MetricType value
  "unit": "",                           // optional, "" if not applicable
  "source": "gadgetbridge",             // optional, recorded in notes
  "samples": [
    { "ts": "2026-04-06T15:00:00.000Z", "value": 1234 },
    ...
  ]
}

→ 200 { "kind": "STEPS", "received": 100, "created": 95, "updated": 5 }
```

Known metric kinds (validated server-side, returns 400 unknown_metric
if not in this list):

```
BODY_BATTERY, STEPS, HEART_RATE, SLEEP_HOURS, SLEEP_QUALITY,
SLEEP_ONSET, STRESS, HRV, SPO2, RESPIRATION_RATE, RESTING_HR,
WEIGHT, BODY_FAT_PCT, NECK, SHOULDER, CHEST, CALF, FOREARM,
QUAD, MOOD, ENERGY, SORENESS, WATER_ML, CAFFEINE, ALCOHOL,
NICOTINE, ELECTROLYTE, NECK_CIRC, HEIGHT, BMI, LEAN_MASS,
BODY_WATER, VO2_MAX, DEAD_HANG, L_SIT, PLANK, DEADLIFT_1RM,
BENCH_1RM, SQUAT_1RM, OHP_1RM, ONE_MILE_TIME, FIVE_K_TIME
```

`GET /vitals?since=ISO&kind=...&limit=...` returns existing
samples for cursor reconciliation. Default window is the last
7 days. Up to 1000 samples per POST.

`POST /vitals` is idempotent — re-sending the same `(userId, kind,
ts)` is a no-op when the value is unchanged, otherwise it updates
the row. This is the safety net for the GB client's "I crashed
mid-sync, let me retry" case.

---

## 6. Endurain: a free side-effect

The same framework supports Endurain, Wanderer, FitTrackee with
~50 lines of tracker-impl per service. The whole point of
making `OnlineFitnessTracker` an **interface** (not a FitQuest-
specific class) is that the syncer code is reusable.

For the first PR, **only ship FitQuest**. Add Endurain later as
a 50-line follow-up:

```kotlin
internal class EndurainTracker(ctx: Context) : OnlineFitnessTracker {
    override val key = "endurain"
    override val displayName = "Endurain"
    private val tm = EndurainTokenManager(ctx)
    override fun tokenManager() = tm
    override suspend fun pushVitals(kind, unit, samples): PushResult { /* ... */ }
}
```

PR scope discipline: only FitQuest. Endurain PR is a copy of
this one with the tracker impl swapped.

---

## 7. PR strategy (3 phases)

### PR 1: server side only (no GB work)
Ship `/vitals` + GET /vitals + tests. Server-only PR. ~half a day.

**Status**: ✅ already done (in `api/src/routes/vitals.ts` + migration).
Ships in the next FitQuest release.

### PR 2: GB-side framework with one concrete syncer
Ship:
- `activities/onlinefitness/` package skeleton
- `OnlineFitnessTracker` interface
- `TrackerRegistry` (single tracker for now)
- `AbstractVitalsSampleSyncer` (the framework)
- `StepsFitQuestSyncer` (one concrete impl to prove the pattern)
- `VitalsSyncWorker` + `VitalsSyncScheduler` + `VitalsSyncCursorStore`
- `FitQuestTracker` (the only tracker impl)
- Update `WorkoutDetailsFragment` to invoke the scheduler on login
- Update `OnlineFitnessTrackersPreferencesActivity` to add a "Sync now" button

Tests:
- Unit tests for `AbstractVitalsSampleSyncer` (mock the GB DB)
- Unit tests for the cursor store (SharedPreferences)

Mirror the test patterns in `HealthConnectSyncerTest.kt`. ~2-3 days.

### PR 3: the remaining 10 syncers
Add the rest of the metric syncers. Each is 5-15 lines. ~1 day.

After PR 3 ships, **body battery** is the headline new feature —
it's been the data source everyone's been asking for since the
Tactix 7 launched and the bridge couldn't get it.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| GB's sample-provider API varies by device | Each `getSampleProvider` returns `TimeSampleProvider?` — null means unsupported. The framework handles null cleanly (returns "no data" silently). |
| WorkManager tasks get killed on device reboot | Standard WorkManager behavior. WorkManager re-schedules periodic work; cursors are in SharedPreferences (persistent). |
| User clears GB app data → cursors lost | Re-backfills on next run (first run uses `Instant.EPOCH` as cursor = backfill everything). The dedup index on Measurement prevents duplicates. |
| 1000-sample cap on /vitals batches | Worker splits larger queries into 1000-sample chunks before POST. |
| Same value posted twice | Server skips (the `existing.value === sample.value` short-circuit). No churn. |
| Different tracker for the same metric (e.g. Endurain tracks body battery differently) | The cursor is keyed on `(tracker, metric)`, so per-tracker cursors are independent. |
| Sync runs while user is in the middle of typing in a different app | WorkManager job runs in a background process. No user interaction. |
| Server returns 401 (session expired) | PushResult.NotLoggedIn → don't advance cursor, surface in next sync attempt's log. After 3 consecutive failures, could escalate to a user notification. |
| Data deluge (10k STEPS rows) | Cursor-based incremental sync handles this — the first run backfills, subsequent runs only send new data. Per-batch 1000 sample cap prevents request size blowup. |

---

## 9. Test patterns to copy

From `HealthConnectSyncerTest.kt`:

```kotlin
class StepsSyncerTest {
    private lateinit var provider: TimeSampleProvider<ActivitySample>
    private val samples = listOf(
        ActivitySample(timestamp = 1000L, steps = 100, ...),
        ActivitySample(timestamp = 2000L, steps = 200, ...),
    )
    @Before fun setUp() {
        provider = mock { on { getAllSamples(any(), any()) } doReturn samples }
    }
    @Test fun `converts each sample to a record`() { ... }
    @Test fun `skips zero-step samples`() { ... }
    @Test fun `survives provider returning null`() { ... }
}
```

Mirror this for `StepsFitQuestSyncerTest`, `BodyEnergyFitQuestSyncerTest`, etc.

For the cursor store: in-memory `SharedPreferences` via
`RuntimeEnvironment.getApplication().getSharedPreferences(...)`
(Robolectric — already in GB's dev deps).

For the worker: test the syncer's `runOnce` directly with a mocked
DB and tracker, verify the push and cursor advance happen as
expected.

---

## 10. Files to read in GB before writing any code

Order matters — read the HealthConnect pattern first, then mirror.

1. `HealthConnectSyncer.kt` — the interface (1 page)
2. `AbstractTimeSampleSyncer.kt` — the base class (3 pages, key file)
3. `StepsSyncer.kt` — the simplest concrete impl (1 page)
4. `HealthConnectSyncWorker.kt` — the orchestrator (1 page)
5. `HealthConnectPreferencesLogic.kt` — how GB's own preferences trigger sync
6. `HealthConnectInitialSyncDialog.kt` — the initial-grant dialog
7. `AbstractBLClassicDeviceCoordinator.kt` (skim) — how GB wires device-level events
8. `EndurainApiClient.kt` and `WandererApiClient.kt` (in `endurain/`) — see the existing tracker shape so the new `OnlineFitnessTracker` interface matches expectations

Also read for context:
- `OnlineFitnessTrackersPreferencesActivity.kt` — where the new "Sync now" button plugs in
- `WorkoutDetailsFragment.kt` — where the login-driven scheduler call goes
- `FitQuestTokenManager.kt` — the existing session-storage abstraction that `FitQuestTracker` wraps
- `FitQuestApiClient.kt` — the existing HTTP client; extend with `uploadVitals` rather than writing a separate class

---

## 11. Definition of done

The auto-sync feature is done when:

- [x] `/vitals` server route ships (PR 1)
- [x] `/vitals` GET endpoint for cursor reconciliation ships (PR 1)
- [ ] GB-side framework + first syncer (Steps) ships (PR 2)
- [ ] All 11 metric syncers ship (PR 3)
- [ ] Body battery appears in the morning report for a Tactix 7 user after one sync cycle
- [ ] PR for GB upstream merged

When this list is fully checked, the design's promise is fulfilled:
**every metric GB has access to lands in FitQuest, with body
battery as the headline new feature.**

---

## 12. One-paragraph summary for the PR description

> Implements an auto-sync background worker in Gadgetbridge that
> mirrors the existing HealthConnect sync architecture. Reads each
> supported time-series metric (steps, heart rate, stress, HRV,
> body battery, sleep stages, SpO2, respiration, etc.) from GB's
> local SQLite, batches them per metric, and POSTs them to
> FitQuest's `/vitals` endpoint. Cursor-based incremental sync
> (per-metric, per-user, per-tracker) so re-runs only send new
> data. The framework is tracker-agnostic; this PR ships a
> FitQuest implementation but the same code supports Endurain,
> Wanderer, FitTrackee with ~50 lines of tracker-impl each.
> The headline new feature is **body battery**: Garmin watches
> write it to non-FIT memory, so the existing FitQuestBridge
> APK (which only handles FIT exports) can't get it — this
> GB-native sync closes that gap.