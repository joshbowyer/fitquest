# FitQuest

> A self-hosted personal fitness RPG. D&D-style stat sheet, Habitica-inspired gamification, cyberpunk neon HUD. Now with a real Android app (`fitquest-android` repo) and a Gadgetbridge→FitQuest sync helper (`fitquest-bridge` repo).

Your body metrics — bicep, bench 1RM, VO2 max, body fat % — are visualized as **gauges** showing your **current value against your genetic ceiling**. Workout sessions earn XP, auto-detect PRs, and contribute damage to **co-op boss raids** with your party. Class-based skill trees (Juggernaut, Phantom, Scout, Berserker, Tracer, Oracle) shape your progression.

![stack](https://img.shields.io/badge/stack-Fastify%20%2B%20Prisma%20%2B%20Postgres%20%2B%20React-00f0ff?style=flat-square)

## The 3-repo setup

FitQuest now lives in three repositories:

| Repo | What | Why separate |
|---|---|---|
| **`fitquest`** (this one) | The web app + api server. Source of truth. | The api + web bundle need to be versioned together; everything else hangs off them. |
| **[`fitquest-android`](https://github.com/joshbowyer/fitquest-android)** | Capacitor Android wrapper. Wraps the web bundle in a native WebView with first-run api config + 8 AM morning reminder notification. | The native android project is 50+ MB (gradle, Capacitor plugins). Keeping it separate from the web source means the web repo stays small and the build doesn't need Android tooling. |
| **[`fitquest-bridge`](https://github.com/joshbowyer/fitquest-bridge)** | A separate Kotlin app that watches Gadgetbridge's FIT files and uploads them to your FitQuest api. | Run on a rooted Android device. **Personal-use tool with significant caveats — see its README before installing.** |

The **single source of truth is the api's Postgres DB**. The web app, the Android app, and the bridge all read/write to the same schema. The bridge and Android app consume the api like any other client.

## Stack

- **Backend:** Node 22 + Fastify 5 + Prisma 5 + PostgreSQL 16
- **Auth:** session cookies (HTTP-only, signed). 2FA/TOTP opt-in. 30-day rolling sessions.
- **Frontend:** React 18 + Vite 5 + TailwindCSS 3 + Recharts + Three.js (for the 3D avatar)
- **Realtime-ready:** party raid state is polled; can be upgraded to WebSockets
- **Containerized:** multi-stage Dockerfiles, single `docker compose up`

## Quick start (Docker)

The simplest dev path: clone, set secrets, run.

```bash
git clone https://github.com/joshbowyer/fitquest
cd fitquest
cp .env.example .env
# Edit .env — minimum: set COOKIE_SECRET to a long random string
# (`openssl rand -hex 32`)
docker compose up --build
```

Then open <http://localhost:8080>. The first account to register is bootstrapped to admin (see `api/src/lib/seedAdmin.ts`).

- **Web:** <http://localhost:8080>
- **API:** <http://localhost:3001>
- **Postgres:** `localhost:5432` (user/pass: `fitness`/`fitness` by default)

### Production with Caddy (optional)

```bash
docker compose --profile production up --build
```

Set `WEB_DOMAIN=fit.example.com` in `.env` and point DNS at the host. Caddy handles TLS automatically.

## Deploy via Portainer (recommended for personal use)

The build-and-push pipeline is fully automated. The repo's GitHub Actions workflow builds the `api` and `web` images on every push to `main` and pushes them to GitHub Container Registry:

- `ghcr.io/joshbowyer/fitquest-api:latest`
- `ghcr.io/joshbowyer/fitquest-web:latest`

The Android app is built and released separately (see [`fitquest-android` README](https://github.com/joshbowyer/fitquest-android)).

**One-time setup:**

1. Trigger a build — push to main, or trigger the workflow manually from the Actions tab. The first build takes a few minutes.
2. In Portainer: **Stacks → Add stack → Web editor**.
3. Paste the contents of [`docker-compose.portainer.yml`](./docker-compose.portainer.yml). Edit the env vars:
   - `COOKIE_SECRET` — `openssl rand -hex 32` (required — 32+ chars or the cookie layer refuses to start)
   - `WEB_ORIGIN` — your public URL, e.g. `https://fit.example.com` (must match the caddy vhost)
   - `WEB_ORIGIN_EXTRA` — additional allowed CORS origins. The Capacitor WebView calls the api at `https://localhost` (the WebView's `androidScheme: 'https'`), so include `https://localhost` here or the app's preflight fails. If you also have a separate `api.fit.example.com` vhost (for the bridge), add that too. The **first-run prompt** in the Android app accepts the api base URL and the client builds paths relative to it; the api routes are at `/auth`, `/users`, `/measurements` etc. (no `/api` prefix on the api itself).
4. Click **Deploy the stack**.

The stack uses the latest images from ghcr.io. To pin a version, change `:latest` to a commit SHA tag (e.g. `:sha-abc1234`) in the compose file.

**Updating:** Portainer's **Stacks → [your stack] → Pull and redeploy** fetches the new `:latest` image and restarts the containers. The migrations in the `api` image run automatically on startup (`prisma migrate deploy` in the entrypoint).

### Alternative: build from source in Portainer

If you prefer to build from source rather than pull pre-built images:

1. Portainer → **Stacks → Add stack → Git repository**.
2. Repository URL: `https://github.com/joshbowyer/fitquest`
3. Compose path: `docker-compose.yml`
4. Env vars: same as above.
5. Click **Deploy**. Portainer clones the repo and builds the api/web images from the Dockerfiles.

## Android app (`fitquest-android`)

The Android app is a Capacitor 6 wrapper around the same `web/dist/` bundle. It:

- Loads the web app at `https://localhost` (capacitor `androidScheme: 'https'`)
- Lets you point the api at any URL on first launch (or via the persisted localStorage value)
- Schedules a daily 8:00 AM local-time notification ("Check your dailies · log a workout · mark the day complete.") via `@capacitor/local-notifications`
- Re-uses the api's session cookie (set with `SameSite=None; Secure; HttpOnly` in prod, so it works cross-origin from the WebView to the api domain)

### Build + install

The repo has a GitHub Actions workflow that builds a debug APK on every push and uploads it as a workflow artifact. To install:

1. Go to the Actions tab on `fitquest-android`, pick the latest run, download the `app-debug` artifact (a `.apk`).
2. Transfer to your Android device (USB, ADB, Drive, etc).
3. `adb install fitquest-debug.apk` (or just open the file on the phone and tap to install — you'll need to enable "install from unknown sources" first).

The first launch shows a prompt for the api base URL. Enter `https://api.fit.example.com` (no `/api`). Save & Continue; the page reloads and the URL is persisted to localStorage.

To re-trigger the prompt (e.g. you moved the api to a new domain), clear the app's data: **Settings → Apps → FitQuest → Storage → Clear data**. Re-launching will show the prompt again.

## Gadgetbridge sync helper (`fitquest-bridge`)

The bridge is a separate Kotlin app that watches Gadgetbridge's `app-private/external_files` directory (the same path the FitQuestBridge APK uses) and uploads new `.fit` files to the api. Runs on a **rooted Android device only** — uses `su` to bypass the `MANAGE_EXTERNAL_STORAGE` Android 11+ restrictions.

**It is a personal-use tool with significant caveats:**
- Spams Magisk superuser notifications every upload
- Was only tested against the user's specific Gadgetbridge setup
- Persists a known-file dedup set in SharedPreferences (resets on uninstall)
- Not on the Play Store; sideload only

For most users, the bridge is overkill — drag-and-drop a `.fit` file into the web app's `/import` page instead. The bridge is here because the original use case (a nightly Gadgetbridge sync) needed a background service on a rooted phone, and the web app can't do that.

### Install

Clone the repo, open in Android Studio, build a debug APK, sideload. See the [fitquest-bridge README](https://github.com/joshbowyer/fitquest-bridge) for the build flow.

## Features

### Stat sheet

22+ metrics across hypertrophy, strength, body comp, cardio, calisthenics. Each rendered as a 270° cyberpunk gauge with:
- Min baseline (default untrained value)
- Genetic max (formula-derived, with manual override)
- Current value (latest measurement)
- % of max
- Animated fill + neon glow + tick marks

Genetic max formulas: McCallum proportions (bicep = wrist × 2.7, chest = wrist × 6, etc.), FFMI ceiling (~25–26 for natural), bodyweight-relative strength standards (bench 1.5× BW, squat 2.25× BW, deadlift 2.75× BW), age-adjusted VO2 max. All overridable per-metric in Measurements page.

### Classes & skill trees

6 classes × 6 branches × 5-tier skill trees, ~200 total skills. **SkillTree** is the current page (replaces the old `/skills` linear page).

| Class | Color | Vibe |
|---|---|---|
| Juggernaut | red | Powerlifter / raw strength |
| Phantom | lime | Calisthenics / bodyweight mastery |
| Scout | amber | Endurance / zone 2 |
| Berserker | magenta | Combat / functional |
| Tracer | violet | Speed / agility |
| Oracle | cyan | Longevity / balance |

Skills apply effects (XP multiplier, gold multiplier, raid damage, genetic max bonus). **Activity→skill auto-unlock**: when you log a workout that matches a skill's test, the skill is queued for confirmation. The skill tree page shows a queue of pending unlocks and you tap to confirm.

### Workout tracking

- Log any session: strength, hypertrophy, calisthenics, cardio, mobility
- Add exercises + sets (reps/weight/duration/RPE)
- **PR auto-detection** per exercise (Epley 1RM estimation)
- **Live workout mode** with rest timer + autosave
- **Supersets** with round-robin sets (groupIndex)
- **Re-import dedup** — manual + bridge uploads of the same `.fit` file upsert the same Workout row (unique on `(userId, performedAt)`)
- XP/gold rewards scaled by total volume, duration, PRs
- Achievements unlocked automatically after each action

### Habits + Recovery + Insights

- 9 subjective + numeric habit metrics: Sleep (hours + quality), Nutrition (calories + protein + water), Wellness (mood + energy + soreness + stress + resting HR)
- Subjective 1-10 scales use range sliders with auto-commit on release
- **Recovery score (0-100)** on the dashboard: weighted from HRV, sleep hours, resting HR, sleep quality, soreness, stress, energy, mood. Missing metrics have their weight redistributed across what's available. 7-day rolling average with delta indicator.
- **Morning Popup** — Habitica-style. Auto-shows on first visit each day, with one-tap recovery on missed dailies.
- **Correlations** — Pearson r over 60 days between habit metrics and training outcomes. "Sleep hours strongly boost your bench volume (r=0.78, n=14)." 
- **Personalized tips** — combine recovery + correlations into 3-5 actionable lines
- Coverage-gap detection — "You haven't logged HRV in 5 days."

### Parties & raids

- Create or join a party
- Leader/officer starts a boss raid with custom HP and name
- Members contribute damage (manually for now; future wiring to workouts)
- 5 starter bosses (Iron Colossus, Cardio Wyrm, The Plateau, Skeletal Minion, BPM Demon)
- World-class system: 6 worlds (Forge, River, Iron Wastes, etc.) with random procedural boss variants
- Equipment drops with class-restricted gear
- Inventory + equip + loadout system

### Daily weigh-ins

- Prominent dashboard panel: today's weight, current streak, longest streak
- 7-day sparkline with current-vs-baseline reference line
- 7-day delta indicator (gaining / losing trend)
- One-click log with Enter-to-submit

### Achievements

40+ achievements across consistency, strength, body comp, endurance, calisthenics, social, religious (spiritual streak).

### Spiritual

- Daily Mass readings from USCCB (USCCB Daily Readings RSS feed)
- Spiritual dailies configurable per user (Rosary, Mass, Scripture, Contemplation, etc.)
- Weekly Examen reflection journal

### Sound

Per-event SFX system (see Settings → Sound):
- workoutComplete, levelUp, achievement, restTimerDone, skillUnlock, bossKill, lootDrop
- Real recordings (ElevenLabs-generated or FitQuestBridge-collected) override the synth defaults
- Mute toggle persisted to localStorage

### Import page

- Drop a `.fit` file → exercises/sets/duration/HR/GPS get parsed via `@tfit/parser`
- Workout + measurement rows persisted with `importSource = WEB` (drag-and-drop) or `BRIDGE` (FitQuestBridge auto-upload)
- `Bridge uploads` history panel: collapsed-by-default list of every `.fit` the bridge has uploaded, grouped by filename. Click to expand → see the individual workouts/measurements per file. Useful for diagnosing "did the bridge actually upload this file?"

### Forecast

- `/forecast` page: per-day weather + air quality via Open-Meteo
- API + Air-Quality APIs (free, no key)
- Daily peak: synthwave-style per-day badge (go / caution / skip) with the best 2-hour window
- Per-activity advice: rings, running, cardio
- "Today" vs "Tonight" vs "Tomorrow" with afternoon peak highlighting
- Air quality card: US EPA AQI with PM2.5/PM10 raw values
- Fallback: workout-centroid auto-detect if user hasn't set home location

## Local dev (without Docker)

```bash
# Postgres (or use Docker for just the DB)
docker compose up postgres -d

# Install deps
npm install
npm run db:migrate    # creates schema
npm run db:seed       # seeds achievements + skills

# Run both api and web
npm run dev
```

- API: <http://localhost:3001>
- Web: <http://localhost:5173>

## Project structure

```
fitquest/                This repo — web + api
  api/                  Fastify backend
    prisma/
      schema.prisma     full data model
      seed.ts           achievements + skills seeder
    src/
      lib/              prisma, auth, geneticMax, pr, xp, achievements, skills, metrics
      routes/           auth, users, measurements, workouts, geneticMax, parties, raids, achievements, skills, prs
      index.ts          entry point
  web/                  Vite + React frontend (also builds into Android via Capacitor)
    src/
      components/       Gauge (cyberpunk SVG), Layout, Panel, NeonButton, BossBar, SkillNode, ProgressBar
      pages/            Login, Register, Dashboard, Workouts, Measurements, Skills, Party, Profile
      lib/              api, auth, types, format
    android/            Capacitor Android wrapper (output of `npx cap add android`)
    capacitor.config.ts Capacitor config (appId, androidScheme: 'https')
    dist/               Built web bundle (NOT committed — output of vite build)
  infra/
    Caddyfile           production reverse proxy example

fitquest-android/       Capacitor Android wrapper as a separate repo
  android/              Native Capacitor Android project
  src/                  New files added for mobile: apiUrl.ts, morningReminder.ts, FirstRunApiUrl.tsx, main.tsx
  capacitor.config.ts
  package.json
  README.md

fitquest-bridge/        Kotlin Gadgetbridge→FitQuest sync helper (PERSONAL USE)
  app/                  Standard Android Studio project
  ...
```

## Data model

See `api/prisma/schema.prisma`. Key tables:

- `User` (with body metrics, timezone, mode CASUAL/HARDCORE, heart state, latitude/longitude)
- `Measurement` (time-series of metric values, with `sourceFilename` for bridge uploads)
- `GeneticMax` (per-metric max, with source: FORMULA/MANUAL/PROJECTED)
- `Workout` → `Exercise` → `Set` (with `importSource` WEB/BRIDGE, `sourceFilename`)
- `PendingSkillUnlock` (the activity→skill match queue)
- `Pr` (auto-detected personal records)
- `Skill` + `UserSkill` (unlocked)
- `Party` → `PartyMember`
- `Raid` → `RaidContribution`
- `Achievement` + `UserAchievement`
- `Session` (auth)
- `WeatherCache` (forecast cache)
- `DailyLog`, `MorningReport` (cached for 7 days)
- `Spiritual` + `Examen` (reflection journal)
- `Inventory` + `ItemDef`
- `Brew*` tables (FitQuestBridge bridge-uploads inbox)

## Exporting your data

```bash
# Postgres dump
docker compose exec postgres pg_dump -U fitness fitquest > backup.sql

# Or from a local psql
pg_dump $DATABASE_URL > backup.sql
```

## Development tips

- API logs are pretty in dev (`pino-pretty`)
- Web uses Vite proxy: `/api/*` is rewritten to `http://localhost:3001/*` (this is a dev-only convenience — the api routes are at `/users`, `/measurements` etc. with no `/api` prefix)
- `npm run typecheck` in either workspace validates types
- `npx prisma studio` in `/api` opens a GUI for the DB

## Roadmap

### v0.2 — auth hardening & daily rituals
- [x] **Daily weigh-ins** — quick-log flow on the dashboard, streak counter, weight-trend chart
- [x] **Habit tracking** — sleep, nutrition, wellness + correlations + insights
- [x] **2FA / TOTP** — opt-in TOTP-based 2FA for accounts (recovery codes, backup flow)
- [x] **Rate limiting** on auth + write endpoints (Redis-backed)
- [ ] Email verification on signup + password reset flow (deferred — personal use, only one account)

### v0.3 — social & automation
- [x] **Skill tree v1** — 6 classes × 6 branches × 5 tiers, 196 skills, with auto-unlock from activities
- [x] **Pending skill unlock queue** — activity→skill match + one-tap confirm modal
- [x] **Daily weigh-in + habit tracking** — main daily loop
- [x] **Boss raids with world-class system** — 6 worlds, procedural variants
- [x] **Inventory + equipment + loadouts** — class-restricted gear
- [x] **Spiritual dailies + Examen journal** — daily Mass, weekly reflection
- [ ] **Auto raid damage from workouts** — each completed workout/log auto-contributes damage
- [ ] **WebSocket realtime** for raid updates (replace 5s polling)
- [ ] **Friend leaderboards** — per-class, per-metric, per-week
- [ ] **Daily/weekly quests** — auto-generated party challenges
- [ ] **Workout programs as quests** — linear/branching multi-week programs (e.g. "Starting Strength", "531 BBB") as in-game quest chains

### v0.4 — wearable & data integrations
- [x] **FitQuestBridge** — accept metric uploads (HRV, resting HR, sleep, weight, steps, water) from a side-loaded Kotlin APK on a rooted Android phone. Companion repo.
- [x] **Android app** — Capacitor 6 wrapper. Same web bundle in a native WebView with first-run api config + 8 AM morning reminder.
- [ ] **Health Connect / Google Fit** — read step + sleep + HR data from the device's native pipeline. Skipped in v1 because the user is on a non-Google device.
- [ ] **Generic webhook receiver** — accept JSON payloads from any source (configurable field mapping per metric)
- [ ] **CSV / JSON export** of all measurements, workouts, PRs

### v0.5 — polish & retention
- [ ] **PWA manifest + offline logging** — installable, background sync
- [ ] **Vitest test suite** — unit tests for geneticMax, PR detection, XP curves, achievement checker; integration tests for critical API routes
- [ ] **Achievement progress bars** (e.g. "67% to Sub-20 5K")
- [ ] **Gear/cosmetics** — gold sink: titles, profile borders, gauge skins
- [ ] **Calendar view** of workouts and measurements
- [ ] **OAuth providers** (GitHub, Google) alongside email/password
- [ ] **Body measurement photos** with diff view over time
- [ ] **Sound design pass** — replace default synth blips with hand-picked arcade-style recordings for each event
- [ ] **Body weight graph zoom** (Insights) — adjust yPad so the line shows more dynamism
- [x] **Bridge uploads history** — collapsed-by-default list of every file the bridge has uploaded

### Future ideas (unscheduled)
- [x] Native mobile app (Capacitor 6 wrapper in `fitquest-android` repo)
- [ ] Localization (i18n)
- [ ] Workout video library with form checks
- [ ] AI coach that suggests programs based on your stats
- [ ] Public profiles + profile sharing
- [ ] Streaming workouts / live party sessions

## Inspiration

- **[Habitica](https://habitica.com)** — gamification of habits/tasks (open source, but we built fresh)
- **[Endurain](https://github.com/9d8dev/Endurain)** — self-hosted endurance tracker, great reference for data model of multi-sport sessions
- **D&D character sheets** — visual stat layout inspiration
- **Cyberpunk 2077 / Tron** — visual aesthetic
- **Synthwave** — the morning reminder / FitQuestBridge sounds; the bridge icon; the log-in / new-user / recovery animations

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).

## Scripture Attribution

Daily Mass readings on the `/spiritual` page are sourced from the
**United States Conference of Catholic Bishops (USCCB)** via the
[USCCB Daily Readings RSS feed](https://bible.usccb.org/podcasts/daily-readings)
and are displayed under the following license:

> Excerpts from the *Lectionary for Mass for Use in the Dioceses of
> the United States of America*, second typical edition © 1998,
> 1997, 1986, 1970 Confraternity of Christian Doctrine, Washington,
> D.C. Used with permission. All rights reserved.
>
> Psalm refrains © 1968, 1981, 1997, International Committee on
> English in the Liturgy, Inc. (ICEL). All rights reserved.
>
> No part of the Lectionary for Mass may be reproduced,
> distributed, transmitted, or displayed in any medium, including
> electronic and digital, without permission in writing from the
> copyright owner.

The full copyright notice is fetched live with each reading but
stripped from the in-app display to keep the reading view focused
on the scripture text. The notice above is the canonical
attribution.

The app is a non-commercial, self-hosted tool for personal devotion
and is not affiliated with USCCB.
