# FitQuest Roadmap

> Audited against the actual codebase — every "done" item has
> working code reachable via a URL. "Outstanding" items are sized
> + scoped for the next session.
>
> **Reconciled and deduplicated on 2026-07-14** (supersedes the
> 2026-07-09 pass). "Outstanding" below is the single source of
> truth — section + tier ordering reflects priorities as of this
> audit, file:line hints are the entry points for sizing, and no
> re-derivation is needed on the next pass.

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
Each item has a one-line scope + a file/line hint. Detailed
notes + history live in "Stopped Short / Partial
Implementations" below; the "(was: ...)" entries there and
in "Recently Fixed / Resolved" are the changelog of what got
shipped.

### P0 — quick wins

~~API type-error backlog → 0, then flip the api Dockerfile
typecheck gate~~ — **closed 2026-07-14.** The 170-error backlog
(re-verified count, not the unmeasured "345" some commit
messages had claimed) was paid down to a confirmed 0 across
`src/lib/import.ts` (42), `routes/workouts.ts` (9),
`lib/sleepCorrelation.ts` (8), 8 more `lib/*.ts` files, 8
`routes/*.ts` files, and ~19 test files — real type-narrowing
throughout (guards before array/date-component indexing, a
handful of narrow `Prisma.XUncheckedCreateInput` casts on
`import.ts`'s account-restore path, a couple of genuinely-wrong
Prisma JSON-null spellings), no blanket `as any` suppression.
`api/Dockerfile:48`'s `tsc -p tsconfig.json` step no longer has
`|| true` — matches the web image's existing hard gate. Verified
via a from-scratch `tsc -p tsconfig.json` (0 errors) and
`vitest run` (790/791, only the pre-existing unrelated failure
below) before flipping the gate.

~~Trivial stale-comment fixes~~ and ~~delete dead `LEAK_TTL_MS`
constant~~ — **both shipped 2026-07-11** (`f64715d`), see
Recently Fixed below.

~~`DailyLog` idempotency test failed on a local-day boundary~~ —
**fixed 2026-07-14.** Root cause found: `routes/import.ts`'s
`persist()` computed its DailyLog dedup window (`todayLocal`)
ONCE, from real wall-clock "now", instead of per-workout from
each `w.startTime`. FIT imports are routinely backdated (a user
importing last month's rides), so the dedup check could never
find the log a historical import had already created for its
own day — every re-import of old data minted a fresh duplicate
WORKOUT `DailyLog` (double/triple XP+gold for the same
historical day). Fixed: the day-bucket bounds are now computed
per-workout from `w.startTime`, with both a `gte` AND `lt`
bound (matches the `dailies.ts` `/complete` endpoint's existing
day-bucketing convention) instead of the prior open-ended
`gte`-only real-"today" check. `api/src/__tests__/import.test.ts:412`
now passes; full suite 791/791.

### P1 — feature work

- **Medical metrics UI.** Surface existing RHR / sleep / stress
  for medical history. Schema has the data but no medical-
  themed UI (no "history of resting HR" chart, no BP log
  form). Starting point: the existing /measurements tiles.
- **Personal records aggregated page.** `/prs/WorkoutDetail`
  shows individual PRs only — no "all my PRs over time"
  chart view.
- **AI Coach streaming (SSE).** Fixes 502s on long calls
  (`web/src/pages/Coach.tsx:18-26`). Real fix needs server
  SSE + client EventSource + abort-on-navigate. ~2-3 days.
- **Email verification / self-serve password reset.**
  `api/src/routes/auth.ts:95-96` — currently admin-only reset
  path; users who forget passwords are stuck, and there's no
  self-serve password change in /profile. Depends on a mail
  provider.
- **OpenFoodFacts v2 search upgrade.** `api/src/lib/
  openfoodfacts.ts:187-212` — current search via the legacy
  cgi endpoint is capped at 5 items (rate-limited as a
  result). Hours to test v2, a day if the API shape diff
  needs handling.
- **Sprite fallback for missing item art.** `web/src/pages/
  Inventory.tsx:334-335` — a few legacy items still use
  `gear/<class>/<slot>.png` paths that don't all exist.
  Hours (regen sprites or fix paths).
- ◐ **Substance over-use caps (PARTIAL).** Penalty COPY
  shipped (over-cap entries correctly emit
  `HeartLossEvent`; `heartMultiplier` downstream reduces XP
  + gold). Actual per-substance HRV / XP multipliers at
  award time remain DEFERRED — pending a product decision on
  magnitude + cap structure.

### P2 — bigger features

- **Gold economy / "stuff to spend gold on."** Cosmetic
  weapons / armor sets (equippable, with set bonuses),
  holiday / seasonal items, UI themes (color palettes for
  the neon glow). All cosmetic unless we design a real
  prestige system.
- **Body measurement photos with diff.** Side-by-side /
  overlay / fade-slider vs the previous photo. Needs a
  `MeasurementPhoto` migration + storage (S3-compatible or
  local disk).
- **Pets: breed stock rotation.** `api/prisma/seed-pets.ts:7`,
  `api/src/routes/shop.ts:210-218` — schema has
  `availableFrom` / `availableTo` columns
  (`schema.prisma:2980-2981`); the API doesn't consume them
  yet. Only 3 breeds seeded today; rotation matters once the
  pool is bigger.
- **Pets: "PC box" for off-roster pets.** `web/src/pages/
  Pet.tsx:700` — release = hard delete. With the 6-pet cap
  this is small. ~1-2 days (PC model + storage UI).
- **Strip `placeholderEmail` workaround.** `api/src/routes/
  auth.ts:253-260` — every user has a fake
  `${usernameLower}@local.fitquest` email as a schema
  workaround. Depends on email verification (P1 above)
  landing first.
- **Penance management panel missing from /settings.**
  `api/src/routes/homeBase.ts:61-63` — endpoint exists; the
  panel only lives on /home-base. ~1-2 days to port it.
- **AI Coach: incremental compaction.** `api/src/lib/
  coachStore.ts:248-274` — current "replace oldest batch"
  is wasteful. Append-style summary builder. ~1-2 days.
- **AI Coach: cost dashboard.** `api/src/routes/coach.ts:
  355-357` — chars/4 is "close enough" for the model-time
  badge; a real dashboard would track token usage per
  session. ~1-2 days if/when users hit rate limits
  regularly.
- **Workout template `groupIndex` type-safety debt.**
  `api/src/routes/workoutTemplates.ts:45-47` — `as any` cast
  pending migration-applied version tracking. Hours.
- ◐ **Dead `BICEP` enum value in schema (PARTIAL).** `api/prisma/
  schema.prisma:53` — the *active* check-in surface no longer
  emits it: shipped 2026-07-12 (`0a23717`, "v2.0.0"), the weekly
  check-in flow now uses `BICEP_FLEXED`/`BICEP_RELAXED` instead
  of the single legacy `BICEP` metric. The enum value itself,
  the `METRICS` metadata entry, the `geneticMax` formula case,
  and `MetricDetailModal`'s BICEP branch are all **retained**
  for historical rows — Postgres still can't drop enum values
  without recreating the type, so the actual schema cleanup
  remains outstanding. Hours (migration to recreate the enum).
- **Full synthwave synth pass.** `web/src/lib/soundBus.ts:
  7-15` — current audio mixes Kenney CC0 MP3s with an
  older, less-polished synth for ~4 of ~10 events. ~1-2
  days (art / audio design).
- **Gadgetbridge auto-sync (5am cron).** `api/src/lib/
  morningReport.ts:10-11` — hook exists, trigger is a stub
  only. ~1-2 days to wire the 5am cron; week+ for the
  Gadgetbridge auto-pull.
- **LLM-disabled stub rows.** `api/src/lib/
  spiritualDirector.ts:268-287`, `api/src/lib/
  morningReport.ts:990-1032` — empty `reflection: ''`,
  `patronSuggestion: ''`, `model: null` when LLM is disabled.
  The page renders a "no reflection yet" state instead of
  an explicit "configure LLM" prompt. Hours.
- **3D avatar level-up animation polish.** More cinematic
  level-up + a stronger workout-logged visual effect.
  **Distinct from the avatar's shape / mesh (which is OUT
  OF SCOPE)** — see the "no 3D avatar shape work" note at
  the bottom of this section. The recently-worked
  indicator already brightens trained parts (static, not
  animated); the level-up animation already fires via
  `RewardOverlay`.

