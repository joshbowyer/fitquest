# FitQuest Roadmap

> Audited against the actual codebase — every "done" item has
> working code reachable via a URL. "Outstanding" items are sized
> + scoped for the next session.

## Active (in progress)

(none — picking from the backlog next)

## Backlog (from user notes, in priority order)

### Bugs / data-correctness

- **Do hearts actually decrease with missed workouts?** Verify
  the heart/health loss logic for missed workouts — confirm
  that hearts (HP / lives / health bar) actually decrement
  when a workout is skipped past its due date, vs. just being
  a passive stat. If it doesn't decrement, add the logic
  (scheduled job + UI feedback). If it does, document the
  formula + decay rate.

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
- **3D avatar polish** — animations on level completion,
  animated "worked" pulse when a workout is logged.
- **Skills page revisit** — the page exists but the user wants
  to walk through it again. (Scope: see what currently works,
  identify gaps.)

### Identity / auth

- **Tron identity disk should scale to real body measurements.**
  Currently the disk is rendered at a fixed size; the user wants
  the avatar to actually look different between body types. Add
  measurements (shoulders, waist, height) and map them to real
  visual properties (e.g. shoulder width → disk radius, waist →
  inner ring, height → vertical position). 6' / 28in waist / 44in
  shoulders should look visibly different from 5' / 32in / 42in.
- **Username case-insensitive login** (may require DB change).
  Currently login is case-sensitive — `LobsterWrangler` vs
  `lobsterwrangler` are different identifiers. Make login
  case-insensitive (store lowercased username OR use a
  citext column in the User table, OR add a lowercase
  index column).
- **Admin: reset all users' items.** Add a button on the admin
  page that wipes the `InventoryItem` table (and resets any
  related state) so the user can clear test items from the prod
  server. Confirm with the user if equip/loadout state should
  also reset.

## Stretch / Future

- **AI HUD agent** — Cortana-style assistant that knows your
  data and can answer questions ("how did I sleep this week?").
  Could be an LLM-powered insights panel that calls into the
  same APIs the dashboard does.
- **Gadgetbridge live push/pull** — currently upload-only. A
  real Gadgetbridge integration would push FIT files
  automatically when the user pairs a Garmin / WearOS device.
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

## Dropped

- ~~Email verification + password reset.~~ No email integration
  in this app. Dropped per user direction.