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
- **Android sync:** `scripts/sync-android.sh` (in this repo) wraps
  the script at `../fitquest-android/scripts/sync-android.sh` so the
  Android wrapper doesn't go stale when web/api ships. Run from
  this repo after merging web/api changes:
  ```
  ./scripts/sync-android.sh          # refresh CHANGELOG + release notes for current version
  BUMP=1 ./scripts/sync-android.sh   # auto-bump patch (X.Y.Z → X.Y.(Z+1)) + refresh notes
  NEXT_VERSION=1.0.4 ./scripts/sync-android.sh
  ```
  The script categorises the parent repo's recent commits by
  conventional-commit prefix (feat / fix / polish / etc), updates
  `CHANGELOG.md` and writes a `RELEASE_NOTES_vX.Y.Z.md` draft
  ready for `gh release create`. It does NOT run gradle, sign, or
  publish — those stay manual. **v1.0.3 hasn't been published yet**
  even though `app/build.gradle` claims it (the parent repo had no
  shipped changes since v1.0.2 when the bump commit landed). Run the
  sync script + the gradle build when ready to ship.
- **Android release: v1.0.3 is staged but not yet published.**
  Once v1.0.3 changes ship here, build the APK with:
  ```
  cd /home/josh-claw-code/FitnessStats/web && npx vite build
  cd /home/josh-claw-code/FitnessStats/web && npx cap sync android
  cd /home/josh-claw-code/fitquest-android && ./gradlew assembleRelease
  ```
  Output: `app/build/outputs/apk/release/app-release-unsigned.apk`.
  The APK is **unsigned** — no release keystore in
  `app/build.gradle`. For Play Store distribution we'd need to
  add a `signingConfigs { release { ... } }` block + a keystore.
  For internal / sideload distribution the unsigned APK works
  as-is. Publish via:
  ```
  gh release create v1.0.3 RELEASE_NOTES_v1.0.3.md \
    app/build/outputs/apk/release/app-release.apk
  ```


## Active (in progress)

### Pet feature (German Shepherd v1)

- Pet schema, 3 breed sprites (gs/akita/axolotl), /pet roster
  with multi-pet support (up to 6), /shop with food purchases,
  workout XP removed (food is primary; combat XP is secondary
  gated to Lv15+ deployed), and combat hooks in breach/quest/raid.
- v15/v17/v18 goggled armored + injured variants shipped to
  `web/public/sprites/pets/`. All three animals have Pit Viper
  goggles (intact on armed, broken on injured). Axolotl
  injured (v18) has a sad frown, not angry.
- (was: prereq enforcement on skill tree — both matching
  pass and unlock endpoint gate on `isSnowCode`-style
  prereq filter. "Push-Ups" matching "Pike Push-Ups" reported
  by the user was a misperception; one T1 Pull was unlocked,
  T2 was correctly offered. Loose matching (multiple
  skills per exercise) is documented in RECIPES.md §14 as
  a separate fix pass.)
- (was: set-as-primary button click "does nothing" — was the
  cache-update path not re-rendering. Rewrote in `1b527c9`
  to bypass useMutation: direct `api<>()` call writes the
  response into the query cache via `setQueryData`, with
  an `invalidateQueries` as belt-and-suspenders. Active-pet
  selection now defaults to a non-primary pet so the button
  is visible on first load.)
- (was: modal ghosting on mobile — `d723cef` adds a defensive
  portal-node cleanup, explicit body scroll lock, and inline
  backdrop-filter style. Affects every Modal use site.)

### Forecast page (`/forecast`)

- Mostly built. Nothing outstanding — all known forecast
  issues are resolved:
  - (was: 3-day forecast on mobile too squished — shipped in
    `95dfa2b`, vertical stack on narrow viewports)
  - (was: recommended-muscle block on /forecast — moved to
    /status side-by-side with recovery in `95dfa2b`)
  - (was: forecast "Heavy snow" snow-code bug in Atlanta
    summer — fixed in `01725b7`; WMO codes 80-82 were matching
    the snow range 71-86. Now uses `isSnowCode()` helper)
  - (was: "feels like" temperature — already shown in the
    current weather card as `feels {apparentTemperature}°` using
    Open-Meteo's `apparent_temperature` field, which it DOES
    expose in its current API. The roadmap item was based on a
    misremembered limitation.)

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

- **Reorganize nav menu items on mobile.** Currently drag-to-
  reorder only works on the desktop sidebar. The mobile
  overlay should support the same.