### P3 / stretch

- **Gadgetbridge rebuild-reminder notification.** When
  GB's FIT-export API changes (rare), surface a "rebuild &
  install" reminder in the bridge's foreground-service
  notification.
- **AI Coach: chat edit / branch from message X.** Message
  IDs are echoed in the response (`api/src/routes/coach.ts:
  276-279`) but no UI consumes them yet. ID plumbing is
  here for when a future feature wants it.

> **Note on 3D avatar scope.** Scale-to-measurements work
> (avatar Y-scale by height, X / V-taper by shoulder / waist
> ratio, limb width by arm circumference) and anatomical-mesh
> work (replacing disjointed 3D rectangles with tapered
> cylinders / torso / head sphere) are explicitly OUT OF
> SCOPE — this was killed by the user as not worth pursuing
> without a real 3D model. The only avatar work on this
> roadmap is the animation polish item above.

## Backlog — maintenance contracts

These aren't blocking work — clean up next time the surrounding
code is touched. The deep-scope companion for every
"Outstanding" item is in "Stopped Short / Partial
Implementations" below; the changelog of what shipped is in
"Recently Fixed / Resolved" at the bottom.

- **Hand-maintained keyword map.** `api/src/lib/skillMatching.ts:
  5-21` — ~26 exercise-type entries (`pull-up`, `push-up`,
  `squat`, etc.). New branch = edit this map. Maintenance
  contract.
- **Hand-maintained switch for test metrics.** `api/src/lib/
  skillTest.ts:191-195` — same fragility. Maintenance contract.
- **More /tools page additions.** BPM calculator, rep-max calc,
  body-fat-% calc. Rest-timer card already shipped on /tools.
- **3D avatar canvas background is hardcoded, not theme-aware.**
  `web/src/components/*avatar*` (fixed 2026-07-09, `a7b54f4`) —
  a `useChartColors()`-driven attempt to make the canvas
  background follow the dark/light toggle "didn't behave
  correctly in practice", so it's now a deliberate hardcoded
  light-blue for both themes. Revisit if/when the avatar gets
  more theming attention.
- (was: Skill-tree mobile zoom default only reviewed for
  PHANTOM — shipped 2026-07-14. BERSERKER was reported too
  zoomed-in at the 100% default; `SkillTreeCanvas.tsx` now
  defaults every class to 50% zoom on mobile, not just
  PHANTOM.)

## Stopped Short / Partial Implementations

Deferred work that has working v1 code paths but is explicitly
scoped-down from the "full" feature. Captured here so we can
revisit it explicitly instead of re-discovering it from
inline comments. Each entry points at the file:line + the
actual deferred work, so the next session can size + prioritise
without spelunking.

Grouped by area, ordered by "ease of fixing" within each group
(quick wins first, then larger deferred pieces).

### Auth / Account
- **Email flows deferred** — `api/src/routes/auth.ts:95-96`: "no email.
  Email features (verification, password reset, etc.) are deferred
  until we have a mail provider." Users who forget passwords are
  stuck; only an admin-reset path exists. No self-serve password
  change in /profile.
- **Stub `placeholderEmail`** — `api/src/routes/auth.ts:253-260`:
  every user has a fake `${usernameLower}@local.fitquest` email
  as a schema workaround. Strip if/when email is wired.
- (was: Stale "v0.5" string in /profile — shipped 2026-07-08
  session. `web/src/pages/Profile.tsx:1321` reworded — 2FA
  already ships, only self-serve password-change is missing
  (and that has no public roadmap date).)

### AI Coach
- **Per-personality admin prompt overrides** —
  `api/src/lib/coach.ts:13-17`: "The roadmap item
  `LlmConfig.coachSystemPromptOverrides` (admin-side overrides
  keyed by personality) is the next step." The user has decided
  NOT to build this (v1.0.39 feedback round: collapse the
  picker to a one-time onboarding choice + a Settings toggle,
  no per-personality admin knobs). **Removing this from the
  deferred list — see v1.0.39 changelog.**
