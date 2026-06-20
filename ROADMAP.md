# FitQuest Roadmap

## Active (in progress)

## High Priority — Promised but not done

1. **Tie quest boss unlocks to world completion.** When all 5
   levels in a world are cleared, a "boss" unlocks — single-player
   encounter with its own HP bar. Mechanic could be: complete a
   specific achievement (e.g., set a new PR) to deal damage, then
   once defeated, grants a class-skill point or a Soulstone.
2. **More worlds.** Add Nexus (high-level, multi-class) and The
   Breach (raid-themed solo content). Stretches the endgame so
   the threshold-based system has long-term goals.

## Medium Priority — Security & Data

3. **2FA / TOTP.** speakeasy + QR code + recovery codes.
4. **Email verification + password reset.** depends on 2FA.
5. **Medical metrics.** cholesterol, testosterone, blood pressure,
   resting heart rate trend (already track RHR via metric, but no
   UI for medical history).
6. **Data export.** CSV / JSON download of all user data.

## Medium Priority — Polish

7. **Equipment drops / loot.** common enemy drops for raids so
   raids aren't just "deal damage". Could be cosmetic items
   (custom avatars), XP boosts, or class items.
8. **Mobile polish.** Already done basic pass — could iterate on:
   - Long-press to multi-select on history
   - Pull-to-refresh on Dashboard
   - Haptic feedback on rest timer completion

## Stretch / Future

9. **Nutrition tracker** (FoodYou-style)
   - Use OpenFoodFacts API for food search + barcode lookup
   - Daily macro tracking (already have CALORIES / PROTEIN_G /
     WATER_ML metrics, just need the entry UI)
   - Reference: https://github.com/FoodYou-wants-to-be-programmer/FoodYou
10. **Gadgetbridge integration**
    - Wearable data sync (HR, sleep, steps)
    - Reference PR: https://codeberg.org/Freeyourgadget/Gadgetbridge/pulls/5809
    - Would feed: RESTING_HR, HRV, SLEEP_HOURS automatically
11. **FIT / GPX file imports** (Endurain-style)
    - Upload a FIT file from a Garmin / Wahoo / etc.
    - Extract: distance, time, pace, HR, elevation, laps
    - Auto-log as a CARDIO workout with all the juicy metrics
    - Reference: https://github.com/fmager/Endurain (community fork)
12. **3D avatar / STATUS hologram polish**
    - Pinch-to-zoom (done)
    - Better touch targets for body parts (done)
    - Animations on level completion
    - Animated "worked" pulse when a workout is logged
13. **Personal records page** — all PRs in one view, with charts
    over time.
14. **Body composition timeline chart** — BF% / LBM over time
15. **Insight rule improvements** — better correlations between
    sleep / stress / recovery / pain
16. **AI HUD agent** — Cortana-style assistant that knows your
    data and can answer questions ("how did I sleep this week?")

## Recently Fixed / Resolved

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

## Nice-to-haves (backlog)

- Dark/light theme toggle (currently only dark)
- Sound effects on level up, raid damage, etc.
- Achievements gallery (we have 40+ achievements but no gallery)
- Friend system / leaderboards
- Apple Health / Google Fit integration (similar to Gadgetbridge
  but per-platform)
- Periodic check-ins (weekly weigh-in reminder, monthly photo
  upload, etc.)
- Custom workout templates (save a routine as a template)
- Macro/meal planning beyond just logging