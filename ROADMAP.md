# FitQuest Roadmap

> Audited against the actual codebase — every "done" item has
> working code reachable via a URL. "Outstanding" items are sized
> + scoped for the next session.

## Active (in progress)

(none — high-priority items shipped, picking from the backlog)

## Backlog (from user notes, in priority order)

### Bugs / data-correctness

- **Portal-leak queueing behaviour.** Currently `maybeSpawnLeak`
  short-circuits if an active leak exists — the new spawn is
  silently dropped. Should the new one queue so the user gets a
  "next up" indicator, or get rolled into a 24h cumulative
  timer, or stay dropped? Need a clear product decision.
- **Morning Checkins block not linked to weight log.** The user
  can log weight via the dashboard weigh-in block, but the
  Morning checkin panel doesn't pick it up. Same problem for
  sleep quality from .fit uploads → Sleep Q checkin. Likely the
  "where does today's data come from" routing is wrong; both
  should query the same `Measurements` table by `recordedAt::date`.
- **Genetic Max minimums are wrong.** Several metrics have
  minimums so far below realistic that the field is unusable.
  Audit + fix:
    - SHOULDER min 15in (probably should be ~35in)
    - CALF min 14in, max 16in (user's actual is 12.7in → floor too high)
    - FFMI min too high
    - Probably more (audit all of `geneticMax.ts`)
- **Recent PRs block shows calculated 1RM, not real PRs.** The
  Dashboard "Recent PRs" panel currently surfaces the user's
  estimated 1RM peaks (Epley formula on every set) and calls
  them "PRs". A PR is a deliberate breakthrough, not every set.
  Either rename to "Estimated 1RM peaks" or filter to only true
  PR rows (the `Pr` table).
- **Status page Identity block weight not updated from weigh-ins.**
  The Identity block shows `user.weightKg` which is the column
  value, but weigh-ins go into `Measurement` rows. The displayed
  value should be the latest `Measurement(weightKg)` for today.
- **Pain entries persist silently on Status.** Pain logs should
  appear on the Today page with a "is it going down?" trend
  card + a "pain is gone" quick-action. Currently the user has
  to dig into the Status page to see them.
- **Recovery practices should be on Today.** The card is worded
  as daily ("today's recovery stack") and the user has to
  navigate to Recovery to see it. Move the block to Today.
- **Weekly Examen copy typo.** "where was God in neither"
  appears in both the daily reflection prompt AND the weekly
  review. The weekly version is the one that needs fixing
  (should be "either" or "where was God in all this"). Clarify
  with the user which wording is intended, then fix.
- **Body weight graph zoom too tight on Insights.** Change
  `yPad` from 20 above/below the recorded weight max/min to 10
  so the line shows a bit more dynamism in the chart.

### Polish

- **Equipment drops / loot** — common enemy drops for raids so
  raids aren't just "deal damage". Existing system drops loot
  on leak defeat + boss defeat, but no themed "drop sources"
  tied to world activity (e.g. "Glade drops agility gear", "Spire
  drops strength gear"). Maps world → loot table.
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
- **Inventory: drop Preview block, move Stats From Equipment.**
  The PREVIEW panel (which used to show a SpriteAvatar) is now
  just the class portrait. Since we're not overlaying equipped
  items onto a sprite, the block has no purpose. The "Stats From
  Equipment" panel currently lives in the right column under
  Preview — it should move to the left column ABOVE the item
  catalogue, BELOW the equipped loadout panel.

### More monsters for spiritual + recovery penalties (not just
workouts). The Penance engine currently has a few workout-themed
penalty templates; the spiritual + recovery tracks lack any.
Add a roster of monsters/events per track (e.g. "missed Sunday
mass", "skipped the examen", "didn't log a recovery metric for a
week") that fire as portal leaks with thematic tags.

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
- **3D avatar / STATUS hologram polish.**
- **Body composition timeline chart** ✅ already implemented in
  BodyComp.tsx (30d/90d/6mo/1yr windows).
- **FIT / GPX file imports** ✅ fully implemented in
  `api/src/lib/fit.ts` + `api/src/routes/import.ts`.
- **Nutrition tracker** ✅ Foods/Meals routes + Nutrition page.

## Recently Fixed / Resolved

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

## Nice-to-haves (backlog)

- Dark/light theme toggle (currently only dark)
- Sound effects on level up, raid damage, etc.
- Push notifications (web push API for homebase shield drops,
  breach defeat, etc.)

## Dropped

- ~~Email verification + password reset.~~ No email integration
  in this app. Dropped per user direction.