- **Streaming responses (SSE)** — `web/src/pages/Coach.tsx:18-26`:
  current POST → 502 on long calls. Real fix needs server SSE +
  client EventSource + abort-on-navigate. 2-3 days.
- **Multi-conversation / rename / delete** — explicitly
  **out of scope** (v1.0.39 feedback round: single rolling
  conversation per user is intentional; multi-convo is not
  on the roadmap anymore). Removed from "backlog".
- **Chat edit/branch from message X** — `api/src/routes/coach.ts:276-279`:
  message IDs are echoed in the response but no UI consumes
  them yet. The ID plumbing is here when a future feature
  wants it. Stay-deferred.
- **Cost dashboard** — `api/src/routes/coach.ts:355-357`: chars
  / 4 is "close enough" for the model-time badge. A real cost
  dashboard would track token usage per session. 1-2 days
  if/when users hit rate limits regularly.
- **Incremental compaction** — `api/src/lib/coachStore.ts:248-274`:
  current "replace oldest batch" is wasteful. Append-style
  summary builder. 1-2 days.

### Pets
- **Breed stock rotation** — `api/prisma/seed-pets.ts:7`,
  `api/src/routes/shop.ts:210-218`: "v1: returns every PetBreed
  row (rotation deferred until we have enough breeds to make
  a pool matter)." Only 3 breeds seeded. Schema has
  `availableFrom`/`availableTo` columns already
  (`schema.prisma:2980-2981`); API just doesn't use them yet.
- **No "PC" box for off-roster pets** — `web/src/pages/Pet.tsx:700`:
  release = hard delete. With 6-pet cap this is small.
  1-2 days (PC model + storage UI).
- (was: Stale "v1 = one per user" comment — shipped 2026-07-11
  session (`f64715d`). `api/src/routes/shop.ts:262` now says
  `MAX_PETS_PER_USER = 6`.)

### Quests / Worlds
- (was: Separate breach-levels-reissuance endpoint — NOT
  NEEDED. Dropped 2026-07-08 session. `api/src/lib/breachReset.ts`
  already performs the cycle bump + progress wipe + new-level
  re-issuance in one place; no separate endpoint required.
  The `worlds.ts:445-447` TODO comment was stale from an
  earlier cut and has been cleaned up.)
- (was: Cardio 5K time is duration-proxy, not distance —
  shipped 2026-07-08 session. World clear now prefers real
  `Workout.cardio.distanceKm` + `durationSec`; the
  ~3.33 m/s duration-only fallback still exists for log rows
  without distance, but a real cardio set with distance
  clears the 5K requirement properly (e.g. a 30-min walk no
  longer satisfies it). Same fix path covers the
  `SPRINT_DISTANCE` unclearable bug for `gap-4`/`nexus-4`/
  `breach-4`.)
- (was: `loadRecoveryHistory` returns literal `[]` —
  shipped 2026-07-08 session. New batched
  `computeRecoveryHistory` in `recovery.ts`; the quest-clear
  path now calls it instead of returning `[]`.
  CORRECTION: the affected worlds are **sanctum-3,
  sanctum-5, crossroads-4** — NOT the Nexus. The Nexus has no
  `RECOVERY_STREAK` requirement; the prior roadmap wording
  was wrong.)

### Penances
- (was: Shield-tier damage multiplier in combat — shipped
  2026-07-08 session. `SHIELD_TIER_DMG_MULT` is now applied in
  the world-boss damage path (`api/src/lib/bosses.ts`):
  FORTIFIED ×0.5 / BREACHED ×2.0, applied before the 25%
  per-cap. Previously only the Breach combat path consumed it;
  world-boss damage now matches the Breach path.)
- ◐ **Substance over-use caps — PARTIAL (shipped 2026-07-08
  session).** The penalty COPY was corrected: an over-cap entry
  now correctly emits a `HeartLossEvent`, and `heartMultiplier`
  downstream reduces XP and gold awards as advertised. The
  previously-advertised "HRV credit reduced" / "weekly XP
  multiplier reduced" lines were never implemented and have
  been removed from the copy. The dead `mode.ts` import was
  also removed. The real per-substance HRV / XP multipliers
  (actual stat changes at award time) remain DEFERRED — pending
  a product decision on the right magnitude + cap structure.
- **Penance-management in /settings is missing** —
  `api/src/routes/homeBase.ts:61-63`: endpoint exists; the
  panel only lives on /home-base, not /settings. 1-2 days
  (port the panel).
- **`LEAK_TTL_MS` is a dead constant** —
  `api/src/routes/portalLeaks.ts:771-774`: "kept as a hint for
  future UI copy but no longer drives any logic." Trivial:
  delete or actually use.

