# FitQuest Roadmap

> Audited against the actual codebase — every "done" item has
> working code reachable via a URL. "Outstanding" items are sized
> + scoped for the next session.

## Operations

- **Run `npx prisma migrate deploy` after every pull.** The api
  Dockerfile runs it on container startup, but **`npm run dev` does
  not** — devs running `tsx watch` locally need to run it manually
  after pulling new code. The `20260701090000_measurement_unique_user_metric_date`
  migration can fail on existing installs that accumulated duplicate
  Measurement rows from old FIT re-imports; if it does, run the
  dedup query in the migration's comment and then
  `npx prisma migrate resolve --applied 20260701090000_measurement_unique_user_metric_date`.


## Active (in progress)

- **Forecast page (`/forecast`).** New page that answers two
  questions in one glance: "should I train outside today?" and
  "what should I work?"
  - **Weather:** Open-Meteo (free, no API key) for current
    conditions + 3-day daily forecast. Cache keyed by rounded
    lat/lng (same scheme as `GeoCache`) with a 1-hour TTL —
    matches Open-Meteo's own update cadence and keeps the call
    count well under the 10k/day free-tier ceiling for a single
    user. WMO weather code → short label + icon glyph + an
    outdoor-friendliness verdict per day (no-go: thunderstorms /
    snow / >5mm rain / >100°F / sustained 30+ mph winds; caution
    bands for >90°F or <32°F).
  - **Readiness:** existing `computeRecovery(userId)` —
    HRV/sleep/RHR/soreness/stress/energy/mood composite score
    with 7-day trend, same data the `/recovery` page shows.
  - **Recommendation:** new `recommendMuscle(userId)` helper
    picks the highest-scoring body part that hasn't been worked
    in the last 12 h. Extracted the per-part recovery math
    out of `routes/status.ts` into a new
    `api/src/lib/recommendMuscle.ts` so the same numbers drive
    both the avatar on `/status` and this recommendation.
  - **Location:** new `User.latitude` / `User.longitude` Float?
    columns. Explicit setting wins; otherwise the route falls
    back to the most-recent workout's trackJson centroid via
    the existing `centroidOfTrack()` helper in `api/src/lib/geo.ts`.
    422 with `needsLocation: true` when neither source has data
    — the page renders an actionable empty state pointing at
    Profile.
  - **Profile UI:** new "Home location (for /forecast)" panel
    on Profile with manual lat/lng inputs, a "Use device
    location" button (`navigator.geolocation.getCurrentPosition`),
    and a "Clear (use workout GPS)" affordance. Saves with the
    main profile-save button + invalidates `['forecast']`.
  - **Nav:** added to the desktop sidebar + mobile overlay via
    the existing `NAV` array in `web/src/components/Layout.tsx`
    with `icon: '☀'`, `mobile: true` so it's a top-level
    primary nav item.
  - **Migration:** `20260702140000_user_forecast_location` adds
    the two lat/lng columns + a new `WeatherCache` table
    (mirrors the `GeoCache` pattern: `key` = round3 lat/lng,
    `payload` JSON, `fetchedAt`). Also resolved two
    previously-failed migrations (`drop_soulstone_counter` and
    `workout_unique_per_user_time`) — the dev DB had 151
    duplicate Workout rows from the earlier FitQuestBridge
    re-upload flood; the dedup pass cleared them and the unique
    constraint now installs cleanly.
  - **Air quality (added in the same iteration):** new
    `getWeatherBundle()` in `api/src/lib/forecast.ts` fetches
    the forecast + the air-quality endpoint
    (`https://air-quality-api.open-meteo.com/v1/air-quality`)
    in parallel and stores both in the same `WeatherCache` row.
    Open-Meteo's AQ endpoint only exposes hourly data, so the
    server aggregates daily peaks (max pm2_5 / pm10 / US AQI
    per local day) and surfaces them alongside the current
    nowcast. The page renders a third card with the headline
    AQI number, the EPA band ("Good" / "Moderate" / "Unhealthy
    for sensitive groups" / etc.), the PM2.5/PM10 μg/m³ values,
    and a 3-day peak-per-day strip so the user can plan around
    wildfire smoke, ozone, etc. No pollen (per user preference).
    No new API key — same Open-Meteo provider.
  - **Geocoding search (added in the same iteration):** new
    `GET /geocode?q=<city or postal>` proxy around
    Open-Meteo's free `geocoding-api.open-meteo.com/v1/search`
    endpoint. Profile's home-location panel now has a search
    input — type "Kennesaw" or "30144", pick a result, the
    lat/lng inputs auto-fill. The picker is explicit-save
    (matches the rest of Profile: no surprise writes). The
    same panel also surfaces "View on map ↗" (opens OSM with
    the current draft coords as a crosshair) and the existing
    "Use device location" / "Clear" buttons. The Profile save
    flow was rewritten so the location panel has its own Save
    button instead of relying on the Frame panel's save button
    (which was far above and visually disconnected — the
    previous "Saves with the main profile save button below"
    hint was misleading because there was no obvious "main"
    button on the page).
  - **Empty state copy cleanup:** the bottom "Tip" Panel that
    said "see above" was removed; the in-page empty state now
    self-contains the Profile link. The workout-GPS fallback
    hint is a small grey one-liner below the cards (only shown
    when the user is actually on the workout-GPS fallback),
    not a Panel.

## Backlog (from user notes, in priority order)

(was: dashboard radials + HomeBase shield — both shipped in
commit f1f940c. New users see all four body-comp gauges
populate from the User.* fields as a fallback when no
Measurement row exists, and HomeBase's `firePenance` is now
idempotent + bypasses SP for activity-driven unlocks. The
morning popup also now shows weight in the user's units —
imperial users see lb, not kg — shipped in 2388dd9.)

### Polish

- **Medical metrics UI.** Surface existing RHR / sleep / stress
  for medical history. Schema has the data but no medical-themed
  UI (no "history of resting HR" chart, no BP log form, etc).
- **Personal records page** — all PRs in one view with charts
  over time. Currently /prs/WorkoutDetail shows individual PRs
  but no aggregated "all my PRs over time" view.
- **Mobile polish** (small wins) — long-press to multi-select on
  history, pull-to-refresh on Dashboard, haptic feedback on rest
  timer completion.
- **3D avatar polish** — animations on level completion. The
  recently-worked indicator already brightens recently-trained
  parts (static, not animated) so the user can see at a glance
  what was worked; the level-up animation already fires via
  RewardOverlay. What's left is making the level-up animation
  more cinematic and a stronger workout-logged effect.

### Identity / auth

(was: admin reset-items button — shipped in commit 4c18a0f.
Admin → Inventory panel has a typed-confirm 'Wipe ALL items'
button + per-user 'Wipe items' buttons. 5 unit tests cover the
scopes + the equip-state-wiped-with-row assertion.)

## Stretch / Future

- **AI HUD agent** — Cortana-style assistant that knows your
  data and can answer questions ("how did I sleep this week?").
  Could be an LLM-powered insights panel that calls into the
  same APIs the dashboard does.
- **Gadgetbridge live push/pull** — uploads land via the
  FitQuestBridge helper APK (vanilla Gadgetbridge + SAF-granted
  export dir + bridge APK watching the dir). The PR for
  upstream Gadgetbridge is no longer blocking. Next step: add
  a "rebuild & install" reminder to the bridge's notification
  when GB's API changes (rare).
- **Nutrition tracker enhancements** — barcode lookup,
  restaurant menu scan, etc. The base tracker is live (AI
  estimated macros from free-text descriptions).
- **Native Android app** — wrap the web app (or build native)
  for scheduled toast notifications / reminders for workouts,
  weigh-ins, recovery, examen, etc. Web push can do some of
  this but native has reliable scheduled local notifications,
  background sync, and homescreen widgets. Use Capacitor /
  TWA / RN / native — pick after scoping.
- **Sound / audio system** — SFX for level-up, raid damage,
  rest-timer done, workout logged, boss defeat, leak spawn.
  Currently silent. Needs an audio service (howler.js / web
  audio API), mute toggle in user prefs, and per-event hooks
  fired from the existing event system.
- **3D avatar / STATUS hologram polish.**

## Recently Fixed / Resolved

- ✅ Mismatched workouts now *damage* the boss instead of healing
  it. `BASE_MISMATCHED_HEAL` → `BASE_MISMATCHED_DAMAGE` (15 → 6) in
  `api/src/lib/breach.ts`. The previous "any non-matching workout
  feeds the boss 15 HP" behavior punished casual users and made the
  boss feel invincible when life got in the way of the prescribed
  split. Now any logged workout — matched, bonus, or mismatched —
  chips away at the boss. Mismatched still deals the least (6 vs
  60 matched / 95 matched+bonus), so matching the prescribed tags
  is clearly the optimal play, but the user is never *punished* for
  showing up. The portal-leak path (`api/src/lib/portalLeaks.ts`
  `applyLeakDamage`) already delegates to `damageForMatch`, so the
  flip applies there too without further code changes. Tests in
  `breach.test.ts` updated for the new sign + constant name.
- ✅ Portal-leak damage now auto-applied on every workout
  commit. Previously only the AttackLeakModal in /portal-leak
  fired `applyLeakDamage` -- logging a matching workout via
  the regular /workouts page left the leak untouched, which
  was confusing. Now the `workouts.ts` POST handler runs
  `applyLeakDamage` inline (best-effort, try/catch -- a leak
  bug can't break the workout save). The same damage math
  applies: matched muscle tags deal positive damage, bonus
  tags stack, mismatched tags *feed* the leak (negative
  delta = HP increases). For a 1-shot encounter with the
  usual HP range of 80-200, the effective delta is clamped to
  [-12, +30] so even a marathon squat session can't insta-kill
  a leak and even a wildly-mismatched workout can't insta-overwhelm
  it (the overwhelm cap at 1.5x maxHp does the final brake).
- ✅ Workout POST handler switched from `create` to `upsert`
  on (userId, performedAt). The schema gained a
  `@@unique([userId, performedAt])` constraint (migration
  20260702120000_workout_unique_per_user_time) so re-uploads
  update the existing row in place instead of failing the
  create() with a 23505. The `update` block only touches the
  top-level scalar fields; the `create` block has the full
  nested exercise/set tree. End-to-end idempotent with the
  FitQuestBridge dedup set -- re-uploads no longer 500 in the
  server log.
- ✅ FitQuestBridge APK: 15-min poll + persistent dedup set +
  freshness window + periodic prune. Three new mechanisms
  collaborate to bound the upload surface:
  1. **Persistent known-paths set** in `Settings` (SharedPreferences
     StringSet, ~30KB at 1700 paths) — survives restarts so
     the bridge doesn't re-upload its history every time the
     service comes back up. Persisted on every batch of new
     uploads.
  2. **Freshness window** — `find -mmin -60` ignores any file
     older than 60 minutes. Safety net for the case where the
     persisted set ever gets out of sync (user clears app data,
     GB writes a new file with a path the bridge has never
     seen, etc.). 60 min is generous enough to catch any
     in-flight GB sync.
  3. **Periodic prune** every 10 polls (~2.5 h at 15-min
     cadence) — intersects the persisted set with the current
     dir contents and drops any entry that no longer exists.
     Bounds the persisted set's growth as files come and go.
  Together these mean the bridge does ~1 su call per 15 min
  in the steady state, sees no growth in persisted state, and
  never re-uploads historical data on restart. The unique
  constraint on `Workout(userId, performedAt)` (added in the
  workout-dedup migration) is the final backstop — even if a
  file IS re-uploaded somehow, the server rejects the
  duplicate.
- ✅ Mobile top-bar title overlap (Layout.tsx). The FIT//QUEST
  title was `absolute left-0 right-0 text-center` on mobile so
  the new 10-heart hero row in Dashboard.tsx overlapped with it
  on narrow viewports. Switched the title to a natural flex
  child (`shrink-0` next to the hamburger) so it sits flush
  right of the menu icon, left of center, instead of centered
  across the whole header. Desktop layout unchanged (hamburger
  hidden, title in the same left-edge position).
- ✅ FitQuestBridge helper APK + Bearer-token auth. New long-lived
  `DEVICE` session kind on `Session` table (1-year TTL, sha-stored
  token via standard Session.token column). New `readBearerToken` /
  `getDeviceSession` helpers in `api/src/lib/auth.ts`; `requireUser`
  now accepts `Authorization: Bearer <token>` AND falls back to
  cookie session (cookie is the source of truth for the web app,
  Bearer is for unattended clients — they don't share tokens).
  Endpoints:
  - `POST /auth/device-login` — username + password (+ optional
    TOTP code) → `{ token, expiresAt, user }`. Re-running deletes
    prior DEVICE sessions for the user (rotation).
  - `POST /auth/device-logout` — revokes the calling Bearer token.
  - `GET /auth/device-sessions` — lists active tokens (web UI
    surfaces in /settings so the user can revoke a lost phone).
  - `DELETE /auth/device-sessions/:id` — revoke one token.
  - `POST /auth/logout-everywhere` — now also wipes DEVICE sessions.
  Failed closed: a malformed Bearer rejects the request even if a
  valid cookie is also present, so a typo'd token never accidentally
  authenticates as the web user. 21 unit tests in
  `api/src/__tests__/deviceLogin.test.ts` (all pass).
  End-to-end smoke verified: real FIT upload via Bearer → 200, 2
  rows created in DB. The FitQuestBridge APK lives at
  `/home/josh/claw-code/FitQuestBridge/`, ~7MB debug APK. Setup
  flow: install APK → enter server URL + credentials (+ TOTP if
  2FA on) → pick the watch directory via SAF → tap Start → the
  bridge uploads new `.fit` files to `/import/batch` in the
  background. Works with vanilla Gadgetbridge: point GB's
  AutoExport FIT directory at the same SAF-granted directory the
  bridge watches.
- ✅ Negative weight values for bodyweight + band exercises.
  Set-weight schema in `api/src/routes/workouts.ts:100` was
  `z.number().min(0).max(2000)` — rejected band-assisted work
  (a 20kg band pulling up on a pull-up is roughly -20kg of
  effective load). Relaxed to `min(-500).max(2000)`; floor
  covers the heaviest commercial band stacks, ceiling still
  flags obvious typos. Frontend weight inputs in
  `LiveWorkoutLogger.tsx` (target + current), `WorkoutLogger.tsx`
  and `pages/Workouts.tsx` (bulk-mode) all bumped from
  `min={0}` to `min={-500}` and the placeholders now read
  `kg · − for band assist` (or `lb · − for band assist` for
  imperial users). Reps / duration / RPE inputs untouched.
- ✅ USCCB readings: stale UI message + diagnostic endpoint. The
  "No USCCB reading available right now" message was stale (didn't
  mention EWTN, which has been the primary source since the
  redesign). New `GET /spiritual/readings-status` endpoint probes
  each source independently (cache / EWTN / RSS / Wayback) and
  returns ok/error/empty per source with a reason string. New
  `POST /spiritual/readings-reseed?date=YYYY-MM-DD` endpoint
  force-refreshes the cascade and returns the new status. The
  SpiritualDirectorCard error path now:
  - updates the message to name all 4 sources in the cascade
  - adds a "Force reseed" button that hits the new endpoint +
    invalidates the director query
  - adds a "Diagnose" expandable chip that pulls the status
    endpoint and shows ✓/✗ per source with the failure reason.
- ✅ Morning popup modal (Habitica-style). Auto-shows once per day
  on /today (localStorage-dismissed per local-date). Shows heart
  counter animation (Hardcore only) that counts down from 5 to
  current value over 1.2s with ease-out cubic, the heart-loss
  reasons from yesterday (each of the 6 triggers), a 4-cell
  recap (workout/sleep/weigh-in/recovery, green or rose per
  floor), and a list of unchecked dailies with one-tap
  "mark done" buttons (idempotent — uses the existing
  /dailies/:id/complete endpoint). Backend: new
  `GET /dailies/morning-popup?date=YYYY-MM-DD` endpoint bundles
  the full payload. Tests in
  `api/src/__tests__/morningPopupPayload.test.ts` lock the
  response shape.
- ✅ Supersets in the live workout. New `groupIndex Int?` column
  on `WorkoutTemplateExercise` + `Exercise` (migration
  `20260703090000_superset_group_index`). Routines page got a
  "Pair with next" button and a neon-magenta pair label (1A/1B/2A
  ...). Live logger walks exercises round-robin via a new pure
  `buildRoundRobinOrder` helper (`web/src/lib/supersetRoundRobin.ts`),
  with 12 unit tests covering empty input, linear singletons,
  paired alternation, asymmetric set counts, 3-exercise groups,
  multi-pair ordering, mixed paired/un-paired, zero-set members,
  and singleton groupIndex. API extended to accept/persist
  `groupIndex` on both template and workout create paths;
  backwards-compatible (null = linear). Bulk logger shows the
  pair label as a visual indicator only (bulk mode doesn't walk
  in real-time).
- ✅ Live workout — 5 of 6 reported bugs fixed. `autoFocus` on the
  weight input removed (mobile keyboard no longer pops unprompted).
  "Finish workout" gets a belt-and-suspenders `disabled` guard on
  `createM.isPending` so double-taps can't re-fire the commit (the
  existing fix at commit `eff47ad` was likely just behind a stale
  docker image — pulling the new build should resolve the user-
  reported hang). Predefined routine prefill now gates on
  `selectedTemplateQ.isSuccess` so the logger doesn't mount with a
  stale `templatePrefill=null` snapshot. New `Workout.postNotes`
  column + rest-screen textarea on the final set for post-session
  reflection (bulk mode shows it inline). CapturedSet gains a
  `locked: boolean` field; the new history strip below the live
  entry lists every captured set with a per-row ✎ Edit / ✓ Lock
  toggle so accidental taps can't overwrite mid-workout. (6th bug,
  supersets, deferred — needs schema migration + state-machine
  rewrite.)
- ✅ Supersets in the live workout. New `groupIndex Int?` column
  on `WorkoutTemplateExercise` + `Exercise` (migration
  `20260703090000_superset_group_index`). Routines page got a
  "Pair with next" button and a neon-magenta pair label (1A/1B/2A
  ...). Live logger walks exercises round-robin via a new pure
  `buildRoundRobinOrder` helper (`web/src/lib/supersetRoundRobin.ts`),
  with 12 unit tests covering empty input, linear singletons,
  paired alternation, asymmetric set counts, 3-exercise groups,
  multi-pair ordering, mixed paired/un-paired, zero-set members,
  and singleton groupIndex. API extended to accept/persist
  `groupIndex` on both template and workout create paths;
  backwards-compatible (null = linear). Bulk logger shows the
  pair label as a visual indicator only (bulk mode doesn't walk
  in real-time).
- ✅ Tron identity disk scales to body measurements. New
  migration `20260705090000_body_measurements_for_avatar` adds
  `shoulderCm` + `waistCm` columns to User. Avatar.tsx now scales:
  - outer ring radius (shoulders, ±25%),
  - inner ring radius (waist, inverse — tighter waist = bigger gap),
  - figure X scale via V-taper (shoulder/waist ratio, ±35%),
  - figure Y scale (height, ±25%),
  - ring stroke width (broader builds = chunkier ring).
  Profile page exposes Shoulder width + Waist inputs. MES/AVG/END
  somatotype badge below the disc when measurements are present
  so the user can see the avatar is reading their build. Reference
  values 110cm shoulders / 80cm waist / 175cm height.
- ✅ Username case-insensitive login. New `User.usernameLower
  String @unique` column populated via `LOWER(username)`. Login
  route looks up by `usernameLower` so `LobsterWrangler`,
  `lobsterwrangler`, and `LOBSTERWRANGLER` all resolve to the same
  account. Display name (`username`) still preserves the case the
  user typed. Migration `20260704000000_username_lower` adds the
  column with a UNIQUE constraint that fails loudly if two existing
  users collide (e.g. "Bob" + "bob") so the operator can manually
  merge before re-running. Parties route invite-by-username also
  case-folds. `ensureDefaultAdmin` populates `usernameLower` for
  fresh installs.
- ✅ USCCB readings: EWTN is the new primary source (replaced
  USCCB's broken RSS feed). The api walks the cascade
  cache → EWTN → USCCB RSS → Wayback on every miss. New
  `GET /spiritual/readings-status` endpoint probes each source
  independently with a reason; `POST /spiritual/readings-reseed`
  force-refreshes. SpiritualDirectorCard now has a "Diagnose"
  chip that shows per-source ✓/✗ so the user can see which leg
  of the cascade is broken instead of staring at a generic
  "no reading" message.
- ✅ Hardcore-mode heart-loss system wired up. `loseHeart()`
  had zero callers until this commit. New
  `fireHardcoreHeartPenalties()` runs alongside
  `fireMissedAllDailiesPenance()` in the morning-report sweep.
  6 triggers, each can independently cost a heart on a given
  local day: MISSED_WORKOUT, MISSED_ALL_DAILIES,
  SUBSTANCE_CAFFEINE, SUBSTANCE_ALCOHOL, SUBSTANCE_NICOTINE,
  ZERO_SPIRITUAL. Nicotine cap added (2/week — most
  restrictive of the three). HeartLossEvent table +
  HeartLossTrigger enum + unique (userId, kind, sourceDate)
  index for natural idempotency. Tests in heartLoss.test.ts
  (11/11 pass).
- ✅ Sleep onset FIT parser. parseSleep now emits a
  SLEEP_ONSET Measurement row with the fractional-hour of
  the start event bucketed to local midnight of the
  night-of-sleep (post-midnight starts → previous calendar
  day so the chart's X-axis matches how the user thinks
  about it). parseFit now accepts an optional tz arg that
  threads through to the parser. /import/summary now
  includes recentSleepOnset in the response. Two new
  timezone helpers (hoursSinceLocalMidnightInTz,
  localNightStartInTz) hoisted into api/src/lib/timezone.ts
  so the parser and the correlation engines share one
  implementation. The original sleepOnsetDate.test.ts was
  vacuously passing (`if (!onset) continue;` skipped the
  assertions when no onset was found) and used a wrong
  function signature — rewritten with deterministic
  timezone-helper unit tests.
- ✅ Pain entries on Today (was: "persist silently on Status").
  New `PainCard` component surfaces the most-recent active pain
  log (intensity > 0) on Today with a 14-day "is it going down?"
  sparkline, a "Pain is gone" quick-action that posts
  intensity=0 for the same body part, and an Update button
  re-opening the log modal at the active part. Empty-state copy
  points users to the body map on /status for full logging.
- ✅ Recovery practices → Today (was: "should be on Today").
  Extracted the checklist + state + helpers into a new
  `RecoveryPracticesPanel` component, rendered on Today between
  the quick-action grid and the dailies/check-ins columns.
  State persists in localStorage (`fitquest:recovery:practiceLog`)
  so it stays in sync if the user navigates to /recovery too.
  Removed the block from /recovery; dropped the now-unused
  `completedPractices` PageHeader highlight check.
- ✅ Weekly Examen copy typo. "where was God in neither" →
  "where was God in all this" (Ignatian phrasing the user
  picked). Touches panel intro, both summary labels, and the
  modal field label. No DB / test changes.
- ✅ Body weight graph zoom (Insights). `yPad` 20 → 10 so the
  line shows more dynamism within the recorded range instead
  of being squashed to the bottom of the plot area.
- ✅ Status page Identity block weight from weigh-ins. Now
  prefers today's tz-aware weigh-in (`/measurements/weigh-in/
  status`, same endpoint WeighInPanel uses) and falls back to
  `user.weightKg` when no weigh-in has been logged today.
- ✅ Recent PRs block — rename + data source. Title "Recent
  PRs" → "Estimated 1RM peaks" (matches what the panel
  actually shows — the Epley estimate, not raw PR weight).
  Endpoint `/prs/best` (max ever per exercise) → `/prs`
  (chronological recent Pr rows). "Recent" now actually means
  recent instead of "max ever, in insertion order".
- ✅ Equipment drops / loot (world → loot table mapping). Added
  `classForWorld()` helper; Spire drops Juggernaut gear, Glade
  drops Phantom gear, Citadel drops Berserker gear, etc. NEUTRAL
  worlds (crossroads, nexus, breach) stay unfiltered. Wired into
  `maybeSpawnLeak` (uses most-recently-cleared world level),
  `maybeSpawnBreachLeak` (no filter), `claimKill` in Breach
  (filtered by `boss.classAffinity`, ANY = unfiltered), world
  boss defeat (filtered by URL `worldId`), and quest level
  first-clear (~25% drop chance themed by world). Uses existing
  `ItemDef.classRestriction` column — no schema migration needed.
  Tests in `worldLoot.test.ts` (10/10 pass).
- ✅ Genetic Max minimums audit. SHOULDER `defaultMin` 38cm →
  89cm (was displaying as 15in imperial — now ~35in floor,
  matches Casey Butt circumference semantic; web/types.ts had
  drifted to biacromial breadth context which conflicted with
  the API label + formulas). CALF 35cm → 30cm (accommodates
  user's 12.7in actual). FFMI 18 → 15 (sedentary adult-male
  floor). FIVE_K_TIME 1500s → 900s (was 25min; elite is ~13min).
  ONE_MILE_TIME 360s → 240s (was 6min; elite is ~4min). Applied
  to both `api/src/lib/metrics.ts` and `web/src/lib/types.ts`
  to keep them in sync. Tests in `metricFloors.test.ts` (6/6).
- ✅ Inventory: drop Preview panel + move Stats From Equipment to
  the left column (between Equipped Loadout and Item Catalogue).
  Right column is item-detail only.
- ✅ Morning Checkins cache invalidation bug: WeighInPanel +
  Import page now `qc.invalidateQueries({ queryKey: ['check-ins'] })`
  after their writes, so the dashboard's check-in cards refresh
  with today's data instead of showing the stale "due" list.
- ✅ Spiritual + recovery penance events (7 new PenanceKey
  entries): `missed_spiritual_week`, `missed_examen`,
  `missed_recovery_week`, `missed_hrv` (damage) and
  `completed_spiritual_day`, `logged_recovery_week`,
  `logged_sleep_8h` (repair). Each has a label + flavor text.
  Tests in `penanceEvents.test.ts` (25/25 pass).
- ✅ Portal-leak stacking: `maybeSpawnLeak` no longer
  short-circuits if an active leak exists. `getLeakForUser` now
  returns all active leaks oldest-first + per-leak recent damage
  events. The frontend shows a "× N" queue badge on the
  homebase alert and a "#N of M" queue index on /portal-leak.
  The user explicitly requested: "if ive been slipping and have
  earned three monsters there should be three active".
- ✅ 3 new insight rules: `plateau_detected`, `water_low_recent`,
  `sleep_recovery_mismatch` (tests in `insightRulesExtended.test.ts`).
- ✅ All sprite assets updated. 91 catalog sprites + 9 boss
  portraits + 15 monster portraits all use the green-screen +
  isnet-soft pipeline. No halo / shadow / smudge artifacts.
  Walker cane, plain cotton, sabatons regenerated specifically
  with the green-screen method (synthesized versions were
  rejected as "shit" by the user).
- ✅ Portal-leak attack flow: opening the workout logger inline
  from the leak alert now auto-fires `/workouts/:id/leak-damage`
  on commit. The user sees depleted HP immediately.
- ✅ Walking cane wired to BOTH possible paths
  (items/weapon_healer_1.png AND gear/weapons/oracle.png) so
  the seed can point at either.
- ✅ Per-item sprite manifest regenerated by
  `npm run sprites:manifest`.
- ✅ Quest threshold-based auto-completion
- ✅ Routine + streak system (consistency bonus, no penalty)
- ✅ Rest timer + copy-last-session + history filters
- ✅ Workout form polish (autocomplete, bodyweight detection,
  unit conversion, muscle preview)
- ✅ 3D body hologram with pain/worked/recovery overlays
- ✅ Mobile polish (bottom nav, responsive grids, safe-area insets)
- ✅ Tron identity disc avatar
- ✅ Quest overworld with animations
- ✅ Pain logging system
- ✅ 5571-minute walking-session insight bug (Workout.duration
  unit fix, migration 20260627090000_fix_fit_duration_units)
- ✅ Class-lock badge color fix (oracle now periwinkle, not gray)
- ✅ Tie quest boss unlocks to world completion
- ✅ More worlds — Nexus + Breach
- ✅ Breach world reset on Maw defeat (cycle field, 10 Maw variants)
- ✅ Breach ↔ Raid integration (PortalLeak.worldSource + breach badge)
- ✅ Live mode "Finish workout" hang fix (fire commit in the
  "no more sets" branch of advanceToNextSet)
- ✅ Quest homebase overhaul (consolidation to single page with
  Open Galaxy Map overlay, Breach indicator, leak modal)
- ✅ 2FA / TOTP
- ✅ Data export (JSON + CSV)
- ✅ FIT / GPX imports
- ✅ Gadgetbridge ingest (upload-only)
- ✅ Nutrition tracker (Foods/Meals routes + Nutrition page)
- ✅ Body composition timeline chart
  (BodyComp.tsx with 30d/90d/6mo/1yr windows)

## Nice-to-haves (backlog)

- Dark/light theme toggle (currently only dark)
- Push notifications (web push API for homebase shield drops,
  breach defeat, etc.)

(was: sound/audio system — shipped. Settings → Sound panel
has a mute toggle (persisted to localStorage) plus per-event
preview buttons. Web Audio API synth tones (oscillator +
ADSR envelope) — no MP3 files, no howler.js dependency. v1
events wired into Workouts onSuccess → workoutComplete,
Workouts + SkillTree on level-up → levelUp, RestTimer on
hit-zero → restTimerDone (replaces the inline AudioContext
beep), SkillTree on unlock → skillUnlock (the meme),
Achievements diff → achievement. The soundBus also exposes
`playFile(event)` for future MP3 swaps — drop files in
web/public/sounds/ and add the path to SOUND_FILES in
web/src/lib/soundBus.ts to upgrade any event. Mute state is
persisted via `fitquest:sound:muted` in localStorage. Audio
context is unlocked on the first user gesture (pointerdown
/ keydown) per browser autoplay policy.)

(also: skill-unlock queue + activity→skill matching, shipped.
New PendingSkillUnlock table + lib/skillMatching.ts + two
new endpoints (POST /skills/check-eligible, GET /skills
/pending-unlocks, POST /skills/pending-unlocks/:id/dismiss).
The matching pass runs server-side on every workout commit
+ on demand via the check-eligible endpoint, creates a
PendingSkillUnlock row for each (skill, workout, set) tuple
that satisfies a locked skill's test threshold. The SkillTree
page renders the queue one modal at a time on mount (FIFO),
each modal showing the matched set details (reps × weight,
exercise name, date) so the user can verify before unlocking.
Skills with unmet prerequisites are filtered out of the
queue. Sibling PENDING rows for the same skillId are
auto-DISMISSED on unlock. POST /skills/unlock accepts an
optional pendingUnlockId to use the snapshotted set as the
unlock result. Skill points are bypassed for pending-driven
unlocks (the user paid the cost by doing the workout). The
synth-approximated kazoo + yayyy "skillUnlock" sound plays
on every successful unlock — both manual and from the
queue. The diff-based "playSound('achievement')" hook in
the Achievements page fires whenever a new achievement
unlock is detected in the query data.)

## Dropped

- ~~Email verification + password reset.~~ No email integration
  in this app. Dropped per user direction.