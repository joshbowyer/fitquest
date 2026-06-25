# FitQuest

A self-hosted personal fitness RPG. D&D-style stat sheet, Habitica-inspired gamification, cyberpunk neon HUD.

Your body metrics — bicep, bench 1RM, VO2 max, body fat % — are visualized as **gauges** showing your **current value against your genetic ceiling**. Workout sessions earn XP, auto-detect PRs, and contribute damage to **co-op boss raids** with your party. Class-based skill trees (Bodybuilder, Powerlifter, Calisthenist, Endurance, Hybrid) shape your progression.

![stack](https://img.shields.io/badge/stack-Fastify%20%2B%20Prisma%20%2B%20Postgres%20%2B%20React-00f0ff?style=flat-square)

## Stack

- **Backend:** Node 22 + Fastify 5 + Prisma 5 + PostgreSQL 16
- **Auth:** session cookies (HTTP-only, signed)
- **Frontend:** React 18 + Vite 5 + TailwindCSS 3 + Recharts
- **Realtime-ready:** party raid state is polled; can be upgraded to WebSockets
- **Containerized:** multi-stage Dockerfiles, single `docker compose up`

## Quick start (Docker)

```bash
git clone https://github.com/joshbowyer/fitquest
cd fitquest
cp .env.example .env
# Edit COOKIE_SECRET to a long random string
docker compose up --build
```

Then open <http://localhost:8080>.

- API: <http://localhost:3001>
- Postgres: `localhost:5432` (user/pass: `fitness`/`fitness`)

### Production with Caddy (optional)

```bash
docker compose --profile production up --build
```

Add `WEB_DOMAIN=fit.example.com` to `.env` and point DNS at the host. Caddy handles TLS automatically.

## Deploy via Portainer (no git clone needed)

The simplest deploy path uses [Portainer](https://www.portainer.io/)'s
"Web editor" stack mode. Images are auto-built and pushed to GitHub
Container Registry (ghcr.io) by the `.github/workflows/build-images.yml`
workflow on every push to `main`.

**One-time setup:**

1. Make the repo's GitHub Actions workflow run. It builds `api` and `web`
   images and pushes them to `ghcr.io/joshbowyer/fitquest-api:latest` and
   `ghcr.io/joshbowyer/fitquest-web:latest`. Wait for the first build to
   finish (Actions tab on GitHub).
2. In Portainer, go to **Stacks → Add stack → Web editor**.
3. Paste the contents of [`docker-compose.portainer.yml`](./docker-compose.portainer.yml).
4. In the **Environment variables** section, set at minimum:
   - `COOKIE_SECRET` — `openssl rand -hex 32`
   - `WEB_ORIGIN` — your public URL (e.g. `https://fit.example.com` or
     `http://your-server-ip:8080` if no reverse proxy)
5. Click **Deploy the stack**.

The stack uses the latest images from ghcr.io. To pin a specific version,
change `:latest` to a commit SHA tag (e.g. `:sha-abc1234`) in the compose
file — the workflow builds these tags automatically too.

**Updating:** Portainer's **Stacks → [your stack] → Pull and redeploy**
fetches the new `:latest` image and restarts the containers.

### Alternative: Portainer "Git repository" mode

If you prefer Portainer to build from source instead of pulling pre-built
images, use the existing `docker-compose.yml`:

1. Portainer → **Stacks → Add stack → Git repository**.
2. **Repository URL**: `https://github.com/joshbowyer/fitquest`
3. **Compose path**: `docker-compose.yml`
4. **Environment variables**: same as above.
5. Click **Deploy**. Portainer clones the repo and builds the api/web
   images from the Dockerfiles.

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
api/                  Fastify backend
  prisma/
    schema.prisma     full data model
    seed.ts           achievements + skills seeder
  src/
    lib/              prisma, auth, geneticMax, pr, xp, achievements, skills, metrics
    routes/           auth, users, measurements, workouts, geneticMax, parties, raids, achievements, skills, prs
    index.ts          entry point
web/                  Vite + React frontend
  src/
    components/       Gauge (cyberpunk SVG), Layout, Panel, NeonButton, BossBar, SkillNode, ProgressBar
    pages/            Login, Register, Dashboard, Workouts, Measurements, Skills, Party, Profile
    lib/              api, auth, types, format
    App.tsx           router + auth guards
infra/
  Caddyfile           production reverse proxy
```

## Features

### Stat sheet
- 22+ metrics across hypertrophy (circumferences), strength (1RMs), body comp, cardio, calisthenics
- Each metric visualized as a 270° cyberpunk gauge with:
  - Min baseline (default untrained value)
  - Genetic max (formula-derived, with manual override)
  - Current value (latest measurement)
  - % of max
  - Animated fill, neon glow, tick marks
- Genetic max formulas include:
  - **McCallum proportions** (bicep = wrist, chest = wrist × 6, etc.)
  - **FFMI ceiling** (natural ~25-26)
  - **Bodyweight-relative strength** (bench 1.5x BW, squat 2.25x BW, deadlift 2.75x BW)
  - **Age-adjusted VO2 max**
  - All overridable per-metric in Measurements page

### Classes & skill trees
5 classes × 5 skills each, 3 tiers:

| Class | Vibe | Key skills |
|---|---|---|
| Bodybuilder | Hypertrophy-focused, magenta | Mind-Muscle, PPL Specialist, Volume Tolerance, Body Comp Insight, Aesthetician |
| Powerlifter | Strength-focused, cyan | Bracing, Conjugate, Pause Specialist, Intensity King, Total Domination |
| Calisthenist | Bodyweight mastery, lime | Static Holds, Body Awareness, Dynamic Skills, One-Arm Path, Skill Mastery |
| Endurance | Cardio engine, amber | Zone 2, Aerobic Engine, Lactate Threshold, HRV Reader, VO2 Peak |
| Hybrid | Jack-of-all, violet | Adaptation, Recovery, Jack-of-All, Generalist, Master of None |

Skill points gained per level. Each skill applies effects (XP multiplier, gold multiplier, raid damage, genetic max bonus).

### Workout tracking
- Log any session: strength, hypertrophy, calisthenics, cardio, mobility
- Add exercises + sets (reps/weight/duration/RPE)
- **PR auto-detection** per exercise using Epley 1RM estimation
- **XP/gold rewards** scaled by total volume, duration, and PRs
- Achievements unlocked automatically after each action

### Parties & raids
- Create or join a party
- Leader/officer starts a boss raid with custom HP and name
- All members contribute "damage" (manually for now; can be wired to workouts)
- Victory distributes XP + gold based on contribution share
- 5 starter bosses (Iron Colossus, Cardio Wyrm, The Plateau, Skeletal Minion, BPM Demon)

### Daily weigh-ins
- Prominent dashboard panel: today's weight, current streak, longest streak
- 7-day sparkline with current-vs-baseline reference line
- 7-day delta indicator (gaining / losing trend)
- One-click log with Enter-to-submit
- Unlocks 4 achievements: first weigh-in, 7-day, 14-day, 30-day streak

### Habit tracking
- New **Habits** page with 3 categories: Sleep, Nutrition, Wellness
- **9 new metrics:** Sleep (hours + quality), Nutrition (calories + protein + water), Wellness (mood + energy + soreness + stress)
- Subjective 1-10 scales (mood/energy/soreness/stress) use range sliders with auto-commit on release
- Numeric fields commit on Enter or via "Save all" button
- "Today's Habits" mini-panel on dashboard with per-category progress + inline quick-log
- Per-category streak achievements: 7-day and 30-day for Sleep, Nutrition, Wellness (6 total)
- History viewer with 30-day trend chart and average reference line

### Recovery & insights
- **Recovery score (0-100)** on the dashboard, computed from 8 weighted metrics
  - HRV vs your 30-day baseline (25%) — best single signal
  - Sleep hours (20%, piecewise 7-9h optimal)
  - Resting HR vs your 30-day baseline (15%, inverted)
  - Sleep quality, soreness, stress, energy, mood (5-10% each)
  - Missing metrics are handled by redistributing their weight across what's available
  - 7-day rolling average trend with delta indicator
  - Per-component breakdown bars with raw value + reason
- **Correlations** — Pearson r over 60 days between 11 habit metrics and 4 training outcomes
  - Outcomes: workout volume, avg RPE, PR count, next-day energy/mood
  - Top 10 returned, sorted by |r|, requires ≥7 paired observations
  - Full /insights page buckets them into strong / moderate / weak
- **Personalized tips** — combine recovery + correlations into 3-5 actionable lines
  - Low recovery → "PRIMED" or "DEPLETED" status, biggest drag identified
  - Strong correlation → "Sleep hours strongly boost your bench volume (r=0.78, n=14)."
  - Coverage gap → "You haven't logged HRV in 5 days. Closing this gap unlocks correlations."
  - Insufficient data → "Log a few days of sleep + workouts to unlock insights."

### Achievements
40+ achievements across:
- Consistency (workout count, weigh-in streaks, sleep/nutrition/wellness streaks)
- Strength (relative-to-BW milestones: bench 1x/1.5x/2x BW, squat 2x/2.5x BW, deadlift 2.5x/3x BW)
- Hypertrophy (bicep 40/45cm)
- Body comp (FFMI 22/24)
- Endurance (VO2 45/55, sub-25/sub-20 5K)
- Calisthenics (plank 60s/3min, L-sit 30s)
- Social (party join, raid victory)

## Data model

See `api/prisma/schema.prisma`. Key tables:

- `User` (with body metrics for formulas)
- `Measurement` (time-series of metric values)
- `GeneticMax` (per-metric max, with source: FORMULA/MANUAL/PROJECTED)
- `Workout` → `Exercise` → `Set`
- `Pr` (auto-detected personal records)
- `Skill` + `UserSkill` (unlocked)
- `Party` → `PartyMember`
- `Raid` → `RaidContribution`
- `Achievement` + `UserAchievement`
- `Session` (auth)

## Exporting your data

```bash
# Postgres dump
docker compose exec postgres pg_dump -U fitness fitquest > backup.sql

# Or from a local psql
pg_dump $DATABASE_URL > backup.sql
```

## Development tips

- API logs are pretty in dev (`pino-pretty`)
- Web uses Vite proxy: `/api/*` is rewritten to `http://localhost:3001/*`
- `npm run typecheck` in either workspace validates types
- `npx prisma studio` in `/api` opens a GUI for the DB

## Roadmap

### v0.2 — auth hardening & daily rituals
- [ ] **2FA / TOTP** — opt-in TOTP-based 2FA for accounts (recovery codes, backup flow)
- [x] **Daily weigh-ins** — quick-log flow on the dashboard, streak counter, weight-trend chart
- [x] **Habit tracking** — sleep, nutrition, wellness (logging complete; correlations/insights next)
- [ ] **Email verification** on signup + password reset flow
- [ ] **Rate limiting** on auth + write endpoints (Redis-backed)

### v0.3 — social & automation
- [ ] **Auto raid damage from workouts** — each completed workout/log auto-contributes damage proportional to volume & PRs
- [ ] **WebSocket realtime** for raid updates (replace 5s polling)
- [ ] **Friend leaderboards** — per-class, per-metric, per-week
- [ ] **Daily/weekly quests** — auto-generated party challenges
- [ ] **Workout programs as quests** — linear/branching multi-week programs (e.g. "Starting Strength", "531 BBB") as in-game quest chains

### v0.4 — wearable & data integrations
- [ ] **Gadgetbridge integration** — accept metric uploads (HRV, resting HR, sleep, weight, steps) from Gadgetbridge's HTTP receiver. Map into Measurement table.
- [ ] **Endurain-inspired features** — research the [Endurain](https://github.com/9d8dev/Endurain) project for ideas on endurance-specific flows (multi-sport sessions, training load, recovery scoring)
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
- [x] **Habit correlations & insights** — Pearson correlations between sleep, mood, energy, soreness, HRV vs workout performance and PRs; "you PR more after 7+ hrs sleep" type insights

### Future ideas (unscheduled)
- Native mobile app (Tauri or React Native)
- Localization (i18n)
- Workout video library with form checks
- AI coach that suggests programs based on your stats
- Public profiles + profile sharing
- Streaming workouts / live party sessions

## Inspiration

- **[Habitica](https://habitica.com)** — gamification of habits/tasks (open source, but we're building fresh)
- **[Endurain](https://github.com/9d8dev/Endurain)** — self-hosted endurance tracker, great reference for data model of multi-sport sessions
- **D&D character sheets** — visual stat layout inspiration
- **Cyberpunk 2077 / Tron** — visual aesthetic

## License

MIT

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
