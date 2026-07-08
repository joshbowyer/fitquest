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
- **Android release: v1.0.37 published.** [v1.0.37 on GitHub](https://github.com/joshbowyer/fitquest-android/releases/tag/v1.0.37)
  — persistent notification feed/inbox + nutrition chart multi-toggle
  + genetic-max refactor (see Recently Fixed below). APK signed with
  debug keystore, ~44.8 MB (the ML Kit + camera AARs are heavy but
  unavoidable with the native barcode plugin). 34 prior versions
  published (v1.0.3 → v1.0.36). The SDK upgrade in v1.0.14
  (minSdk 22→26, compileSdk 34→36, AGP 8.13, Gradle 8.13)
  unblocked the native `@capacitor/barcode-scanner` plugin.
- **Docker images.** Auto-built and pushed to
  `ghcr.io/joshbowyer/fitquest-{api,web}` on every push to main
  AND every `v*` tag by `.github/workflows/build-images.yml`.
  Tags: `:latest`, `:main`, `:sha-<hash>`, and `:<semver>` (e.g.
  `:1.0.25`) — ALL proper multi-arch manifest lists (amd64+arm64)
  as of the 2026-07-07 CI fix (tag builds used to fail at the
  manifest-merge step, and `:main`/`:latest` could be left
  single-arch by build-job races). The WEB image build now runs
  `tsc -b` as a HARD gate (zero type errors enforced — this is
  what stops crash-class bugs from shipping past vite's
  no-typecheck transpile). The api image still has `|| true` on
  its tsc step until its remaining error backlog hits zero (see
  P0). Latest successful runs: commit `a410a86` (main + v1.0.25
  tag). The android side is a separate repo
  (`joshbowyer/fitquest-android`); the web bundle is built via
  `npx vite build` then `npx cap sync android` ships it into
  the APK.
- **Android sync:** `scripts/sync-android.sh` (in this repo) wraps
  the script at `../fitquest-android/scripts/sync-android.sh` so the
  Android wrapper doesn't get stale when web/api ships. Run from
  this repo after merging web/api changes:
  ```
  ./scripts/sync-android.sh          # refresh CHANGELOG + release notes for current version
  BUMP=1 ./scripts/sync-android.sh   # auto-bump patch (X.Y.Z → X.Y.(Z+1)) + refresh notes
  NEXT_VERSION=1.0.16 ./scripts/sync-android.sh
  ```
  The script categorises the parent repo's recent commits by
  conventional-commit prefix (feat / fix / polish / etc), updates
  `CHANGELOG.md` and writes a `RELEASE_NOTES_vX.Y.Z.md` draft
  ready for `gh release create`. It does NOT run gradle, sign, or
  publish — those stay manual.

## Outstanding (prioritized)

A single-screen view of what's left, in rough priority order.
Each item has a one-line scope. Detailed notes + history live
in the "Backlog" section below; the (was: ...) entries there
are the changelog of what got shipped.

### P0 — quick wins (1-2 days each)

- **API type-error backlog → 0, then flip the api Dockerfile
  typecheck gate.** The 2026-07-07 bug hunt fixed lib/prisma.ts
  typing (PrismaClient + all 25 enums now real types — this alone
  surfaced 4 runtime-crash bugs) and drove api tsc errors
  550 → 167. The remaining 167 are verified annotation noise
  (import.ts ~42, sleepCorrelation, impossibleValues,
  supersetRoundRobin, homeBase/skills/workouts routes, ~42 in
  tests). Once at zero, remove the `|| true` from
  `api/Dockerfile:48` so the api build enforces typecheck the
  same way web now does. This is the single highest-leverage
  hygiene item left — the web-side equivalent is what caught the
  Dashboard-crash class of bug.
- **Dark/light theme toggle** (currently dark-only).
### Recently shipped P0s

- ✅ **Notification feed / inbox** — shipped v1.0.37 (`d0bce16` +
  `567c4be`). Persistent `Notification` table + `/notifications`
  inbox (filter tabs, mark-read/dismiss/read-all/clear-all,
  deep-links) + top-bar bell & unread badge. Emitted from skill
  unlock, level-up, penance (shield damage/repair), and shop
  purchase via the fire-and-forget `emitNotification` funnel.
  Follow-ups if desired: also emit from achievement pops + the
  daily-digest / morning-report sweep (the funnel is in place,
  just needs the call sites).

- ✅ **Skill tree: horizontal layout for mobile** — shipped in
  `e1bab61` + `2be45e8` (calitree-style: one horizontal
  scrollable chain per branch, branches stacked vertically),
  connector/width tuning in `fa47907`/`bf91e44`, and the icon
  Y-alignment root-cause fix in `59b4289` (v1.0.24): 1-line vs
  2-line skill names made button heights differ and the
  `items-center` chain wrapper pushed short buttons ~4px down —
  nodes are now top-anchored with a fixed 2-line name box, and
  the connector is pinned at the icon center measured from the
  top. Also normalized hand-coded SVG icons to 28px matching the
  calitree PNG masks.

- ✅ **FitQuestBridge: drop the 60-min freshness window.**
  Removed the `find -mmin -60` filter from the Kotlin
  watcher's FIT file enumeration. The persisted known-paths
  dedup set is the source of truth (persists across restarts
  + periodic-prune pass bounds it). Backstop: api's
  `(userId, performedAt)` UNIQUE constraint on Workout
  rejects duplicate uploads. Touched
  `fitquest-bridge` `FitFileObserver.kt`; web/api unchanged.
- ✅ **Re-examine neck circumference genetic-max logic.** The
  production code already uses the wrist×2.9 / height×0.245
  Casey Butt ceiling (correct — a genetic max is a ceiling,
  not a mirror of the current measurement). The bug was
  elsewhere: the unit test `geneticMax.test.ts` was asserting
  the old buggy behavior ('NECK uses measured neckCircCm when
  available' — `expect(...).toBeCloseTo(40, 0)` against
  a passed `neckCircCm: 40`). The test was failing on
  every run, masking the bug it was meant to prevent. Rewrote
  the assertion to lock in the ceiling behavior + a comment
  explaining why a future 'just use the measurement'
  optimization would silently break the Profile's 'grow into
  the ceiling' UX. All 31 geneticMax tests now pass.
- ✅ **Restructure the penance templates panel** (Homebase).
  `HomeBaseCard.tsx` `PenanceTemplatesPanel`: split into two
  collapsed-by-default sub-blocks — 'Shield damage' (negative
  shieldDelta) + 'Shield repair' (positive). Each block
  has a compact header (label + total + active count + active
  net delta) and expands on click. Per-row checkbox-toggle
  dropped (the old checkbox read as a 'click to enable'
  affordance — it was a server-tracked flag, not a local
  pref). Replaced with click-anywhere-on-the-row toggle +
  a clear 'active now' pill on enabled rows. The whole panel
  is now collapsed by default so it doesn't drown the
  actual shield status.
- (was: v-taper `SHOULDER_WAIST_RATIO` from /measurements
  sidebar — already shipped. The /measurements page filters
  out DERIVED_METRICS (LEAN_MASS, FFMI, SHOULDER_WAIST_RATIO)
  from the sidebar tile grid; MetricDetailModal blocks logging
  derived metrics; the dashboard body-comp radials auto-derive
  v-taper from SHOULDER × WAIST as a gauge (read-only output).
  No code change needed — roadmap entry was stale.)

### P1 — feature work (1-2 weeks each)

- **Genetic-max shadowing: surface the formula value alongside
  manual overrides.** /profile `previewMax()` drift from the
  canonical api formula was already fixed (commit `f68b653`).
  Remaining: when a user has a manual override equal to their
  current measurement, the dashboard shows
  "current = genetic max" with no indication that an override
  shadows the formula. Fix: display both side-by-side ("Genetic
  Max: 50 (manual, formula says 45)") + a "reset to formula"
  affordance on the override row.
- ✅ **Genetic-max drift prevention** — shipped v1.0.37 (`d151e1e`).
  `previewMax` + `PREVIEW_METRICS` extracted from `Profile.tsx` to
  `web/src/lib/geneticMax.ts` (single frontend source of truth,
  mirrors `api/src/lib/geneticMax.ts`).
- **Medical metrics UI.** Schema has resting HR / sleep / stress
  data but no medical-themed UI (no "history of resting HR"
  chart, no BP log form). Existing /measurements tiles + the
  new overlays would be a good starting point.
- **Personal records aggregated page.** /prs/WorkoutDetail
  shows individual PRs but no "all my PRs over time" view
  with charts.

### P1.5 — small follow-ups from the 2026-07-07 bug hunt (hours each, low urgency)

- ✅ **`sync-android.sh` NEXT_VERSION versionCode bump** — fixed
  v1.0.37 (`90d318a`, android repo). The explicit-version path now
  bumps versionCode (guarded against a no-op when NEXT_VERSION ==
  current).
- **Web main chunk is 2.3 MB** (vite warns on every build).
  Route-level `React.lazy` code-splitting for the heavy pages
  (Three.js avatar, Recharts pages) would cut initial load on
  mobile substantially.

### P2 — bigger features (2+ weeks)

- **Stuff to spend gold on.** Gold is currently a passive
  counter. Themed weapons / armor sets (equippable, cosmetic,
  with set bonuses), holiday / seasonal items, UI themes
  (color palettes for the neon glow). All cosmetic unless we
  design a real prestige system.
- **3D avatar polish (rendering + shape).** Scale the avatar
  to user measurements (height / shoulder-waist v-taper /
  arm circumference) + replace the disjointed 3D rectangles
  with anatomical meshes (tapered cylinders for limbs, real
  torso, head sphere) so the silhouette reads as a person.
  `User.heightCm` + `User.shoulderCm` + `User.waistCm` are
  already on the model.
- **Body measurement photos with diff.** Upload a photo
  alongside a measurement and have a side-by-side view
  (overlay diff or fade slider) vs. the previous photo. Needs
  a new migration for `MeasurementPhoto` rows + storage
  (S3-compatible or local disk).
- (was: AI coach / HUD with selectable personalities — v1
  shipped in `cd46826` (release [v1.0.27](https://github.com/joshbowyer/fitquest-android/releases/tag/v1.0.27)).
  /coach page with 5 personality presets + system-prompt
  seeding + persistence on `User.coachPersonality`. Uses the
  system default LLM (`minimax-m3`). Remaining work, all
  scoped to "polish the v1": per-personality admin prompt
  overrides on `LlmConfig.coachSystemPromptOverrides`; server-
  side conversation history (CoachMessage table); streaming
  responses; richer per-message personality override.)


### P3 — stretch

- **Gadgetbridge rebuild-reminder.** When GB's FIT-export API
  changes (rare), surface a "rebuild & install" reminder in
  the bridge's foreground-service notification.

## Backlog (from user notes, in priority order)

Detailed scope + history for each outstanding item. Shipped
items are demoted below the wave (see "Recently Fixed / Resolved"
at the bottom for the full changelog).

### Polish

- **Medical metrics UI.** Surface existing RHR / sleep / stress
  for medical history. Schema has the data but no medical-themed
  UI (no "history of resting HR" chart, no BP log form, etc).
- **Personal records page** — all PRs in one view with charts
  over time. Currently /prs/WorkoutDetail shows individual PRs
  but no aggregated "all my PRs over time" view.
- (was: Mobile polish small wins — shipped in `e1bab61`:
  long-press multi-select + bulk-delete on workout history,
  pull-to-refresh on Dashboard, haptic feedback on rest-timer
  completion. The Dashboard pull-to-refresh hook's missing
  import — which white-screened the whole tab — was fixed in
  the 2026-07-07 bug hunt.)
- **3D avatar polish** — animations on level completion. The
  recently-worked indicator already brightens recently-trained
  parts (static, not animated) so the user can see at a glance
  what was worked; the level-up animation already fires via
  RewardOverlay. What's left is making the level-up animation
  more cinematic and a stronger workout-logged effect.

### Identity / auth

(was: Capacitor APK session persistence — was actually collateral
of the data-loading bug, NOT a separate CookieManager flush
issue. Once `setSessionCookie` got the matching `domain` +
`sameSite: 'none'` fix, cookies set during login were stored with
a parent-domain scope that survives the WebView's normal cookie
write cycle, so a fresh app launch with the same APK installed
re-authenticates via `GET /auth/me` against the persisted cookie
without prompting for credentials. The CookieManager flush
override turned out not to be needed. Diagnostic: `docker
compose logs -f api | grep '"msg":"req"'` while force-closing +
reopening the APK showed a single `GET /auth/me` carrying the
`fitquest_session` cookie returning 200, no MainActivity change
required.)

(was: admin reset-items button — shipped in commit 4c18a0f.
Admin → Inventory panel has a typed-confirm 'Wipe ALL items'
button + per-user 'Wipe items' buttons. 5 unit tests cover the
scopes + the equip-state-wiped-with-row assertion.)

(was: admin reset-skills endpoint — shipped in `7a8a194`. POST
`/admin/users/:id/reset-skills` wipes both UserSkill and
PendingSkillUnlock rows in one transaction. Use case: an
admin can reset a user's skill state to debug prereq /
matching issues, then the user re-runs /check-eligible (or the
next workout commit) to re-trigger the matching pass from a
clean slate.)

### Nutrition & Food

(was: unify /today + /nutrition food entry modals — shipped in
`46f647e`. Both modals now share the recent-foods strip and the
saved-foods quick-log. /today treats food entries as snacks,
/nutrition as meals — the modal's submit handler reads from
context.)

(was: auto-link substances to food entries — shipped in `53be4e4`
on the api side. If the food name contains "coffee", "kombucha",
"matcha", "espresso", etc., the matching caffeine substance log
row is auto-ticked. Server-side keyword match runs on
FoodItem.create. UI checkbox can still be toggled manually. Same
mechanism available for alcohol/wine/beer and nicotine; the
shipped v1 only does caffeine.)

(was: saved-foods row + logged-meal item yellow capsule chrome
— shipped in `46f647e`. Both use the same yellow capsule now,
with edit + delete inline.)

### Mobile & UX

- (was: Reorganize nav menu items on mobile — shipped in
  `0cdbc8c`. Mobile menu overlay now supports drag-to-reorder
  via the same `useNavOrder` hook the desktop sidebar uses.
  Toggle button + drag-handle glyph + Done/reset buttons mirror
  the desktop pattern. Order syncs across devices via the
  shared localStorage key.)
- (was: Galaxy map on mobile — shipped in `7d21db2`. Was
  showing too small + mis-aligned because of the redundant
  below-SVG legend block taking ~30px of vertical space + the
  right-side label stack not fitting at narrow widths. Fixed by
  dropping the bottom legend (each class is already labelled on
  its portal disc inside the SVG) + tightening wrapper padding
  + flex-1 on mobile so the SVG claims the available space.)
- (was: Remove the "⚙ Settings" button from the top of
  /dashboard — shipped in `0cdbc8c`. /dashboard's PageHeader
  action now only shows the Calendar quick-link; Settings lives
  in the sidebar where it always belonged.)
- (was: wire up web notifications — shipped in `6cbe0c2`. Use
  the Notification API on homebase shield drops, breach
  defeat, boss kill, streak-break, etc. Has to be opt-in
  — request permission on first trigger. The page calls
  `Notification.requestPermission()` lazily.)

### Gamification & Economy

- **Stuff to spend gold on.** Right now gold is a passive
  counter. Ideas: themed weapons + armor sets (equippable,
  cosmetic, with set bonuses), holiday / seasonal items
  (Halloween pumpkins, Christmas lights, etc.), UI themes
  (color palettes for the neon glow). All cosmetic unless
  we want to design a real prestige system around them.
- (was: Calendar view — shipped in `cd16301` + `2309089` +
  `26d95a7`. `/calendar` is a month grid + per-day recap that
  shows workouts, weigh-ins, pain, habits, dailies, and the
  morning popup / recovery score for the chosen day. Day cells
  have color-coded X/Y boxes, future dates render as empty
  gray. Strikethrough-strikethrough on done items.)

### Measurements

- (was: Skill tree explicit per-skill prereqs for all 6 classes —
  shipped across `75f62a6`/`dbcadbe`/`88425cb` (SCOUT, BERSERKER,
  JUGGERNAUT/TRACER/ORACLE). Every class is a clean linear DAG
  with 1-3 weaving merge points; the auto-T1-all-tier heuristic
  is gone.)
- **Genetic-max consistency between /profile, /measurements,
  and /dashboard.** All three pages need to surface the same
  value for the same metric, but three independent code paths
  each had a divergence bug:
  - (was: /profile `previewMax()` function drift from
    canonical formula in api/src/lib/geneticMax.ts. Three
    formulas were wrong — NECK returned the user's current
    `neckCircCm` instead of the ceiling from wrist/height;
    WAIST had a formula but the api dropped waist from genetic
    maxes entirely; BENCH_1RM used w × 1.0 as a bodyweight
    proxy. **FIXED in `f68b653`** — /profile now matches the
    api formula exactly.)
  - **/measurements and /dashboard** both read from the same
    `geneticMax` table, so a manual override set via the
    "set max from latest measurement" button on /measurements
    propagates to the dashboard too. The user has hit this
    with neck: the formula-computed ceiling (`wristCm × 2.9`)
    gets shadowed by a stored manual override equal to their
    current measurement, so the dashboard displays "your
    current measurement = your genetic max" — misleading.
    (was: /measurements + /dashboard already share the
    geneticMax table, so the propagation half works. The
    shadowing bug remains: when a manual override is set,
    dashboard shows current measurement = genetic max with
    no indication that an override is in effect. Fix: show
    both numbers side-by-side, or surface a "manual override"
    badge on the dashboard gauge so the user knows the formula
    isn't being used.)
    Fix: surface the formula-computed value alongside the
    stored value (e.g. "Genetic Max: 50 (manual, formula says
    45)"), and add a "reset to formula" affordance next to
    the override. Same pattern for any metric where the
    formula and the user's current measurement diverge
    meaningfully.
  - **Prevent future drift.** The `previewMax` doc comment
    now flags this — if you edit the api formula, update the
    local copy at the same time. Consider extracting
    `previewMax` to a shared `web/src/lib/geneticMax.ts`
    imported by all three pages (Profile, Measurements,
    Dashboard's preview helpers) so there's only one source
    of truth. Low-priority refactor — the current drift is
    fixed, and the doc comment is the safety net.
- (was: Remove v-taper from the /measurements sidebar — stale
  entry; already shipped. The page filters DERIVED_METRICS
  (LEAN_MASS, FFMI, SHOULDER_WAIST_RATIO) from the tile grid
  and MetricDetailModal blocks logging derived metrics. See the
  note under "Recently shipped P0s".)
- (was: Split /measurements into category cards (2 per row) —
  shipped in `ff107df`, refined in `b6316e7`. First version had
  2-col collapsible cards — desktop layout was awkward (one
  card expanded but the next sat at full height collapsed,
  with no visual cue that it was collapsed vs empty).
  Replaced with a flat grid of metric tiles grouped by category,
  each tile showing the latest value + unit. Tiles are always
  visible — no collapsing, no ambiguity. Click a tile →
  MetricDetailModal opens with the full stack: top stats → log
  form (moved up from after history per user feedback) →
  history (sparkline + all logs) → Override Genetic Max
  (lifted from the old inline panel) → About. Page shrunk
  from 483 → 159 lines.)
- (was: Resting HR radial — shipped in two parts: IdealGauge
  routing + bands already in place; genetic-max returned 70
  instead of 45 in the api. The 1 remaining loose end — the
  basic Gauge's `lessIsBetter` prop was declared but never
  wired into the "X% OVER" warning gate — is now wired in
  `ff107df`. In practice every "less is better" metric
  routes through IdealGauge today, so this is dead-code
  cleanup rather than a user-facing fix, but the doc comment
  in Gauge.tsx now matches reality. Two new vitest assertions
  pin the RHR genetic-max to 70 (universal — no age/sex
  adjustment, since the unhealthy threshold doesn't shift
  meaningfully).)
- (was: L-Sit radial visual diff — shipped in `ff107df`. Was
  falling through to the plain Gauge (no zones, no warn/elite
  coloring) because it was in `monotonicMetricKeys` but
  missing from `METRIC_MONOTONIC_BANDS`. Added bands entry
  (elite ≥1:00, healthy ≥0:30, max 3:00) — now renders with
  the same lime/cyan/amber zone backgrounds as plank/dead-hang.)
- (was: Alternate bodyfat inputs (calipers/DEXA/BIA/Navy) —
  shipped in `eb73bd5`. New `BodyfatMethodPicker` modal with
  4 methods (DEXA / BIA / Calipers 3-site Jackson-Pollock /
  Navy tape). JP3 + Navy are sex-aware (men: chest/abdomen/
  thigh, women: triceps/suprailium/thigh; Navy needs hip for
  women). Formulas mirrored in `web/src/lib/bodyfat.ts` and
  `api/src/lib/bodyfat.ts` (14 vitest assertions, all pass).
  Submit goes to POST /measurements with the chosen `source`
  field (CALIPERS / BIA / DEXA / NAVY_TAPE) so the morning
  report's confidence weighting applies. Hooked into
  MetricDetailModal (BODY_FAT_PCT row) and Profile.)
- (was: Split `BICEP` into `BICEP_RELAXED` and `BICEP_FLEXED`
  — shipped in `eb73bd5`. Migration
  `20260706000000_bicep_split_flexed_relaxed` adds the two
  new enum values and migrates existing Measurement +
  GeneticMax rows to BICEP_FLEXED. Casey Butt formula gives
  ~16.2cm ceiling for a 6" wrist; relaxed uses the same
  formula × 0.92 (~14.9cm). bicep_40/bicep_45 achievements now
  point at BICEP_FLEXED.)
- (was: Body weight graph zoom (`yPad`) — shipped earlier;
  `yPad` 20 → 10 in the /insights chart so the trend line is
  more readable. Documented in Recently Fixed below.)
- (was: Re-examine neck circumference genetic-max logic —
  resolved. Production code already used the wrist×2.9 /
  height×0.245 Casey Butt ceiling; the actual bug was a stale
  unit test asserting the old behavior. See the ✅ note under
  "Recently shipped P0s". This entry had also been truncated
  mid-sentence by an earlier edit.)
- **Body measurement photos with diff.** Upload a photo
  alongside a measurement (or independently) and have a
  side-by-side view that highlights the change vs. the
  previous photo (overlay diff or just a slider to fade
  between the two). Storage: S3-compatible or local disk;
  probably needs a new migration for `MeasurementPhoto` rows
  tied to the parent measurement.

### Habits

- (was: Habit tile visual state — shipped in `ff107df`.
  /habits page tile now renders unchecked as neutral gray
  (border-ink-500/30, no accent tint, no glow on the icon
  box, no glow on the title text). When checked (todayCount
  > 0), the whole tile lights up in the accent color: border
  + background tint + glow on the icon and title. Same lime /
  magenta split for POSITIVE / NEGATIVE — but only AFTER the
  habit has actually been logged today. The HabitsWidget on
  /dashboard was already correct (its unchecked state was
  always neutral ink-500); only the /habits page needed the
  fix.)

### Homebase / Penance

- (was: Restructure the penance templates panel — shipped; see
  the ✅ note under "Recently shipped P0s": two collapsed
  sub-blocks (Shield damage / Shield repair), checkbox
  affordance replaced with row-toggle + "active now" pill.)

### Portal Leaks

- (was: Leaks should not expire — shipped in 7ca7b3d. Also added
  MAX_ACTIVE_LEAKS = 3 cap with LEAK_RESUME_AT = 2 hysteresis:
  new spawns gated when active count >= 3, resume when count
  drops to 2. tickLeakGrowth no longer writes the EXPIRED
  branch; LEAK_TTL_MS kept as a hint for UI copy. Breach leaks
  also respect the cap now (previously blocked on ANY active
  leak, which made Breach clears feel unrewarded). 8/8 stacking
  tests pass.)

## Stretch / Future

- (was: AI coach / HUD — see P2 item above; v1 shipped in
  v1.0.27. The "Pick a voice" brainstorming below is folded
  into the v1 prompt library (`api/src/lib/coach.ts`); the
  per-personality admin overrides remain the next milestone.)

- **3D avatar polish (rendering + shape).** Two parts:
  1. **Scale the avatar to user measurements.** Body height
     sets the avatar's vertical scale; shoulder / waist
     ratio sets the v-taper; arm circumference sets the
     limb width. `User.heightCm` + `User.shoulderCm` +
     `User.waistCm` already exist — wire them into the
     Three.js render params so the avatar looks like *the
     user*, not a generic figure.
  2. **More contoured / humanoid muscle groups.** Current
     avatar uses disjointed 3D rectangles for each muscle
     group. Replace with anatomical meshes (or
     parametric primitives like tapered cylinders for the
     arms / legs, a real torso shape, a head sphere) so
     the silhouette reads as a person rather than a stack
     of boxes.
- **Gadgetbridge rebuild-reminder.** The
  `joshbowyer/fitquest-bridge` APK ships periodic background-
  poll uploads via SAF-granted dir watching. Next step: when
  GB's FIT-export API changes (rare), surface a "rebuild &
  install" reminder in the bridge's foreground-service
  notification so the user knows to grab a new APK.

## Dropped (moved here to keep them out of the active lists)

- ~~Native Android app~~ — shipped as the Capacitor wrapper at
  [`joshbowyer/fitquest-android`](https://github.com/joshbowyer/fitquest-android).
  V1.0.0 (cookie + DeleteButton + tz fixes) and v1.0.1 (smaller
  adaptive-icon triangle) released. The roadmap item was a
  pre-Capacitor "wrap or build native?" question — answered
  "wrap, via Capacitor."
- ~~Gadgetbridge live push/pull~~ — shipped as
  [`joshbowyer/fitquest-bridge`](https://github.com/joshbowyer/fitquest-bridge).
  v1.0.0 released. Only the rebuild-reminder follow-up
  remains (in Stretch / Future above).
- ~~Sound / audio system~~ — shipped. Web Audio API synth
  tones (oscillator + ADSR envelope) wired into Workouts
  onSuccess → workoutComplete, SkillTree level-up →
  levelUp, RestTimer on hit-zero → restTimerDone, SkillTree
  on unlock → skillUnlock, Achievements diff → achievement.
  Settings → Sound panel has a mute toggle persisted to
  localStorage. The soundBus also exposes `playFile(event)`
  for future MP3 swaps — drop files in `web/public/sounds/`
  and add the path to `SOUND_FILES` in
  `web/src/lib/soundBus.ts`.
- ~~Email verification + password reset.~~ No email integration
  in this app. Dropped per user direction.

## Recently Fixed / Resolved

### 2026-07-08 session — v1.0.38 morning popup + notification expansion

Commits `ec3ad1b` (popup cross-device), `94f03ed` (weigh-in tile),
`a51b...` (shield digest), `da675cf` (inbox expansion), `5157024`
(inbox UI), plus ROADMAP + the new migration
`20260708030000_morning_popup_dismissal`.

- ✅ **Morning popup on any first interaction, not just /today**.
  `<MorningPopup />` moved from `Today.tsx` to `Layout.tsx` so it
  persists across SPA route changes and is reachable from any
  page. The auto-open effect waits for the first `pointerdown` /
  `keydown` of the day (one-shot listeners) instead of firing on
  mount — the popup greets the user when they actually start
  using the app, on whatever page they happen to be on. Was the
  P0 "morning recap on first user interaction of the day".

- ✅ **Cross-device dismissal state.** The localStorage flag was
  browser-scoped, so dismissing on the Android (Capacitor) app
  didn't carry over to the web desktop (or vice-versa) and the
  popup re-opened on the other device. New
  `MorningPopupDismissal` model + migration
  `20260708030000_morning_popup_dismissal`, new
  `POST /dailies/morning-popup/dismiss` endpoint (idempotent
  upsert), and the GET response now includes
  `dismissed: boolean` for today in the user's tz. The
  component closes itself when the server reports
  `dismissed=true`. localStorage remains as a fast cache; the
  server is the source of truth. 8 new tests.

- ✅ **Shield daily digest at midnight** (replaces the per-event
  repair spam). `firePenance` no longer emits a notification
  for repair events — only damage events get the per-event
  treatment. The repair signal is now a single
  `kind: 'shield_repair_daily'` notification per user per local
  day with the net delta + top-3 contributing penances. Hourly
  cron in `index.ts` runs `runShieldDigestForAllUsers()`. Net
  ≤ 0 days stay silent (damage events have their own
  notifications). Idempotent via
  `Notification.findFirst({ kind, payload.date = yesterday })`.
  8 new tests.

- ✅ **Notification inbox expansion** — closed the ACHIEVEMENT
  gap and wired up event notifications across the rest of the
  gamification surface. Single funnel inside
  `checkAchievements()` lights up `kind: 'achievement_unlocked'`
  for every newly-unlocked key, auto-covering 15 call sites
  (workout, shop, meal, party, leak, habit, daily, pet,
  measurement, import, raid, spiritual, etc.). New kinds:
  `leak_spawn`, `leak_defeated`, `leak_overwhelmed`,
  `world_boss_unlocked`, `world_boss_kill`, `breach_unlocked`,
  `breach_boss_kill`, `raid_started`, `raid_victory`,
  `party_invite_received`, `party_member_joined`,
  `party_member_left`, `party_invite_declined`. All fire-and-
  forget with try/catch; a failed emit never rolls back the
  primary action. The inbox UI now renders a small per-kind
  glyph on the right side of each row so the inbox is
  scannable (▼/▲/✓/✕/☗/✷/⚔/✉/+/-). 16 new tests.

- ✅ **Weigh-in tile in /today's quick-action grid** (replaces
  the full-size block). New `WeighInTile` + `WeighInModal` in
  `TodayActions` — same shape and size as `WaterTile`, opens
  a focused log modal on click (today/streak status,
  prefilled input, Log button, inline achievement unlock
  toast). Same `/measurements/weigh-in` endpoint + same
  query invalidation as the dashboard's `<WeighInPanel />`,
  so a weigh-in from either page propagates everywhere. Wall
  mode unaffected — the tile only renders in the normal
  Layout.

**Verified**: `tsc -b` clean on web, `vite build` succeeds, 664
api tests pass (was 640; +24 new).

### 2026-07-08 session — v1.0.37 notification feed + polish

Commits `5cff649` (chart toggle), `d151e1e` (geneticMax refactor),
`d0bce16` (notification backend), `567c4be` (notification frontend),
`90d318a` (sync-android fix, android repo).

- ✅ **Persistent notification feed / inbox** (closes the P0). Events
  (skill unlocks, level-ups, penance shield damage/repair, shop
  purchases) previously fired only as ephemeral modals + the sound bus,
  so a dismissed modal (or being away from the page) lost them. New
  `Notification` model + `NotificationCategory` enum + migration,
  indexed on `(userId, readAt)` + `(userId, createdAt)`. A single
  fire-and-forget `lib/notify.ts::emitNotification` funnel (never
  throws — a notification failure can't roll back the primary action)
  is wired into the skill-unlock/level-up (`skills.ts`), penance
  (`penance.ts`), and shop-purchase (`shop.ts`) paths. `/notifications`
  routes: list (category/unread filters), unread-count (badge),
  mark-read, read-all, dismiss, clear-all. Frontend: `/notifications`
  inbox (filter tabs, per-row mark-read/dismiss, mark-all/clear-all,
  deep-link on click) + a bell + unread badge in the top bar (desktop +
  mobile). 11 new tests (632 total).
- ✅ **Nutrition trend chart is now a multi-toggle** (all metrics on by
  default, each button a toggle) mirroring the substance + activity
  charts. Dual Y-axis (calories/water left, macros right) so the
  different scales don't flatten the macro lines.
- ✅ **Genetic-max drift prevention** (closes the P1 refactor). Extracted
  `previewMax` + `PREVIEW_METRICS` from `Profile.tsx` into a shared
  `web/src/lib/geneticMax.ts` — one frontend source of truth mirroring
  `api/src/lib/geneticMax.ts`.
- ✅ **`sync-android.sh` NEXT_VERSION versionCode bug** (closes the
  P1.5). The explicit-version path now bumps versionCode (previously
  only `BUMP=1` did, so a `NEXT_VERSION=x.y.z` release shipped a stale
  code that Android refuses to install over the existing app).

### 2026-07-07 session — v1.0.36 nutrition trends + skill tier rebalance

Commits `2e3e6f8` (trend endpoints), `ab1126f` (trend charts),
`ea4fcf2` (skill tier rebalance).

- ✅ **Nutrition + substance trend charts on `/nutrition`.** The
  `/meals/trend?days=N` and `/substances/trend?days=N` per-day rollup
  endpoints (timezone-aware, zero-filled contiguous days; meals merges
  WATER_ML so the water line matches the daily bar) were built + tested
  but had no UI consumer. Added two recharts components:
  `NutritionTrendChart` (area chart, metric toggle
  calories/protein/carbs/fat/water + 7/14/30d range, water converted to
  the user's units) and `SubstanceTrendChart` (multi-line per-category
  count with toggleable series). Both wrapped in ErrorBoundary. 8 trend
  tests in `trend.test.ts`.
- ✅ **Removed the T3 skill-tier cap — full per-branch rebalance.** The
  cap removal was previously half-done (only Holds + 3 branches got
  super-tiers); every other branch still crammed its entire advanced
  progression at T3, so e.g. a knee one-arm push-up sat at the same tier
  as a 50%BW weighted one-arm push-up, and 5 ring muscle-ups equalled a
  3s iron cross. All 6 classes now spread T3-T6 by real difficulty,
  contiguous (no skipped tiers), each branch's god-tier feat last and
  equal to its `BRANCH_MAX_TIER` (so the glow lands right). Fixed a
  latent bug where the unlock XP/gold bonus was a TIER_3-only ternary
  that silently dropped T4+ skills to the T1 reward — now a T1-T6 map.
  `BRANCH_MAX_TIER` kept in sync across `seedSkills.ts` + `SkillTree.tsx`;
  stale `TIER_1|2|3` type annotations widened. Validated: no tier gaps,
  no backwards prereqs, all 621 api tests pass.
- ✅ **Cleaned up hallucinated seed-file artifacts** — an orphaned
  duplicate comment block in `meals.ts` and a stale `Nutrition.bak.tsx`
  comment reference.

### 2026-07-07 session — v1.0.35 todos + /vitals + GB_FITQUEST_SYNC design doc

- ✅ **One-shot TODO list** at `/todos`. New `TodoItem` table
  (title, description, dueDate, priority LOW/MED/HIGH, status
  OPEN/DONE, completedAt). CRUD + 10/20/30 XP reward scaled by
  priority on the OPEN→DONE transition. Nav icon ☐.
- ✅ **`POST /vitals` + `GET /vitals`** for the upcoming
  Gadgetbridge FitQuest auto-sync (see `GB_FITQUEST_SYNC.md`
  for the full GB-side architecture). Accepts batched time-series
  JSON, upserts into `Measurement` keyed on `(userId, metric,
  recordedAt)`. Same-value skip avoids churn on re-syncs. Validates
  `kind` against the known `MetricType` enum values; 400 with
  `unknown_metric` if a typo. `?since=...` cursor endpoint returns
  existing samples for reconciliation. Up to 1000 samples per POST.
- ✅ **`docs/GB_FITQUEST_SYNC.md`** — comprehensive design doc for
  the GB-side auto-sync that closes the FitQuestBridge's
  "body battery not in FIT" gap. Copies the HealthConnect
  syncer pattern. Tracker-agnostic interface so Endurain /
  Wanderer / FitTrackee get the same benefit for 50 lines of
  impl each. Defines a 3-PR strategy (server → framework+Steps
  → remaining 10 syncers). Use as the take-back-up reference
  after compaction.

### 2026-07-07 session — v1.0.34 FIT type 16 + unique constraint

Commit `f400934`, release
[v1.0.34](https://github.com/joshbowyer/fitquest-android/releases/tag/v1.0.34).

- ✅ **FIT_MONITORING_B type corrected to 16 (was 119).** v1.0.33
  added `type 119` to the kind label map based on a wrong FIT
  spec reading. Per `@garmin/fitsdk`, modern Garmin watches
  write the monitoring-b file as numeric type **16**. The
  user's actual MONITOR files all show `type 16`; the wrong
  mapping meant every monitoring FIT was still classified as
  'unknown' and parsed to nothing. Verified end-to-end: 3
  MONITOR files imported via `/import` yielded
  `kind: 'monitor'` and extracted RESPIRATION_RATE + STEPS.
- ✅ **Measurement unique constraint migration.** The schema
  declared `@@unique([userId, metric, recordedAt])` but the
  live DB only had the plain index, so
  `prisma.measurement.upsert` was failing with Postgres
  `42P10` ("no unique or exclusion constraint matching the
  ON CONFLICT specification"). New migration
  `20260707120000_measurement_unique_constraint` swaps the
  non-unique index for a unique one in-place (no duplicates
  exist).
- ✅ **Body battery is genuinely not in the FIT files.**
  Decoded every directory in the user's test pool (ACTIVITY,
  METRICS, HRV_STATUS, MONITOR, SLEEP) — zero
  `hsaBodyBatteryDataMesgs` anywhere. This particular watch +
  Gadgetbridge sync path doesn't surface body battery via FIT
  export; it lives in Garmin Connect's database (Health API)
  and would need a separate integration. Out of scope for the
  FIT pipeline; a Garmin Connect Health API integration is a
  roadmap item if needed.

### 2026-07-07 session — v1.0.33 Body Battery fix

Commit `c90ea45`, release
[v1.0.33](https://github.com/joshbowyer/fitquest-android/releases/tag/v1.0.33).
Tests 595 → 599 (4 new in `fitKind.test.ts`).

- ✅ **Monitoring FIT files now extract body battery + HRV.**
  Two bugs: (1) `detectFitKind()` was missing the common
  Garmin file types `119` (`FIT_FILE_MONITORING_B`, modern
  watches) and `120` (`FIT_FILE_MONITORING_A`, older watches)
  — both fell through to the `?? 'unknown'` default so the
  parser extracted nothing. (2) Body battery + HRV extraction
  was in `parseMetrics` (file type 44, rare daily rollup)
  instead of `parseMonitor` (where the HSA messages actually
  live) — so monitoring files uploaded by the bridge never hit
  the right code path. Moved body battery + HRV extraction
  from `parseMetrics` to `parseMonitor`. `parseMetrics` now
  delegates to `parseMonitor`.

  Note: the bridge dedupes by absolute file path, so files
  that were already uploaded as 'unknown' before this fix
  won't be re-uploaded. To backfill: clear GB's app data +
  re-sync, or wait for new monitoring data.

### 2026-07-07 session — v1.0.32 Coach messages panel scroll fix

Commit `b60b7ef`, release
[v1.0.32](https://github.com/joshbowyer/fitquest-android/releases/tag/v1.0.32).

- ✅ **Coach messages panel scrolls to top on entry.** v1.0.31's
  Layout-level scroll-to-top fixed the page-level scroll, but
  the Coach page's inner messages div had its own scroll
  position that the auto-scroll-to-bottom effect was forcing to
  the bottom on every mount. Now: initial render scrolls the
  messages div to its top (so the user sees the start of the
  conversation or the empty state); subsequent renders with new
  messages still scroll to bottom (so the latest reply is
  visible). Distinguished via `initializedRef` + `prevMsgCountRef`.

### 2026-07-07 session — v1.0.31 scroll-to-top hotfix

Commit `e49a7cb`, release
[v1.0.31](https://github.com/joshbowyer/fitquest-android/releases/tag/v1.0.31).

- ✅ **ScrollToTop actually scrolls now.** The v1.0.29 version
  called `window.scrollTo(0, 0)` on every nav, but Layout's
  scrollable surface is `<main className="... overflow-y-auto">`
  — the window isn't actually scrollable. v1.0.31 targets
  `<main>` directly via querySelector (window fallback only for
  the rare pre-mount case). Also fires on initial mount with
  a requestAnimationFrame defer so the scroll wins the race
  against the browser's scroll restoration on back/forward
  and hard reload.

### 2026-07-07 session — v1.0.30 coach persistence + limits + compaction

Commit `75b754f`, release
[v1.0.30](https://github.com/joshbowyer/fitquest-android/releases/tag/v1.0.30).
Tests 572 → 595 (23 new: 16 in coachStore.test.ts, 7 in
chatRateLimit.test.ts).

- ✅ **Coach conversation persistence.** New `CoachConversation`
  (one rolling per user, `@unique` on `userId`) + `CoachMessage`
  tables + migration `20260707093000_coach_conversation`.
  POST /coach persists user + assistant in one tx so we never
  half-write a turn. GET /coach/messages paginates the history
  for page-load hydration. DELETE /coach/messages wipes the
  convo (preserves personality).
- ✅ **Rate limits.** New `chatByUser()` policy in
  `lib/rateLimit.ts` reusing the existing in-memory bucket
  shape: 5 msgs/min burst + 50 msgs/24h cost cap. Returns 429 +
  `Retry-After`. UI surfaces as "Slow down a bit — try again in Ns".
- ✅ **Sliding window.** `SLIDING_WINDOW_SIZE = 20` — the LLM
  only sees the most recent 20 messages per request. Older
  turns are folded into a summary or dropped, keeping the
  prompt bounded regardless of conversation length.
- ✅ **LLM summary compaction.** Triggered at `messageCount
  >= 30`. Fire-and-forget LLM call summarizes the oldest 10
  turns, stored on `CoachConversation.summary`. Future prompts
  prepend a system message with the summary so the coach
  remembers goals / programs / PRs past the sliding window.
- ✅ **Frontend hydration.** Page-load GET /coach/messages
  populates the chat panel from the server (was local-state only
  in v1.0.27). New sends invalidate the query. Clear button in
  the panel header. "thinking…" bubble during LLM call. Header
  chips: message count + "summarized" badge.

### 2026-07-07 session — v1.0.29 scroll-to-top + richer coach context

Commit `7c41fe1`, release
[v1.0.29](https://github.com/joshbowyer/fitquest-android/releases/tag/v1.0.29).
Tests 566 → 572 (6 new in `safeReadField.test.ts`).

- ✅ **Scroll-to-top on every sidebar nav.** Long pages used to
  land scrolled to the bottom (previous page's scroll position
  persisted). New `web/src/components/ScrollToTop.tsx` mounted at
  the top of App listens to react-router location changes and
  scrolls to top on every route change. Hash deep-links
  (`#class`, `#anchor`) still work — defers one frame + retries
  up to 10 times for the target to mount, then falls back to top.
- ✅ **AI Coach context ~3-4× richer.** Was ~500 tokens (hearts /
  streak / 7d workout count / avg sleep / today recovery). Now
  ~1500-2000 tokens covering last 5 workouts with exercise names
  + top sets + total sets + duration; per-night sleep for 7 local
  days; substance counts broken down (caffeine today,
  caffeine/alcohol/nicotine/electrolyte this week); latest weight
  + body fat + 14-day weight trend; last 5 habit logs + 7d pos/neg
  counts; yesterday's dailies + 7d completion rate; today's
  nutrition totals (cal/protein/carb/fat/meal count) + yesterday's
  calories; last 5 PRs; pending skill unlocks. Coach page
  sidebar now shows a "Coach also sees" section so the user can
  sanity-check what data is available.

### 2026-07-07 session — v1.0.28 /me resilience

Commit `ed3576a`, release [v1.0.28](https://github.com/joshbowyer/fitquest-android/releases/tag/v1.0.28).

- ✅ **`publicUser()` degrades gracefully on a missing-column
  migration mismatch.** When v1.0.27 added `User.coachPersonality`
  the migration file was written but `prisma migrate deploy` was
  not run before the next /me hit the live DB — every user got
  `PrismaClient P2022` (column does not exist) on every /auth/me
  for ~25 minutes and was kicked to /login. New `safeReadField()`
  helper wraps user-row property reads + a fallback DB select in
  try/catch that swallows P2022 specifically (logs a warning so
  the missing-migration is visible) and returns the fallback.
  Real Prisma errors still propagate. Runbook note added in the
  helper comment: `npx prisma migrate deploy` after each new
  migration file.

### 2026-07-07 session — v1.0.27 AI Coach scaffold

Commit `cd46826`, release
[v1.0.27](https://github.com/joshbowyer/fitquest-android/releases/tag/v1.0.27).
Tests 554 → 566 (12 new in `coach.test.ts`).

- ✅ **`/coach` page + personality picker.** New nav entry
  (icon ✺), chat layout (messages + textarea), 5 personality
  presets (PRIEST_BODYBUILDER, BOB_ROSS, DRILL_SERGEANT, ZOOMER,
  GENERIC), Shift+Enter newline / Enter sends. Personality choice
  persists via PATCH /coach/personality; default for new users is
  PRIEST_BODYBUILDER (the FitQuest voice).
- ✅ **Backend prompt seeding.** `api/src/lib/coach.ts`
  composes each SYSTEM_PROMPT from a shared preamble + a
  per-personality voice block + FitQuest world context (6 classes,
  CASUAL/HARDCORE, heart system, skill tree). `gatherCoachContext`
  builds a ~500-token JSON user-context block per request (class,
  level, mode, hearts, last-7d workouts/sleep/PRs, streak,
  recovery) — same lazy-gather pattern as morningReport.
- ✅ **Routes.** GET /coach (meta + contextSummary), POST /coach
  (non-streaming chat, matches every other LLM endpoint),
  PATCH /coach/personality. `'coach'` added to `LlmTask` union
  so future per-task model overrides can route coach specifically.
  POST returns 422 with `llm_not_configured` if the admin hasn't
  set up the LLM yet (page shows a disabled input).
- ✅ **Schema.** New `CoachPersonality` enum + `User.coachPersonality`
  nullable column + migration. `publicUser()` exposes it on every
  /me read so the picker reflects saved state across devices.

**Deliberately deferred** (will follow once the v1 is bedded in):
- Admin-side per-personality prompt overrides on
  `LlmConfig.coachSystemPromptOverrides`
- Server-side conversation history (`CoachMessage` table + GET
  /coach/messages for the page to hydrate on reload)
- Streaming responses (would need SSE plumbing in the api +
  EventSource consumption on the web — same work the morning
  report's regenerate could benefit from)
- Per-message personality override (separate from the user's
  global choice) — defer until there's a real use case

### 2026-07-07 session — v1.0.26 P1.5 follow-ups

Commit `aeac6a7`, release [v1.0.26](https://github.com/joshbowyer/fitquest-android/releases/tag/v1.0.26).
Tests 546 → 554 (8 new).

- ✅ **Breach kills actually drop Soulstones now.** `claimKill()`
  was returning `reward.soulstones` to the caller (and showing it
  in the victory modal) while the actual insert path targeted a
  `UserBreachProgress.soulstones` column that was dropped in
  `021082d` — PrismaClientValidationError on every claim since.
  Now: claimKill rolls the count from `TIER_SOULSTONES`, creates
  matching `Soulstone` rows (24h TTL, bossName=boss.name,
  bossTier=numeric per cosmetic-sort map) in a transaction with
  the gold/xp increment. 3 regression tests.
- ✅ **`/skills/unlock` response reports the actual grant.** The
  unlock toast was showing the raw bonus ("+50 XP") even when
  the 0-heart Hardcore multiplier paid out ×0. `reward.xp/gold`
  now reflect the actual grant; `bonusXp/bonusGold/multiplier`
  added for any future UI that wants both. Response shape
  unchanged on the read path.
- ✅ **`POST /bosses/:worldId/damage` capped at 25% boss.maxHp per
  request.** The schema rejected damage > 10000 but a 1.3×
  Juggernaut mult could still one-shot a boss. The authoritative
  damage path is the workout-commit hook; this endpoint is the
  manual tap and now takes at least 4 real attacks to kill any
  boss.
- ✅ **DST micro-issues fixed.** `localNightStartInTz` now steps
  back in date-space (one calendar day) instead of instant-space
  (−24h) so a 00:30 CDT sleep onset on spring-forward no longer
  buckets to Saturday. `getWeighInStreak` + `getMetricStreak`
  switched the "today or yesterday" check from UTC-instant
  equality to day-key string comparison — on the 25h fall-back
  day, "yesterday's local midnight" via −24h sat 23h before
  today's, the exact ms equality missed, and the streak dropped
  to 0. 5 regression tests (1 sleep-onset + 3 streak).

### 2026-07-07 session — the bug hunt (v1.0.24 + v1.0.25)

Full tsc-triage + logic audit: all 642 accumulated type errors
triaged (92 web / 550 api), ~35 real bugs fixed across two
rounds, 546 api tests green (was 529 passing / 9 failing).
Commits `59b4289` → `a410a86`; releases
[v1.0.24](https://github.com/joshbowyer/fitquest-android/releases/tag/v1.0.24)
(icon alignment) +
[v1.0.25](https://github.com/joshbowyer/fitquest-android/releases/tag/v1.0.25)
(bug squash).

- ✅ **Skill-tree icon Y alignment — root cause** (`59b4289`).
  1-line vs 2-line skill names → variable button heights →
  `items-center` in the stretched chain row pushed short
  buttons ~4px down. Top-anchored nodes + fixed 2-line name box
  + connector pinned at the icon center from the TOP. SVG icons
  normalized to 28px matching the calitree PNG masks.
- ✅ **CI: v\* tag image builds fixed** (`2ddd068`). Merge job
  expected `-amd64/-arm64` suffixed semver tags the build job
  never pushed (every tag run failed); `:main` was stuck
  single-arch forever; `flavor: latest=auto` let both arch
  builds race an unsuffixed `:latest`. All tags are now
  per-arch in the build job; the merge job owns every shared
  multi-arch tag.
- ✅ **Round 1 — 22 mechanical bugs** (`7a24e0a`). Page crashes:
  Dashboard (missing usePullToRefresh import — main tab
  white-screened), Achievements (`a.s.points` reducer),
  Nutrition add-item modal (missing react/react-dom imports +
  createPortal without container), cardio logging (missing
  distanceInputToKm import). API crashes: correlations feature +
  nightly cron (8 builders closed over nonexistent `tz`),
  workouts bulk-delete (`reply` not in handler signature), USCCB
  readings fallback (undefined `dayUrl`). Dead features revived:
  Weekly Examen modal (Modal never got `open`), Breach "Claim
  victory" (useMutation RESULT passed as options — POST never
  fired), Android 8 AM reminder (payload not wrapped in
  `notifications: []`). Wrong values / data loss: imperial lb
  stored as kg from the Today quick-logger (WorkoutLogger
  mounted without user/units), `levelFromXp` factor-4 error
  (levels needed 4× the documented XP; bar pinned at 100%),
  `lastSundayMidnightUtc` returned Monday-of-previous-week for
  every UTC+ zone, `localMidnightUtc` 1h off on DST transition
  days (refinement pass + 6 regression tests), backup export
  silently dropped the ENTIRE food diary (mealEntries +
  referenced FoodItem catalog rows now exported; importer
  resolves catalog rows by natural key), LEGENDARY missing from
  the loot-tier walk (level-20+ legendary rolls dropped an
  arbitrary item), metricInsight prior-windows were duplicates
  of last-windows (LLM saw every metric as flat), morning
  espresso counted toward yesterday's caffeine cap, Profile
  geocoding errors invisible (`isError` on a hook exposing only
  `error`), red/orange quest worlds rendered cyan, NeonButton
  `title` + Panel `subtitle`/`id` silently dropped (11 dead
  tooltips, invisible subtitles, broken #class deep-link).
- ✅ **Round 1.5 — test-suite truthing.** morningReport
  buildPenalties referenced out-of-scope `opts`/`user`
  (ReferenceError for any hardcore user with heart-loss events);
  stale 5-heart copy ("halved", "/5") updated for the graduated
  10-heart system; heartMultiplier tests rewritten for the
  curve; classLock test was passing a removed `soulstones` user
  field (now passes the count arg + pinned `now` so the fixtures
  aren't a 2027 time bomb).
- ✅ **Round 2 — gameplay correctness** (`a410a86`). Hearts:
  regen anchor is ALWAYS a boundary instant — full-hearts reads
  used to drag it to `now`, un-anchoring the whole system (heart
  lost Wednesday regenerated next Wednesday-at-whenever);
  boundary counting in local-date space (DST/legacy-anchor
  proof); Casual hearts un-froze — +1/local-day regen and
  visual-only MISSED_WORKOUT drops per the mode.ts contract.
  Dailies sweep: a logged Workout row completes the WORKOUT
  built-in in BOTH the shield penance and heart-loss trigger
  (users who trained were losing a heart + 20 shield). Workout
  re-uploads (bridge restarts) are true no-ops — the upsert
  deduped the row but re-paid XP/gold and re-fired raid/breach/
  leak damage + penances on every re-POST. New `lib/award.ts`
  `awardXpGold()`: every reward path (dailies, habits, quests,
  world bosses, raid shares, skill unlocks) now applies the
  Hardcore heart multiplier + recomputes level — previously only
  workouts did either; negative deltas stay full-magnitude.
  Routine weeks + streakDomain are tz-local (Chicago Sunday-8pm
  workout no longer counts toward next week's goal). Raids:
  atomic HP decrement (concurrent members' damage was lost to
  read-modify-write), victory claimed by exactly one request
  (double-payout race), removed the unused
  `POST /raids/:id/contribute` side door (client-chosen damage,
  no multiplier, racy, wrote to a dropped column); pet raid XP
  ported to the workout victory path. Runtime crashes exposed by
  the prisma typing fix: world-boss first-defeat rewards
  (increment on nonexistent `User.soulstones` — now a 24h-TTL
  Soulstone row), quest auto-completion (stale `userId_levelId`
  unique key — now `userId_levelId_cycle` with per-world cycle),
  `/skills/calisthenics-progress` (`test:{not:null}` on a Json
  column — now `PrismaRuntime.AnyNull`), breach progress writes
  to the dropped `soulstones` column (threw on every new user's
  first Breach touch). Workout response now includes the leak
  damage it always computed.
- ✅ **Round 2 — security.** `POST /inventory/grant` admin-only
  (any user could mint any item); `POST /spiritual/readings-reseed`
  requires auth (arbitrary-date external-fetch amplifier);
  `POST /team-workouts/cleanup` requires auth AND the 15-min
  cleanup cron the file header always promised is actually wired
  in index.ts now (stale sessions/invites previously lingered
  forever).
- ✅ **Round 2 — type-safety net.** `lib/prisma.ts` exports real
  types for PrismaClient + all 25 enums (runtime requireCjs
  loading preserved) — restored typechecking on every Prisma
  query, which is what exposed the four runtime crashes above.
  Web: 63 remaining errors → **0**, dead `components/SkillNode.tsx`
  + test deleted, and the web Dockerfile's `tsc -b` is now a
  HARD build gate (no more shipping ReferenceErrors past a
  muzzled typecheck). API: 550 → 167 (rest is annotation noise —
  see P0).

### 2026-07-06 session (large)

- ✅ **Pending-unlock inbox re-checks prereqs on read.** The
  `/skills/pending-unlocks` endpoint just returned PENDING rows
  without re-validating them against the user's CURRENT unlocked
  set. If a row was created by an older matching pass before the
  class's prereqs were updated (e.g. PHANTOM was the first class
  to ship explicit per-skill prereqs; the other 5 classes came
  later), the row would still pop up in the inbox even though
  the current prereqs aren't met. The matching pass correctly
  checks prereqs at CREATION time (`findEligibleSkillUnlocks`),
  but stale rows could persist after a prereq update. Fix: the
  GET endpoint now re-checks `skill.prerequisites` against the
  user's current unlocked names; rows that don't pass are
  auto-dismissed (status='DISMISSED') so the inbox only ever
  surfaces skills the user can unlock right now. The
  /skills/unlock handler still does its own prereq check (returns
  400 "Requires: X" if unmet), so the inbox-side guard is a
  belt-and-suspenders against stale rows rather than the only
  check.
- ✅ **Barcode scanner (OpenFoodFacts lookup) on the food tracker.**
  Three scan paths dispatched at runtime: native
  @capacitor/barcode-scanner on Android (ML Kit under the
  hood, custom reticle overlay), @zxing/browser + webcam on
  desktop, and a manual numeric-entry fallback for headless
  machines. New `BarcodeScanner` component in
  `web/src/components/BarcodeScanner.tsx`; call site is the
  food panel's "Scan" button (sibling to "Ask AI" / "Manual"
  / "Recent foods"). On a successful scan, the decoded
  EAN/UPC strips non-digits and POSTs to the existing
  `GET /foods/barcode/:code` endpoint (`api/src/routes/
  foods.ts:271` was already there — no api change). On
  lookup success the result drops straight into the
  "edit + log" modal so the user can tune the serving size
  before it lands in /meals. 404 from OFF (regional
  brands not in their DB) shows a red banner and the
  user falls through to Search / Ask AI / Manual. The
  "Barcode scanner support is on hold" line in the food
  panel helper copy is gone.
  Android v1.0.14 wired the native plugin (SDK upgrade
  to minSdk 26 / compileSdk 36 / AGP 8.13 / Gradle 8.13);
  v1.0.15 fixed the plugin-name check (`CapacitorBarcodeScanner`
  not `BarcodeScanner`).
- ✅ **Berserker skill tree restructure.** Capacity + Hero
  WODs merged into one Capacity branch (Cindys kept, AMRAPs
  kept, Murphs demoted from T3 to T2 — "not T3 material").
  Added Sandbag branch (6 skills: bear-hug hold, clean to
  shoulder, bear-hug walk, clean+squat, sandbag load, T3
  god-tier sandbag-to-shoulder volume). Added Medicine
  Ball branch (6 skills, heavy 10/15/20kg throws + slams +
  clean+jerk — replacing the Hero WODs slot). Added
  Farmer's Carry T1+T2 to Kettlebell. "SL Stand" renamed
  to "Single-Leg Stand" (no acronym). Oracle "Meditation"
  branch renamed to "Ignatian Meditation" (Catholic
  framing — imaginative contemplation + the colloquy,
  not new-age). New cross+halo icon for the Ignatian
  branch. Final tree: 7 branches × 45 skills.
- ✅ **Profile: dedicated "Use 1 Soulstone to change class" modal.**
  Previously the only path was the "Use Soulstone to switch
  to X" button in the class-pick modal. New dedicated
  modal opens a separate flow: confirms, POSTs to new
  `/users/me/unlock-class` endpoint, consumes one Soulstone,
  resets `classChangedAt` to null. The class is then
  freely pickable via the regular class-pick modal (no
  second Soulstone charge). Loud error reporting + a
  fallback button that opens the class-pick modal if the
  api endpoint 404s.
- ✅ **TRACER no longer blanks the class-change modal.**
  `web/src/lib/types.ts:CLASS_EVOLUTION` was missing TRACER
  (api has had it since 2026-06; web was 5 of 6). Added
  the entry + a defensive `user.class && CLASS_EVOLUTION[user.class]`
  guard so future class additions don't crash the page.
- ✅ **Branch header icons all tinted to class color.**
  Previously branches with calitree PNGs were tinted via
  mask+`currentColor`; hand-coded SVG branches (Sprint,
  Throws, Run, etc.) inherited the default text color (white).
  TRACER had 3 yellow + 2 white. Now both paths share a
  single `classColorForClass(className)` wrapper so all
  branches in a class use the same hue.
- ✅ **Juggernaut icons redesigned.** Calitree.app has no
  good barbell PNGs (it was matching `OHP` to a handstand
  pushup, `Deadlift` to a cossack-squat, etc.). Dropped
  the calitree mappings, redesigned Squat/Press/Deadlift/
  OHP/Strongman as hand-coded barbell SVGs (lifeter +
  bar + plates in the right position for each movement).
  Also registered them in `BRANCH_ICONS` (they were never
  registered there before — only ever rendered via calitree
  PNGs).
- ✅ **Somatotype reacts to body-fat changes in real time.**
  `previewArchetype` was reading `user.bodyFatPct` (saved
  value) but `previewWeight` (draft value), so editing BF
  in the form had no effect on the archetype preview until
  save. Now both come from `numFromDraft(...)`; FFMI
  computed correctly as `weight × (1 - bf/100) / h²`.
- ✅ **`/api` and `/web` Docker images auto-rebuilt** on every
  push to main via `.github/workflows/build-images.yml`.
  Latest commit shipped: `65d7ea7` (after the @zxing/
  barcode-scanner fix). Multi-arch (amd64 + arm64),
  published to `ghcr.io/joshbowyer/fitquest-{api,web}`.
- ✅ **Android v1.0.13 → v1.0.15.** Class-change bug fix
  (TRACER evolution fallback), then the Android-side
  SDK upgrade to wire the native barcode plugin
  (minSdk 22→26, compileSdk 34→36, AGP 8.13, Gradle 8.13,
  +7 MB ML Kit AARs), then the plugin-name hotfix
  (v1.0.14 → v1.0.15). 12 Android releases total now
  published (v1.0.3 → v1.0.15).

### Older shipped work

- ✅ Barcode scanner (OpenFoodFacts lookup) on the food tracker.
  Three scan paths dispatched at runtime: native
  @capacitor/barcode-scanner on Android (ML Kit under the
  hood, custom reticle overlay), @zxing/browser + webcam on
  desktop, and a manual numeric-entry fallback for headless
  machines. New `BarcodeScanner` component in
  `web/src/components/BarcodeScanner.tsx`; call site is the
  food panel's "Scan" button (sibling to "Ask AI" / "Manual"
  / "Recent foods"). On a successful scan, the decoded
  EAN/UPC strips non-digits and POSTs to the existing
  `GET /foods/barcode/:code` endpoint (`api/src/routes/
  foods.ts:271` was already there — no api change). On
  lookup success the result drops straight into the
  "edit + log" modal so the user can tune the serving size
  before it lands in /meals. 404 from OFF (regional
  brands not in their DB) shows a red banner and the
  user falls through to Search / Ask AI / Manual. The
  "Barcode scanner support is on hold" line in the food
  panel helper copy is gone.
  Android-side setup lives in `fitquest-android/`:
  - `app/src/main/AndroidManifest.xml` — `CAMERA`
    permission + `android.hardware.camera` feature flag
    (optional, so installs without a camera still succeed).
  - `capacitor.settings.gradle` — `:capacitor-barcode-
    scanner` module include.
  Run `npx cap sync android` from `web/` to refresh
  `app/capacitor.build.gradle` against the new plugin, then
  rebuild the APK via the normal gradle path.
- ✅ Modal.tsx: portal-nuke on every parent re-render. The useEffect
  had `onClose` in its dep array; Dashboard.tsx (and other callers)
  passed inline `() => setX(null)` closures that recreated on every
  parent render. The effect's cleanup removed all `[data-modal-portal]`
  nodes — so any open modal disappeared on the next re-render. The
  most visible victim was the dashboard's radial gauges: click
  set state, the next query tick re-rendered, the modal vanished
  mid-open. Fixed by capturing the latest onClose via ref, dropping
  it from the dep array, and only nuking orphaned portals on the
  open → closed transition (deferred one frame so React's own
  unmount has first crack). Fixes every Modal call site in the
  app (24 usages) at once.
- ✅ HeartsCard → lime-green HP bar (replaces red ♥ glyphs).
  Mirrors the hero-bar HP pill in Layout.tsx (bg-neon-lime fill, ink
  track, `animate-heart-warn` pulse at ≤3). Both Casual and Hardcore
  modes — Casual shows a permanently-full bar + "switch to Hardcore"
  hint; Hardcore shows live 0-10 + urgency message. Multiplier and
  regen explainer kept below the bar. ROADMAP entry above under
  Gamification & Economy.
- ✅ L-Sit radial visual diff. Was falling through to the plain
  Gauge (no zones, no warn/elite coloring) because it was in
  `monotonicMetricKeys` but missing from `METRIC_MONOTONIC_BANDS`.
  Added bands entry (elite ≥1:00, healthy ≥0:30, max 3:00) — now
  renders with the same lime/cyan/amber zone backgrounds as plank
  and dead-hang.
- ✅ BICEP → BICEP_FLEXED + BICEP_RELAXED split. New enum values
  added via migration `20260706000000_bicep_split_flexed_relaxed`;
  existing Measurement + GeneticMax rows migrated to BICEP_FLEXED
  (convention is to measure flexed). Casey Butt formula gives
  ~16.2cm ceiling for a 6" wrist; relaxed uses the same formula
  × 0.92 (~14.9cm) since relaxed is ~1.5-2cm smaller for the same
  arm. bicep_40 / bicep_45 achievements now point at BICEP_FLEXED
  (relaxed would let users game the thresholds). Both new metrics
  surfaced in /measurements (separate sidebar entries), /profile
  preview maxes (two rows), /bodycomp (two chart series), and the
  dashboard's HYPERTROPHY gauges (8 gauges → wraps to 2 rows on
  lg). BICEP retained as a legacy alias in the enum (Postgres
  can't drop enum values without recreating the type).
- ✅ Body-fat method picker. New `BodyfatMethodPicker` modal with
  4 methods (DEXA / BIA / Calipers 3-site Jackson-Pollock / Navy
  tape) — JP3 + Navy are sex-aware (men vs women sites / hip
  requirement). Computes %BF client-side via
  `web/src/lib/bodyfat.ts` + `api/src/lib/bodyfat.ts` (formulas
  mirrored so the api could recompute later if needed). Submits
  to `POST /measurements` with the chosen `source` field
  (CALIPERS / BIA / DEXA / NAVY_TAPE) so the morning report's
  confidence weighting applies. 14 vitest tests on the formulas
  pass. Schema's existing `Measurement.source` column (which the
  api's CreateSchema wasn't accepting before) is now wired up.
  Hooked into MetricDetailModal (BODY_FAT_PCT row) and Profile
  (button next to the simple bodyfat input).
- ✅ Android sync mechanism. `scripts/sync-android.sh` (parent
  repo) wraps `../fitquest-android/scripts/sync-android.sh` so the
  Android wrapper stays in sync with web/api changes. Walks the
  parent repo's git log since the last Android bump, categorises
  by conventional-commit prefix, writes CHANGELOG.md +
  RELEASE_NOTES_vX.Y.Z.md. Does NOT run gradle / sign / publish —
  those stay manual per the user's "don't build yet" guardrail.
  v1.0.3 shipped to
  [GitHub releases](https://github.com/joshbowyer/fitquest-android/releases/tag/v1.0.3).
- ✅ Sex picker: MALE/FEMALE only. Dropped the OTHER/non-binary
  option AND the empty-value "prefer not to say" option from
  /profile — body-fat formulas (Jackson-Pollock, Navy tape)
  only have validated forms for those two sexes, and the empty
  default would silently fall through to the male formula
  without telling the user. The api's Sex enum still accepts
  OTHER (legacy rows + backend compat); users with OTHER fall
  through to the male formula at the picker.
- ✅ RHR gauge: IdealGauge routing + genetic-max=70 (was 45).
  The previous "11% OVER" false-positive for a logged RHR of
  50 was caused by the basic Gauge reading 50 against a max of
  45 (the best-achievable floor). Fixed by: (a) routing RHR
  through IdealGauge with bands 40-50 elite / 50-60 healthy /
  60-70 warn / 70+ far; (b) changing `computeGeneticMax
  ('RESTING_HR', ...)` to return 70 (the unhealthy threshold).
  Pinned with two new vitest assertions in geneticMax.test.ts.
- ✅ /measurements: 2-col collapsible category cards. The 260px
  sidebar is gone; 8 categories render as a 2-col grid of
  cards, each with a header (label + metric count + chevron)
  and a body listing the metrics. Category containing the
  selected metric auto-expands; others stay collapsed. Accent
  matches the /dashboard stat-sheet colour for the same
  category.
- ✅ Habit tile visual state. /habits page tile now renders
  unchecked as neutral gray; when checked (todayCount > 0)
  the whole tile lights up in the accent color. Lime for
  POSITIVE habits, magenta for NEGATIVE. Same logic for the
  tile, icon box, and title text. HabitsWidget on /dashboard
  was already correct (no change needed there).
- ✅ Web Audio node leak (root cause of desktop memory bloat).
  Every sound primitive in `web/src/lib/soundBus.ts` (playPad,
  playPluck, playLaser, playNoiseHit, playKick, playFile)
  created oscillator/buffer-source + biquad-filter + gain nodes
  and called `o.stop()` at the note's end but never
  `disconnect()`. Web Audio nodes retain references through their
  connection graph until something disconnects them — a session
  of ~100 sounds accumulated 300-500 retained nodes, forcing GC
  pressure the browser couldn't resolve mid-session. Fix: a
  `scheduleDisconnect(triggerNode, allNodes)` helper wires
  `onended` to disconnect the whole chain. The first oscillator
  in a voice is the natural anchor — when it stops, every
  upstream node is also done. playFile (the MP3 path) gets the
  same treatment.

- ✅ Server-UTC bug: app was rolling non-UTC users over to
  tomorrow. The api container runs in UTC; 17 places across
  11 files used server-local time (`new Date().setHours(0,0,0,0)`,
  `new Date().getDay()`, `new Date().toISOString().slice(0,10)`,
  `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) where the
  user's IANA timezone was needed. Fixed in three commits:
  `aff9368` (dailies.ts / morningReport.ts / habits.ts /
  supplements.ts / substances.ts / insights.ts / recovery.ts /
  streaks.ts — the user-reported "rolled to tomorrow" symptom
  + 7 related critical bugs), `762cf9c` (correlations.ts /
  breach.ts / achievements.ts / quest.ts / macroNudges.ts /
  metricInsight.ts — deeper per-row day-key drift in analytics),
  and `3b8ad9a` (classLock.ts — birthday anniversary, the
  last of the sweep). Added `localDayKey(d, tz)` to
  `api/src/lib/timezone.ts` as the canonical per-row bucket
  key. The user's profile timezone (`User.timezone`) now
  drives every day boundary. (One pre-existing test failure
  on both this branch and main: `classLock.test.ts` "returns
  { useSoulstone: true } when locked but user has a soulstone"
  — the test puts `soulstones: 1` on the user object but
  `assertCanChangeClass` reads `soulstoneCount` from its own
  parameter, default 0. Filed for follow-up.)
- ✅ PainCard on /today stuck at loading. The `since` query
  param was being computed inline on every render
  (`new Date(Date.now() - 30d).toISOString()`), so the
  queryKey changed on every render → react-query treated each
  render as a brand-new query → perpetual loading. Fixed
  with `useMemo(() => ..., [])` so `since` is captured once
  on mount. (`f718b5f`)
- ✅ Capacitor APK favicon too big for adaptive-icon safe
  zone. Triangle was 20x20 of a 32x32 viewBox (62.5%); the
  farthest point from center was ~14 units, well outside
  Android's inner-33dp safe-zone radius (~9.78 in viewBox
  units), so launcher shapes clipped the tips. Scaled to
  12x12 (38% of canvas), cyan dot from r=2.5 → r=1.6.
  All 5 mipmap densities + adaptive-icon foreground
  regenerated via `scripts/render-app-icons.py`. Shipped
  as `fitquest-android` v1.0.1. (`e2a87ce`)
- ✅ Capacitor APK: login worked but most data-fetch routes 401'd.
  Commit `ba5f740` ("share session cookie across subdomains") added
  `domain` + `sameSite: 'none'` to `setTrustedDeviceCookie` so the
  trusted-device cookie could cross between sibling vhosts, but the
  comment literally said *"Match setSessionCookie's domain"* while
  the session cookie itself never got the matching fields — so the
  session cookie stayed host-only. In the Capacitor APK's WebView at
  `https://localhost`, login set the cookie on whichever vhost the
  login POST hit (e.g. `fitquest-api.joshbullock.net`), but most
  subsequent fetches went cross-host and the browser refused to send
  the host-only cookie → 401. Applied the matching `domain:
  process.env.API_COOKIE_DOMAIN ?? ''` + `sameSite: config.isDev ?
  'lax' : 'none'` to `setSessionCookie` so both cookies share the
  same parent-domain scope and are actually sent cross-site.
  Documented `API_COOKIE_DOMAIN` in `.env.example` as REQUIRED for
  any deployment with sibling api+web vhosts (silent fallback to
  host-only was the original bug). Also added `GET /_debug/req` to
  the api: an `onRequest`/`onResponse` hook pair captures the most
  recent incoming request (path/method/cookies/status/UA) and logs
  every request as a one-liner — used to confirm the fix, retained
  for future 401-hunting. Commits `0ef4542` (fix) and `2b3edc1`
  (diagnostic).
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

(was: sound/audio system — shipped, see Dropped section.)
(was: web push notifications — moved to Backlog → Mobile & UX
as a real, scoped item with the Notification API + Web Push
detail.)