### Items / Equipment
- (was: Set-bonus system not built — shipped 2026-07-09 session
  (`c0165c6`). v1 scope: equipped `+DMG`/`+CRIT`/`+DISC` +
  set-piece bonuses (3pc +3% / 6pc +8% raid damage, generic
  tier table, no per-set config needed) now wired into
  `computeRaidDamage` via new `api/src/lib/equipment.ts`
  `getEquippedBonus()`. Exploit-safe: crit chance hard-capped at
  0.5 total, flat +DMG clamped to that workout's base damage
  (can't farm a strong item via junk workouts), set% applied
  pre-cap so the existing 5000 per-workout ceiling still holds.
  Inventory.tsx now shows an "Active in Raids" group + set-bonus
  tier chips, and a de-emphasized "Dormant (future update)"
  group for the stats that don't do anything yet.
  Deferred to v2 (oracle-reviewed decision, NOT arbitrary scope-
  cutting): world-boss damage (`bosses.ts`, a separate
  client-submitted-damage system with a different trust model);
  `+EVA` (would be a self-nerf today — evaded sets deal zero
  damage, so boosting evade chance is strictly worse for the
  player); `+HEAL`/`+BURST` (no consumer mechanic exists yet —
  ORACLE's shield output and TRACER's burst are both currently
  discarded/unimplemented, so wiring these stats now would be
  silently inert); `+DEF`/`+HP`/`+XP`/`+GOLD` (belong to
  different systems — a "taking damage" mechanic and the reward-
  grant calc respectively — not yet designed.)
- **Sprite fallback for missing item art** —
  `web/src/pages/Inventory.tsx:334-335`: a few legacy items
  still use `gear/<class>/<slot>.png` paths that don't all
  exist. Hours (regen sprites or fix paths).

### Skill tree
- **Hand-maintained keyword map** — `api/src/lib/skillMatching.ts:5-21`:
  ~26 entries (`pull-up`, `push-up`, `squat`, etc.). New branch
  = edit this map. Maintenance contract.
- **Hand-maintained switch for test metrics** —
  `api/src/lib/skillTest.ts:191-195`: same maintenance
  contract.

### Body / Measurements
- **Workout template `groupIndex` is conditionally written/read**
  — `api/src/routes/workoutTemplates.ts:45-47`: `as any` cast
  because the migration may not be applied everywhere. "TODO:
  track with a version flag." Hours.
- **`BICEP` is a fossil enum value** —
  `api/prisma/schema.prisma:53`: "legacy alias (Postgres can't
  drop enum values without recreating the type)" — nothing in
  client code emits it. Hours (migration to recreate enum).

### Sound / SFX
- **Full synthwave synth rev deferred** —
  `web/src/lib/soundBus.ts:7-15`: current synth is functional
  but "less polished (8-bit DOS predecessor)"; 6 of ~10 events
  use Kenney CC0 MP3s. 1-2 days (art/audio design).

### OpenFoodFacts
- **OFF search via legacy cgi endpoint** —
  `api/src/lib/openfoodfacts.ts:187-212`: "the v2
  /api/v2/search endpoint returns a fixed 5 items." Search is
  rate-limited as a result. Hours to test v2, a day if you need
  to handle the API shape diff.

### Gadgetbridge / morning report
- **5am Gadgetbridge auto-sync deferred** —
  `api/src/lib/morningReport.ts:10-11`: "Gadgetbridge sync
  (future — for now, manual + the 5am hook)." 1-2 days to wire
  the 5am cron, week+ for the Gadgetbridge auto-pull.
- **LLM-disabled stub rows** — `api/src/lib/spiritualDirector.ts:268-287`,
  `api/src/lib/morningReport.ts:990-1032`: empty
  `reflection: ''`, `patronSuggestion: ''`, `model: null` when
  LLM is disabled. The page renders a "no reflection yet"
  state. Hours to add an explicit "configure LLM" prompt.

### Tools page (UI surface)
- (was: Tools page only had the plate calculator — partial.
  Rest-timer card now linked from `/tools` (shipped 2026-07-08
  session). Remaining: bigger tools — BPM calculator, rep-max,
  body-fat-% — days to a week+ each, scoped to whenever the
  user actually wants them surfaced.)

### Misc stale comments to fix (low-effort cleanup)
- (was: `api/src/lib/penance.ts:13` "COMPROMISED 30-59 portal
  leaks possible (Phase 2)" and `api/src/lib/coach.ts:144`
  "v1 doesn't supply prior turns" — both shipped 2026-07-11
  session (`f64715d`).)

### CLEAN (no deferred work in these areas)
For completeness — the following areas are fully built with no
"stopped short" markers:
- **6 classes** (JUGGERNAUT/PHANTOM/SCOUT/BERSERKER/TRACER/ORACLE)
  — no 7th planned.
- **6 item rarities** (COMMON → MYTHIC) — all referenced in code.
- **6 skill tiers** (T1-T6) — T6 is the cap, no T7 planned.
- **41 body parts** — fully populated L/R pairs.
- **60 achievements** — clean catalog, no "more to come" comments.
- **8 measurement sources** — DEXA, BOD_POD, NAVY, CALIPERS, BIA,
  VISUAL, MANUAL, UNKNOWN.
- **4 substance categories** (NICOTINE/CAFFEINE/ALCOHOL/ELECTROLYTE)
  + separate `TrackedItemCategory` for supplements.
- **4 LLM providers** (OPENAI/OLLAMA/MINIMAX/ANTHROPIC).
- **Pet system** — 6-pet cap (not 1), buy/feed/combat/swap-primary
  all wired.

## Stretch / Future

_(Empty as of 2026-07-09 — every prior stretch item is
either shipped or duplicated in "Outstanding" above. Note
the explicit out-of-scope ruling on 3D avatar shape / mesh
work captured in the "Outstanding" note above.)_

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
  remains (Outstanding P3).
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
- ~~Email verification + password reset — was previously
  dropped~~, **rescoped to Outstanding P1** on 2026-07-09
  (admin-only reset path remains as the workaround until a
  mail provider is wired).

## Recently Fixed / Resolved

### 2026-07-14 session — Docker image build broke right after the tsc gate flip

The api image's "Build + push images" CI run failed on the very
next 2 pushes after the tsc gate was hard-flipped (see below) —
`tsc -p tsconfig.json` reported `TS2307: Cannot find module
'vitest'` across every `src/__tests__/*.test.ts` file inside the
Docker build, despite `tsc -p tsconfig.json` being verified clean
(0 errors) in every local/dev checkout beforehand.

Root cause, confirmed via `package-lock.json`: npm workspaces
doesn't hoist every package to the root `node_modules` — `vitest`
and its test-only transitive deps (`chai`, `pathe`, `std-env`,
`tinyexec`, `tinyrainbow`) are installed nested at
`api/node_modules/` instead (a version-conflict / workspace-scoping
decision npm makes at lockfile-generation time, not something
either Dockerfile controls). `api/Dockerfile`'s `build` stage only
ever did `COPY --from=deps /app/node_modules ./node_modules` — the
ROOT node_modules — and never copied the nested
`/app/api/node_modules`, so `tsc` couldn't resolve `vitest` from
any test file once the `|| true` that used to swallow this exact
error was removed. Every local checkout "just worked" because
`api/node_modules` sits right next to `api/src` with no COPY step
splitting them apart — this divergence only exists inside the
multi-stage Docker build, so no amount of local `tsc` re-verification
would have caught it.

Fixed: added `COPY --from=deps /app/api/node_modules ./api/node_modules`
right after the existing root-node_modules copy in the `build`
stage. Verified (since Docker isn't available in this environment)
by physically reproducing the exact build-stage directory layout
in a scratch dir (root `node_modules` + `api/node_modules` + `api/src`
+ `api/tsconfig.json` + `api/prisma`, no `web/` present — matching
what the Dockerfile actually assembles) and running `tsc` from
inside it: 0 errors. Pushed as its own commit; the next CI run is
the real end-to-end confirmation.

### 2026-07-14 session — skill-tree zoom, recovery-graph gap bridging, tsc backlog → 0

Not yet committed as of this write-up; uncommitted local session
work (web + api). Tests 790/791 (1 pre-existing unrelated failure
in `import.test.ts`, see the P0 note above — intentionally not
fixed this session).

- ✅ **Skill-tree mobile zoom, all classes** (closes the Backlog
  item). BERSERKER was reported too zoomed-in at the prior 100%
  default; `SkillTreeCanvas.tsx` now defaults every class to the
  50% mobile zoom that was previously PHANTOM-only.
- ✅ **Recovery-graph line breaks on missing days, now bridged +
  dashed.** If a day of sleep/HRV/body-battery data is missing
  (an upstream data gap, tracked separately) and the next day has
  data again, `MetricTrendChart`, `SleepOverviewChart`, and
  `BodyBatteryChart` used to render a hard break (recharts
  `connectNulls={false}`) across the whole gap. New shared
  `web/src/lib/chartGaps.ts` (`computeGapBridges`) computes the
  last-point-before/first-point-after pair for every gap; each
  chart now renders an extra dashed, dimmer (`strokeOpacity: 0.6`)
  `<Line>` using Recharts' per-line `data` override to connect
  straight across just that gap. Real back-to-back days are
  untouched; a gap at the very start/end of the window (e.g.
  today not logged yet) is correctly left unbridged since there's
  nothing on the other side.
- ✅ **API tsc backlog: 170 → 0, Dockerfile gate flipped.** See
  the closed P0 item above for the full breakdown — the backlog
  spanned `lib/import.ts` (42, an account-restore path spreading
  loosely-typed JSON into ~36 Prisma create/upsert calls, fixed
  with narrow `Prisma.XUncheckedCreateInput` casts per call site),
  9 more `lib/*.ts` files, 8 `routes/*.ts` files, and ~19 test
  files — all fixed with real type-narrowing (guards before
  array/date-component indexing, a couple of genuinely-wrong
  Prisma JSON-null spellings caught along the way in `users.ts`),
  not blanket `as any` suppression. `api/Dockerfile:48` no longer
  has `|| true` on its `tsc -p tsconfig.json` step — matches the
  web image's existing hard gate. Also fixed in passing: a
  duplicate `fail('userAchievements', ...)` call in `import.ts`'s
  catch block, and confirmed `SHOULDER_WAIST_RATIO` in
  `checkIns.ts` was dead code (not a real Prisma `MetricType`)
  left over from the explicitly-out-of-scope 3D-avatar
  V-taper/shoulder-waist-ratio work.
  A real `import.test.ts` local-day bucketing test failure was
  uncovered during this paydown (out of scope for the
  compile-only pass) — fixed in the follow-up session directly
  below.

### 2026-07-14 session (cont'd) — FIT-import DailyLog duplicate-reward bug

- ✅ **Backdated FIT imports could double/triple-award the
  WORKOUT daily.** `routes/import.ts`'s `persist()` computed its
  DailyLog dedup window once, from real wall-clock "now", instead
  of per-workout from each `w.startTime`. Since FIT imports are
  routinely backdated (importing last month's rides), the dedup
  check could never find the log a historical import had already
  created for its own day — every re-import of old data minted a
  fresh duplicate WORKOUT `DailyLog` (double XP+gold for the same
  historical day). Fixed: day-bucket bounds now computed
  per-workout from `w.startTime`, with both `gte` AND `lt` bounds
  (matches `dailies.ts`'s `/complete` endpoint's existing
  day-bucketing convention) instead of the prior open-ended
  `gte`-only real-"today" check. `import.test.ts:412` now passes;
  full suite 791/791, 0 tsc errors.

### 2026-07-14 session — substance auto-link cache bug

Commit `91313d1`. Tests 790/791 (1 pre-existing unrelated failure
in `import.test.ts`).

- ✅ **Substance auto-link rows went invisible until an unrelated
  refetch.** Logging e.g. "coffee" via `FoodPanel` silently
  auto-linked a `SubstanceLog` row server-side, but `/nutrition`'s
  substance list had no `['substances', 'recent']` invalidation
  on any of the 4 meal-create success paths, so the row stayed
  stale until an unrelated mutation happened to invalidate
  `['substances']` — at which point the auto-link and a
  since-added manual entry would both appear at once, reading as
  a duplicate. Fixed: all 4 `FoodPanel.tsx` onSuccess/onLogged
  callbacks now invalidate `'substances'`. New nullable
  `SubstanceLog.source` column (`@default("MANUAL")`,
  migration) distinguishes `MANUAL` vs `FOOD_AUTOLINK` rows;
  Nutrition.tsx renders a small "auto" pill on autolinked rows
  so the user can tell them apart on sight.

### 2026-07-13 session — combat audit fixes (v2.0.2) + mobile UX

Commits `9c65c67` (combat audit), `51fb50b` (mobile morning-recap
+ layout). Tests 791/61 files (was 786).

- ✅ **C1 — FIT-import bypassed the entire combat pipeline.**
  `routes/import.ts` + `lib/portalLeaks.ts` — bridge-first users
  got zero XP/gold/breach-damage/leak-damage/shield-repair/PR-
  detection/skill-matching for imported workouts; the FIT-import
  path now fires the exact same pipeline as manual workout
  logging.
- ✅ **C2 — leak-damage double-fire + replay exploit.**
  Per-workout dedup for leak damage: a helper-level `findFirst`
  gate plus a new DB unique index
  (migration `..._portal_leak_damage_event_unique`). Closes both
  the `AttackLeakModal` double-fire (workout-commit fires inline,
  then a separate leak-damage POST fires again) and the
  "replay any old workoutId against any active leak indefinitely"
  exploit (no daily cap existed).
- ✅ **C7 — negative-habit / missed-dailies shield drops never
  rolled leak spawn dice.** `missed_all_dailies` (-20) and
  negative-habit shield drops can now push a user to BREACHED
  without ever spawning a leak — contradicted the module header
  in `portalLeaks.ts`. Also fixed: the `check-spawn` endpoint was
  trusting a client-supplied `shieldScore:0` instead of the
  DB-authoritative shield value (dashboard was sending
  `shieldScore:0` → guaranteed 50% spawn chance on every mount).
- ✅ **Multi-target leak damage** (user-requested, layered on the
  audit fixes). `applyLeakDamage` now fans out **full** damage
  (not split) to every active leak whose tags overlap the
  workout's muscle tags — the user's explicit call: "let's not
  split the damage, just do the full damage to each."
  `POST /portal-leak/:id/attack` now actually honors its `:id`
  (targeted-only, no cascade to other leaks in the stack). 5 new
  helper tests.
- ✅ **Morning-recap popup timing race.** `MorningPopup` no
  longer fires on the first `pointerdown`/`keydown` of the day
  (was racing the wake-from-background swipe + refetch delay).
  Now `visibilitychange` + a 1500ms settle delay, with the old
  listener kept as a fallback for users who leave the tab open
  overnight.
- ✅ **Morning popup backdrop/Escape dismissal.** New `Modal`
  prop `disableBackdropClose` (default `false`, so ~40 other
  modal callers are unaffected) — `MorningPopup` now only closes
  via the explicit Close button or "Start your day" CTA.
- ✅ **Today's "+New Daily" button mobile overflow.** Moved out
  of `PageHeader` (was overflowing horizontally on mobile) into
  a full-width banner between the block grid and the built-in
  section header, matching the existing "today is a workout day"
  banner's rhythm.

### 2026-07-12 session — shield-digest dedup fix + BICEP check-in refactor

Commits `030029a` (shield digest), `0a23717` (BICEP → "v2.0.0").
Tests 775 passing both commits.

- ✅ **Shield-digest duplicate notification — real fix (was
  cosmetic-only).** Oracle-investigated: `dismiss`/`clear-all`
  delete the very `shield_repair_daily` `Notification` row the
  old dedup query checked against, so the hourly cron re-emitted
  a byte-identical notification every time a user cleared their
  inbox — the earlier date-in-title fix only made duplicates
  easier to *spot*, not stopped. Real fix: claim-before-emit via
  a new nullable `User.shieldDigestLastDate` column (a single
  atomic conditional `updateMany`, closing a `findFirst`/`create`
  TOCTOU race as a side benefit). Migration adds one nullable
  TEXT column.
- ✅ **BICEP weekly check-in metric replaced ("v2.0.0" cleanup).**
  The single legacy "Bicep Circumference (legacy)" metric is
  dropped from the *active* weekly check-in surface, replaced
  with the two metrics the user actually measures:
  `BICEP_FLEXED` + `BICEP_RELAXED` (both existing enum values,
  now WEEKLY cadence on the api side to match the web side).
  The `BICEP` enum value itself, its `METRICS` metadata, the
  `geneticMax` case, and `MetricDetailModal`'s branch are all
  retained for historical rows (see the Outstanding P2 note on
  the dead-enum cleanup, still not done).

### 2026-07-11 session — PHANTOM skill-tree expansion + mobile/nutrition bug-hunt

Commits `9e32581` (PHANTOM expansion + canvas rendering),
`c36f9d0`/`edec14e` (pinch-zoom + pull-to-refresh), `f64715d`
(P0 closure), `34eeda5`/`67e6716`/`359b8eb`/`d65470f` (nutrition
chart bugs).

- ✅ **PHANTOM deluxe skill-tree expansion.** 107 new PHANTOM
  skills across Push/Pull/Legs/Holds/Rings/Handstand/Planche
  (51 → 158 total), curated from the Martjn/calisthenics_exercises
  HF dataset, including 8 cross-branch prerequisite junctures
  (L-Sit Dip, L-Sit Pull-Up, Maltese Push-Up, Ice Cream Maker,
  Maltese Cross, Victorian Cross, One-Arm Handstand,
  Straight-Arm Press) that require skills from a *different*
  branch than their own.
- ✅ **Shared-canvas skill-tree rendering** (new
  `web/src/lib/skillTreeLayout.ts` +
  `web/src/components/SkillTreeCanvas.tsx`). Replaced
  independently-scrolling per-branch rows with one shared
  coordinate space so cross-branch prereq lines draw as clean
  SVG beziers; topological-depth column assignment guarantees
  every skill renders strictly right of its dependencies;
  isolated pinch-zoom + mouse drag-pan + ctrl+wheel zoom +
  discrete +/- buttons; fixed viewport height (was
  shrinking `max-height` on zoom-out); restored a silently-missing
  "Legs" branch to `BRANCH_ORDER_BY_CLASS.PHANTOM`.
- ✅ **Pinch-zoom exponential compounding fixed.** The zoom
  reference ref was being reassigned to the *current* target
  zoom on every `touchmove` frame while the scale factor was
  already a cumulative ratio from the gesture's fixed start
  distance — a real compounding bug (more frames = more
  compounding), not just a tuning issue. Also restored panning
  from the node-grid area (an earlier fix had bailed out of
  drag-tracking entirely when a touch started on a `SkillNode`
  button).
- ✅ **Pull-to-refresh scoped + polished.** Gated gesture-start
  on the touch beginning inside the top bar / page-header
  (was: anywhere on the page, so any vertical scroll-top swipe
  triggered it). New rotating-icon `PullToRefreshIndicator`
  (inline SVG, no new dep) replaces the old text hint across
  all 29 consumers.
- ✅ **Closed the P0 stale-comment + dead-constant cleanup.**
  `penance.ts:13`, `coach.ts:144`/`148`, `shop.ts:262` comments
  corrected; dead `LEAK_TTL_MS` constant deleted from
  `portalLeaks.ts`.
- ✅ **Notification flyout was nearly invisible.** Swapped the
  shared translucent `.panel` background for an inline opaque
  one (`bg-bg-800/95`) on `NotificationFlyout` specifically,
  keeping the panel's visual family (border/glow) without
  touching the shared `.panel` class other components use.
- ✅ **Nutrition trend chart split into 5 per-metric mini-charts**
  (water/calories/protein/fat/carbs), each with its own natural
  Y-axis — replaces one dual-axis chart that crammed 5
  different-magnitude metrics together. Fixed 3 related bugs in
  the same area: 4 of 5 mini-charts showed "1970-01-01" in
  tooltips (missing `<XAxis dataKey="ts">` meant Recharts fell
  back to row-index as the x-domain); axis tick text was
  unreadable in one theme (now uses the theme-aware
  `colors.axisText`); the food-log modal was trapped behind
  sibling elements like the chart (wasn't using `createPortal`
  like the file's other 5 modals) and the Y-axis clipped
  4-digit values like "2100 kcal" (width 56 → 72).

### 2026-07-10 session — workout-duration unit bug + food/scanner fixes

Commits `9b791d8`, `e683127`, `f5355ff`, `ee14545`, `d3c442e`.
Tests 692 (238 suites) after the duration-unit fix.

- ✅ **`Workout.duration` was silently stored in minutes, not
  seconds — real bug, not just a display glitch.** Root-caused
  from a "3m23s jump-rope shows as 3s duration" report: the
  column was minutes the whole time (fine for long activities,
  wrong by 11%+ for short ones), while `insights.ts`,
  `morningReport.ts`, `Calendar.tsx`, and `Import.tsx` already
  assumed the field was *seconds* and divided by 60 — silently
  under-reporting workout time by 60x in those call sites the
  whole time. Fixed by **renaming** (not just reinterpreting)
  the column to `durationSec` via migration (backfills ×60 for
  existing rows), so every stale consumer becomes a compile
  error instead of a repeat of the same silent-unit-bug class.
  FIT import now stores whole-second precision; `LiveWorkoutLogger`
  sends true elapsed seconds instead of lossily rounding to
  minutes first. Verified: 58 rows backfilled, max 85920s
  (~23.87hr, sane); 692 tests green; zero new tsc errors either
  side.
- ✅ **Barcode-lookup 500 crash (P2002).** `GET
  /foods/barcode/:code` used a bare `create()` after a
  `findUnique` cache-check; any concurrent request/race hit
  `PrismaClientKnownRequestError P2002` on the
  `(source, sourceId)` unique constraint instead of gracefully
  resolving. Converted to `upsert` matching every other
  food-caching call site in the file — confirmed live via
  production docker logs. Also backfills `servingSizeG` on
  previously-cached barcodes.
- ✅ **Scanner silently closed on empty decode.** `NativeScanner`
  called `onCancel()` on any empty/non-numeric ML Kit result,
  closing the whole scan modal with no feedback. Now surfaces
  a "No barcode detected" error and keeps the scanner open for
  retry.
- ✅ **Log-meal unit defaulted to per-100g even with real
  serving data.** `servingSizeG` was hardcoded `null` for
  OFF/USDA sources even though the schema and conversion math
  already supported it (e.g. a milk jug defaulted to ~20 cal
  instead of the real ~140 cal/serving). `openfoodfacts.ts` and
  `usda.ts` now extract the real serving size; `FoodPanel`
  defaults to per-serving whenever it's present.
- ✅ **README license mismatch.** Said MIT; the repo's actual
  `LICENSE` has always been GPL-3.0-or-later. Fixed across all
  3 repos (main + `fitquest-android` + `fitquest-bridge`) as
  part of F-Droid submission prep.

### 2026-07-09 session — mobile pull-to-refresh rollout + Android compositing fix

Commits `0255850`, `3da0996`, `a7b54f4`, `237ca59` (same day as
the prior roadmap reconciliation, `eef0a5f`).

- ✅ **Android "ghost block" WebView compositing bug.** Fixed-
  position overlays using `backdrop-filter`/`backdrop-blur`
  (Modal, RewardOverlay, FoodPanel, GalaxyMapOverlay,
  BossUnlockModal, 13+ components total) left stale compositor
  layers behind on unmount, Android-WebView-only. Centralized
  fix: detect native Android via Capacitor and override
  `backdrop-filter` to `none` on that platform only, compensating
  with higher background opacity. Desktop/web keeps the blur.
  Zero changes needed to the affected components themselves.
- ✅ **Pull-to-refresh rolled out to 28 remaining pages**
  (previously Dashboard-only), each wired to its own actual
  react-query invalidation keys. `/tools` intentionally skipped
  (localStorage-only, no server data to refetch).
- ✅ **3D avatar canvas background hardcoded (light-blue, both
  themes).** A theme-aware `useChartColors()`-driven attempt
  didn't behave correctly in practice; deliberately hardcoded
  instead (tracked as a backlog item above).
- ✅ **CI: arm64 image build retries once on transient QEMU
  crash.** QEMU user-mode emulation (no free native arm64 GHA
  runner) occasionally SIGILLs mid-build during npm ci's
  JIT-heavy steps — an emulator flake, not a real failure. First
  attempt now continues-on-error; a second identical attempt
  runs only if the first failed.

### 2026-07-08 session — v1.0.39 polish + bug-hunt round 3

Web polish + perf + an api bug-hunt round. Three new api bugs
found + fixed (SLEEP_ONSET crash, SPRINT_DISTANCE
unclearable, TOTAL_VOLUME window-days ignored), plus four
follow-ups to prior rounds. Web 1 polish (theme toggle), 1
perf (route-level code-splitting), 1 UX (rest-timer card on
/tools), 2 stale-string fixes. All api fixes have regression
tests; the test suite grew 675 → 738 (+63).

#### WEB — polish

- ✅ **Dark/light theme toggle** (closed the P0). CSS-variable
  theming (`:root` dark / `.light` override) consumed via
  Tailwind `rgb(var(--x)/<alpha>)` so every existing utility
  class gets a free light variant. New
  `web/src/lib/themeBus.ts` + `web/src/hooks/useTheme.ts`;
  no-flash bootstrap in `main.tsx` (reads the persisted choice
  before React mounts, applies the `.light` class to `<html>`
  synchronously). Toggle lives in Settings; persists
  `localStorage.fq_theme`; respects `prefers-color-scheme` on
  first visit.
  *Polish note: a few Recharts / Gauge components still have
  hardcoded dark hex axis colors — light-theme visual QA
  pending.*

- ✅ **Genetic-max override shadowing UI** (closed both the P1
  "Genetic-max shadowing" item AND the Measurements
  "/measurements and /dashboard ... shadowing bug" sub-item).
  Dashboard + Profile now show "manual · formula N" inline
  with the displayed override, and a "Reset to formula"
  affordance appears only when the override actually diverges
  from the formula. Formula-vs-override agreement renders
  cleanly with no affordance noise.

- ✅ **Stale strings fixed.** `web/src/pages/Profile.tsx:1321`
  "account actions (password, 2FA) coming in v0.5" reworded —
  2FA ships, only self-serve password-change is missing (and
  that has no public roadmap date). `web/src/pages/Admin.tsx:474`
  subtitle reworded — the "future in-app coach/quest narrator"
  copy was misleading (the LLM panel drives the AI Coach chat;
  "quest narrator" never landed as a separate feature).

#### WEB — perf / features

- ✅ **Web main chunk code-splitting** (closed the P1.5
  "Web main chunk is 2.3 MB"). Route-level `React.lazy` for
  all 35 routes + `<Suspense>` boundary. Main entry chunk
  shrank **2,397 kB → 238 kB (~90%)**; the Three.js avatar
  (gltf + 3D scenegraph) and Recharts (charts + axis code) are
  now isolated chunks that only load when their pages do.
  Vite no longer warns about chunk size on the home build.

- ✅ **Tools page rest-timer card.** `RestTimer` is now linked
  from `/tools` (was: embedded only in `LiveWorkoutLogger`).
  Only the bigger tools (BPM calculator, rep-max, body-fat-%)
  remain deferred.

#### API — bug-hunt round 3

All shipped with regression tests (675 → 738, +63).

- ✅ **SLEEP_ONSET crash fix** (NEW bug, not previously in
  roadmap). The `METRICS` lookup map used to translate the
  enum to its display label was missing the `SLEEP_ONSET`
  entry, so `POST /measurements` and `POST /measurements/batch`
  threw `TypeError: Cannot read properties of undefined` and
  returned 500 for any sleep-onset row. Fixed + new
  enum-coverage test that iterates every `MetricType` value and
  asserts a label exists.

- ✅ **Recovery-streak gating fix** (closed "loadRecoveryHistory
  returns literal []"). New batched
  `computeRecoveryHistory` in `recovery.ts`; the quest-clear
  path now calls it instead of returning `[]`.
  *CORRECTION: the affected worlds are **sanctum-3, sanctum-5,
  crossroads-4** — NOT the Nexus. The Nexus has no
  `RECOVERY_STREAK` requirement; the prior roadmap wording
  was wrong.*

- ✅ **SPRINT_DISTANCE unclearable** (NEW bug). The worlds
  `gap-4`, `nexus-4`, and `breach-4` were mathematically
  impossible — the distance-from-duration proxy
  (`duration × ~6 m/s pace`) contradicted the pace gate on the
  same world, so no workout could ever clear the requirement.
  Fixed: the world-clear path now prefers the real
  `Workout.cardio.distanceKm` + `durationSec` when both are
  present, and the duration-only fallback drops the
  contradictory inference (pace-from-distance vs
  distance-from-duration both at once). Those worlds are now
  finishable.

- ✅ **CARDIO_5K duration-proxy** (closed prior entry). World
  clear now prefers real `Workout.cardio.distanceKm` +
  `durationSec`; the ~3.33 m/s duration-only fallback still
  exists for log rows without distance, but a real cardio set
  with distance clears the 5K requirement properly (e.g. a
  30-min walk no longer satisfies it).

- ✅ **TOTAL_VOLUME window-days ignored** (NEW bug).
  `crossroads-5` advertised "14 days" in its config but the
  evaluator was effectively summing over 90 days (the leftover
  default before the metric-specific window was applied).
  Fixed — metric-specific `windowDays` is now honoured for
  every world.

- ✅ **Shield-tier damage multiplier in world bosses** (closed
  prior entry). `SHIELD_TIER_DMG_MULT` is now applied in the
  world-boss damage path (`api/src/lib/bosses.ts`):
  FORTIFIED ×0.5 / BREACHED ×2.0, applied before the 25%
  per-cap. Previously only the Breach combat path consumed it.

- ◐ **Substance over-use caps — PARTIAL.** The penalty COPY
  was corrected: an over-cap entry now correctly emits a
  `HeartLossEvent`, and `heartMultiplier` downstream reduces
  XP and gold awards as advertised. The previously-advertised
  "HRV credit reduced" / "weekly XP multiplier reduced" lines
  were **never implemented in code** and were removed from
  the copy. The dead `mode.ts` import was also removed. The
  real per-substance HRV / XP multipliers (actual stat
  changes at award time) remain DEFERRED — pending a product
  decision on the right magnitude + cap structure.

- ✅ **Doc / comment sweep.** `api/src/lib/worlds.ts:445-447`
  (breach reset already works via `breachReset.ts`, no
  separate re-issuance endpoint needed),
  `api/src/lib/breachReset.ts` header,
  `api/src/lib/penance.ts:22-24`, `api/src/lib/mode.ts:35-39`.

- ✅ **Separate breach-levels-reissuance endpoint — NOT NEEDED**
  (drops prior entry). `api/src/lib/breachReset.ts` already
  performs the cycle bump + progress wipe + new-level
  re-issuance in one place. The "separate endpoint" TODO was
  stale from an earlier cut.

- **NOTE (future api cleanup, not a bug):** the `seedSkills.ts`
  header docstring (lines ~4-24, 447, 610, 666) still
  describes the non-PHANTOM classes as "auto-tier
  heuristic"-based. That comment is now stale — see "Skill
  tree" cleanup below; the actual skill data uses explicit
  per-skill `prereqs:` for all 6 classes. The docstring will
  be corrected in a future api cleanup pass.

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
- ✅ Dark/light theme toggle (CSS-var palette via themeBus +
  Settings picker; light-mode surface polish in progress)

## Nice-to-haves

(was: sound/audio system — shipped, see Dropped section.)
(was: web push notifications — previously parked in a Backlog
→ Mobile & UX sub-section that no longer exists; not on the
reconciled 2026-07-09 roadmap, so effectively dropped. The
in-app notification feed / inbox that did ship is in
"Recently Fixed / Resolved".)