# FitQuest Roadmap

> Audited against the actual codebase — every "done" item below has
> working code in the repo and reachable via a URL. The "outstanding"
> items are sized + scoped for the next session.

## Active (in progress)

(none — all high-priority items shipped this session)

## High Priority — done in this session

- ✅ **Tie quest boss unlocks to world completion.** `BossCard` +
  `BossUnlockModal` + `/bosses/:worldId/damage` endpoint + auto-create
  `WorldBoss` on clear + first-defeat rewards.
- ✅ **More worlds — Nexus + Breach.** Nexus (cyan, lvl 10, multi-class
  convergence, "The Multitude" boss) and Breach (violet, lvl 12,
  raid-themed descent, "The Maw" boss). 9 worlds total.
- ✅ **Breach world reset on Maw defeat.** `cycle` field on
  `WorldBoss` + `UserWorldProgress` (migration
  `20260629000000_add_world_cycle`). `resetBreachIfDefeated()`
  increments cycle, picks a new Maw variant from a 10-entry pool
  (excluding the 3 most recent to avoid repeats), wipes all breach
  progress rows, and resets the WorldBoss to ACTIVE with full HP.
- ✅ **Breach ↔ Raid integration.** `PortalLeak.worldSource`
  (PortalLeakSource enum) — 'AMBIENT' or 'BREACH'. `maybeSpawnBreachLeak()`
  spawns a leak tagged 'BREACH' when the Maw is defeated. UI:
  a small violet "breach" badge on the homebase leak alert +
  /portal-leak page title + history rows. History filter
  (All / Ambient / Breach) on /portal-leak.

## Medium Priority — Security & Data

- ~~Email verification + password reset.~~ **DROPPED** per user
  direction (no email integration in this app).
- ✅ **2FA / TOTP.** speakeasy + QR code + recovery codes.
  `api/src/lib/totp.ts` + `web/src/components/TwoFactorSetup.tsx` +
  full auth flow in `auth.ts`.
- ✅ **Data export.** `/export/info` + `/export/json` + `/export/csv` (zip).
- **Medical metrics UI.** Surface existing RHR / sleep / stress
  for medical history. Schema has RHR + sleep already; need UI
  for "medical history" view (chart of RHR over time, BP if
  tracked, cholesterol if logged). Currently /measurements has
  the data but no medical-themed UI.
- **Insight rule improvements.** Existing rules in
  `api/src/lib/insights.ts`: `recovery_low`, `recovery_high`,
  `recovery_drag`, `strong_corr`, `coverage_gap`, `no_data`.
  Could add: sleep-vs-recovery-correlation, pain-localization-to-
  muscle-pattern, volume-vs-mood, stress-vs-PR, hydration-vs-RPE.

## Medium Priority — Polish

- ✅ **Quest homebase overhaul (consolidation).** Single `/home-base`
  command center with "Open Galaxy Map" overlay, Breach indicator
  (locked = unstable wavy outline, unlocked = full black hole with
  electron orbital arcs), leak modal. Sidebar shrunk from 25 to 22
  items (Quest, Breach, Leaks removed).
- **Equipment drops / loot.** common enemy drops for raids so
  raids aren't just "deal damage". Existing system drops loot on
  leak defeat + boss defeat, but no themed "drop sources" tied to
  world activity (e.g. "Glade drops agility gear", "Spire drops
  strength gear"). Maps world → loot table.
- **Mobile polish.** Already done basic pass — could iterate on:
  - Long-press to multi-select on history
  - Pull-to-refresh on Dashboard
  - Haptic feedback on rest timer completion
- **Live mode "Finish workout" hang.** When the user finished
  the last set in Live mode and clicked "Finish workout ✓",
  `advanceToNextSet()` set `phase = 'done'` but the actual
  commit (`createM.run`) was never fired. Fix: fire the commit
  in the "no more sets" branch of `advanceToNextSet`. ✅

## Stretch / Future

- ✅ **Nutrition tracker (FoodYou-style).** `api/src/routes/foods.ts`
  + `api/src/routes/meals.ts` + `web/src/pages/Nutrition.tsx`.
  AI-estimated macros from free-text descriptions, per-100g
  client-side math, daily totals. UI exists in the sidebar.
- **Gadgetbridge integration.** The FIT parser
  (`api/src/lib/fit.ts`) supports the file format that
  Gadgetbridge exports, and `/import` page text says "Supports
  activities, sleep, HRV, and monitoring FITs from Garmin
  wearables and Gadgetbridge." So in the sense of "we can ingest
  what Gadgetbridge exports" — ✅. What's *not* done: a live
  pull-from-server flow (currently upload-only). Future scope
  if user wants a webhook + auto-poll.
- ✅ **FIT / GPX file imports (Endurain-style).** `api/src/lib/fit.ts`
  + `api/src/routes/import.ts` + `web/src/pages/Import.tsx`. Upload
  a `.fit` file from a Garmin / Wahoo / etc. Extracts distance,
  time, pace, HR, elevation. Auto-logs as a CARDIO workout with
  all the juicy metrics. Also infers 1mi / 5K times for level
  requirements.
- **3D avatar / STATUS hologram polish.** Body hologram exists.
  Could add: animations on level completion, animated "worked"
  pulse when a workout is logged, idle ambient drift on the
  body parts.
- **Personal records page** — all PRs in one view with charts
  over time. Currently /prs/WorkoutDetail shows individual PRs
  but no aggregated "all my PRs over time" view.
- ✅ **Body composition timeline chart** — `web/src/pages/BodyComp.tsx`
  has a multi-metric timeline (weight, BF%, lean mass, RHR)
  with 30d/90d/6mo/1yr windows. Implemented via OverlayTrendChart.
- **AI HUD agent** — Cortana-style assistant that knows your
  data and can answer questions ("how did I sleep this week?").
  Could be an LLM-powered insights panel that calls into the
  same APIs the dashboard does.

## Recently Fixed / Resolved

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

## Nice-to-haves (backlog)

- Dark/light theme toggle (currently only dark)
- Sound effects on level up, raid damage, etc.
- Push notifications (web push API for homebase shield drops,
  breach defeat, etc.)