- **Galaxy map on mobile is too small + mis-aligned.** Map
  should be full-width on mobile, and the "Class:" / "Portal:"
  text labels should drop below the map instead of sitting to
  its right (the right-side stack doesn't fit at narrow widths).
- **Remove the "⚙ Settings" button from the top of /dashboard.**
  Settings already lives in the sidebar — the dashboard
  duplicate is dead weight.
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
- **HeartsCard → HP bar swap.** The hero-bar header in
  Layout.tsx was switched to a green HP bar in `2a136f` so
  pets (which read the same User.hearts value) and the user
  would see one consistent bar. The dashboard's HeartsCard
  was left with red ♥ glyphs (rose filled, dark gray empty),
  which now reads as a different visual element instead of
  the same HP. Swap the glyphs for a lime-green HP bar
  matching the hero bar (same `bg-neon-lime` fill, ink track,
  `animate-heart-warn` pulse at ≤3). Both Casual and Hardcore
  modes — Casual shows a permanently-full bar + the
  "switch to Hardcore" hint; Hardcore shows the live 0-10
  bar + the urgency message. Keeps the multiplier and the
  regen explainer text below. Pending unlock cards (skill
  tree, etc.) keep the red ♥ glyphs — that's a different
  visual (unlock badges), not an HP indicator.
- (was: Calendar view — shipped in `cd16301` + `2309089` +
  `26d95a7`. `/calendar` is a month grid + per-day recap that
  shows workouts, weigh-ins, pain, habits, dailies, and the
  morning popup / recovery score for the chosen day. Day cells
  have color-coded X/Y boxes, future dates render as empty
  gray. Strikethrough-strikethrough on done items.)

### Measurements

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
- **Remove v-taper (`SHOULDER_WAIST_RATIO`) from the
  /measurements sidebar.** It's already in `NEVER_SURFACED`
  (filtered out of check-ins + dashboard) because it's
  auto-computed from shoulders ÷ waist. But the /measurements
  page renders `METRICS_BY_CATEGORY` directly and still
  includes it as a manual entry. Drop it from the sidebar —
  it's surfaced in the dashboard's body-comp radials and
  recomputed automatically.
- **Split /measurements into category cards (2 per row).**
  Currently the sidebar is a single column of category groups
  stacked vertically — a long scroll on tall viewports. Render
  it as a 2-column grid of category cards (HYPERTROPHY +
  STRENGTH in row 1, BODY_COMP + CARDIO in row 2, etc),
  each card collapsible with a header label + count of
  metrics inside. Mirrors the morning/evening/weekly check-in
  block layout for visual consistency.
- **Resting HR radial is broken + wrong range.** The RHR
  gauge currently uses `meta.defaultMin (50)` as min and
  `defaultMin × 1.5 (75)` as max — so the dial range is 50..75,
  and a logged RHR of 50 (typical healthy user) reads as the
  *start* of the dial but with the max = genetic max for
  RHR = 45 (the genetic-max formula returns the *best
  achievable* floor, not the upper bound). Result: a logged
  50 reads as "11% over" because 50 > 45. Three fixes
  (separate but related):
  1. **Switch RHR to an IdealGauge (ideal-in-the-middle).**
     Bands: `40-50 elite`, `50-60 healthy`, `60-70 warn`,
     `70+ far`. Add to `idealMetricKeys` in Dashboard.tsx
     and add the band config to `metricBands.ts`.
  2. **Fix the generic `Gauge` component's "X% OVER"
     warning.** Currently any value above the dial max shows
     "! X% OVER" in magenta. For "more is better" metrics
     this is correct, but for "less is better" metrics
     (RHR, 1mi/5K, etc) exceeding the max means the user
     *out-performed* the dial — celebrate, don't warn. Gate
     the warning behind a `lessIsBetter` prop or only show
     it when the value is more than ~2× the max (genuine
     data-entry error).
  3. **Fix the RHR genetic-max formula.** Currently returns
     45 (the "best achievable" floor). It should return the
     *unhealthy threshold* (70-75), which is what the gauge
     max should be. Adjust `computeGeneticMax('RESTING_HR', ...)`
     in `api/src/lib/geneticMax.ts` to return 70 (or an
     age-adjusted equivalent).
- **L-Sit radial is visually different from other calisthenics
  gauges.** User reports L-Sit renders distinctly from
  plank / push-up / pull-up / dead-hang. Most likely cause:
  the L_SIT_HOLD defaultMin is `5` (seconds) and the dial
  range ends up `5..7.5` — every realistic value (10s+) clamps
  to max and triggers the "! X% OVER" warning, which is a
  magenta ribbon the other gauges don't show. Fixing the
  "X% OVER" warning above (suppress for less-is-better +
  gate behind a sane threshold) resolves this naturally.
  Verify with all five calisthenics radials side-by-side once
  fixed.
- **Alternate bodyfat inputs (calipers / DEXA / BIA / Navy
  tape).** Bodyfat is currently only one numeric input. Let
  the user pick a method and enter method-specific values:
  - **Caliper (3-site or 7-site):** mm readings → bodyfat % via
    Jackson-Pollock formula. UI shows which 3 sites to pinch
    (chest + abdomen + thigh for men, triceps + suprailium +
    thigh for women) with a tip: "measure in the morning, the
    day after fasting, ideally before training — water weight
    swings can shift the reading 2-3%."
  - **DEXA:** enter the bodyfat % directly from the scan
    report. "Use the most recent scan within the last 90 days."
  - **BIA (scale or handheld):** enter bodyfat % from the
    device. "Best taken fasted, same time of day each week."
  - **Navy tape method:** waist + neck + (height for women) →
    bodyfat %. UI explains the formula and that women need
    hip measurement too.
  - Hook into the existing radial on the dashboard + any
    other bodyfat entry point as a popup modal that picks
    method then asks for the inputs.
- **Split `BICEP` into `BICEP_RELAXED` and `BICEP_FLEXED`.**
  Same migration shape as the existing `WAIST` / `NECK`
  enum expansion. Schema change + UI for picking which one
  the user is logging.
- **Re-examine neck circumference genetic-max logic.** Current
  code uses the user's current neck measurement as their
  genetic max — wrong because neck can definitely grow with
  trap development. Either: (a) treat neck like other
  measurements and let it track freely, (b) default to a
  population baseline (e.g. 40cm / 15.75in) if no historical
  peak exists. Compare with how wrist/ankle handle this.
- **Body weight graph zoom (`yPad`).** Currently `+-20` — the
  user wants `+-10` so the trend line is more readable.
- **Body measurement photos with diff.** Upload a photo
  alongside a measurement (or independently) and have a
  side-by-side view that highlights the change vs. the
  previous photo (overlay diff or just a slider to fade
  between the two). Storage: S3-compatible or local disk;
  probably needs a new migration for `MeasurementPhoto` rows
  tied to the parent measurement.

### Habits

- **Habit tile visual state.** Default = neutral gray box.
  Once checked = full green tint (whole tile), with the
  check button itself also green. Negative habits similarly:
  default gray, once crossed-off → red tint. Right now the
  positive / negative split colors the unchecked state which
  is wrong (it implies the user has done the habit before
  they've actually done it today).

### Homebase / Penance

- **Restructure the penance templates panel.** Three changes:
  1. **Drop the checkboxes from the templates section.**
     They're not interactive — they read like a "click here
     to enable" affordance, but they're just labels. Replace
     with a small "active now" badge on rows that are
     currently firing.
  2. **Split into two sub-blocks.** "Shield damage" (the
     negative triggers — missed dailies, no recovery, etc.)
     and "Shield repair" (the positive triggers — completed
     dailies, logged recovery, etc.). Two semantic columns,
     not one mixed list.
  3. **Both sub-blocks start collapsed.** Currently the whole
     panel is open by default — it's the longest single block
     on `/homebase` and drowns the actual shield status at
     the top. Collapse-by-default lets the user drill in
     when curious.

### Portal Leaks

- **Leaks should not expire.** Stacking already works (no
  short-circuit on new spawn) but `tickLeakGrowth` still marks
  leaks past the 48h TTL as `EXPIRED`. User wants leaks to
  persist until killed — they're punishment for the user's
  slippage, and expiring them softens that. Drops the daily
  tick's "expire" branch; growth-tick (HP +8/day) stays. The
  8 HP/day escalation already makes neglected leaks worse
  than fresh ones, so there's still a soft self-balancing
  mechanism.

## Stretch / Future

- **AI coach / HUD with selectable personalities.** Pick a
  voice and the LLM system prompt + tone changes
  accordingly. Personality presets (mix-and-match
  intensity × religious-secular × silly-serious, not all
  four corners need to be filled):
  - **Slightly intense priest bodybuilder** — uses Catholic /
    monastic imagery mixed with hypertrophy talk. "Your
    shoulders are a yoke — load them and reap."
  - **Bob Ross / Mr. Rogers gentle** — extremely soft,
    affirming, never negative. "We'll just add a little
    happy little set here."
  - **Drill sergeant** — direct but not gratuitously
    foul-mouthed. No "drop and give me twenty" trope.
  - **Minmaxxing zoomer / Zyzz bro** — subcultural gym-bro
    slang. "Aesthetic. We pump. We shrek. We wither the
    rec."
  - **Stereotypical AI personal health assistant** — generic
    polite. "I've noticed your sleep was below your 7-day
    average — would you like to discuss?"
  - The selection is per-user (saved on User, default = the
    last one picked). Backend: add a `coachPersonality`
    enum to User; the admin's existing LLM config gets a
    `coachSystemPromptOverrides` map keyed by personality.
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
- ~~Nutrition tracker enhancements — barcode lookup,
  restaurant menu scan~~ — superseded by the Ask-AI multi-
  entry flow (`/foods/ask-ai-multi`) which estimates macros
  from a free-text description. Barcode / menu-scan were nice-
  to-haves but the AI path covers most of the use case with
  zero extra infrastructure. Revisit if a specific user
  request comes in.
- ~~Email verification + password reset.~~ No email integration
  in this app. Dropped per user direction.

## Recently Fixed / Resolved

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
  v1.0.3 already has a CHANGELOG + release-notes draft ready; once
  the user wants to ship, the path is documented in the new
  "Operations → Android sync" block above.

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