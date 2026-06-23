import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { config } from './lib/config.js';
import { prisma } from './lib/prisma.js';
import { seedUpcomingReadings } from './lib/usccb.js';
import { snapshotAllUsers } from './lib/correlations.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { measurementRoutes } from './routes/measurements.js';
import { workoutRoutes } from './routes/workouts.js';
import { geneticMaxRoutes } from './routes/geneticMax.js';
import { partyRoutes } from './routes/parties.js';
import { teamWorkoutRoutes } from './routes/teamWorkouts.js';
import { raidRoutes } from './routes/raids.js';
import { achievementRoutes } from './routes/achievements.js';
import { skillRoutes } from './routes/skills.js';
import { prRoutes } from './routes/prs.js';
import { exerciseRoutes } from './routes/exercises.js';
import { insightRoutes } from './routes/insights.js';
import { avatarRoutes } from './routes/avatar.js';
import { inventoryRoutes, itemRoutes } from './routes/inventory.js';
import { questRoutes } from './routes/quest.js';
import { painLogRoutes } from './routes/painLogs.js';
import { statusRoutes } from './routes/status.js';
import { routineRoutes } from './routes/routine.js';
import { bossRoutes } from './routes/bosses.js';
import { spiritualRoutes } from './routes/spiritual.js';
import { habitRoutes } from './routes/habits.js';
import { dailyRoutes } from './routes/dailies.js';
import { adminRoutes } from './routes/admin.js';
import { morningReportRoutes } from './routes/morningReport.js';
import { checkInRoutes } from './routes/checkIns.js';
import { activityInsightRoutes } from './routes/activityInsights.js';
import { importRoutes } from './routes/import.js';
import { supplementsRoutes } from './routes/supplements.js';
import { substanceRoutes } from './routes/substances.js';
import { foodRoutes, savedFoodRoutes, foodYouImportRoutes } from './routes/foods.js';
import { mealRoutes } from './routes/meals.js';
import { ensureAchievementsSeeded } from './lib/achievements.js';
import { ensureSkillsSeeded } from './lib/skills.js';
import { seedItems } from './lib/seedItems.js';
import { ensureDefaultAdmin } from './lib/seedAdmin.js';

async function build() {
  const app = Fastify({
    logger: config.isDev
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : true,
  });

  await app.register(cookie, { secret: config.cookieSecret });
  await app.register(cors, {
    origin: config.webOrigin,
    credentials: true,
  });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 50 },
  });

  app.get('/health', async () => ({ ok: true, ts: Date.now() }));

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(userRoutes, { prefix: '/users' });
  await app.register(measurementRoutes, { prefix: '/measurements' });
  await app.register(workoutRoutes, { prefix: '/workouts' });
  await app.register(geneticMaxRoutes, { prefix: '/genetic-max' });
  await app.register(partyRoutes, { prefix: '/parties' });
  await app.register(teamWorkoutRoutes, { prefix: '/team-workouts' });
  await app.register(raidRoutes, { prefix: '/raids' });
  await app.register(achievementRoutes, { prefix: '/achievements' });
  await app.register(skillRoutes, { prefix: '/skills' });
  await app.register(prRoutes, { prefix: '/prs' });
  await app.register(exerciseRoutes, { prefix: '/exercises' });
  await app.register(insightRoutes, { prefix: '/insights' });
  await app.register(avatarRoutes, { prefix: '/avatar' });
  await app.register(inventoryRoutes, { prefix: '/inventory' });
  await app.register(itemRoutes, { prefix: '/items' });
  await app.register(questRoutes, { prefix: '/quest' });
  await app.register(painLogRoutes, { prefix: '/pain-logs' });
  await app.register(statusRoutes, { prefix: '/status' });
  await app.register(routineRoutes, { prefix: '/routine' });
  await app.register(bossRoutes, { prefix: '/bosses' });
  await app.register(importRoutes, { prefix: '/import' });
  await app.register(supplementsRoutes, { prefix: '/supplements' });
  await app.register(substanceRoutes, { prefix: '/substances' });
  await app.register(foodRoutes, { prefix: '/foods' });
  await app.register(savedFoodRoutes);
  await app.register(foodYouImportRoutes);
  await app.register(mealRoutes, { prefix: '/meals' });
  await app.register(spiritualRoutes, { prefix: '/spiritual' });
  await app.register(habitRoutes, { prefix: '/habits' });
  await app.register(dailyRoutes, { prefix: '/dailies' });
  await app.register(adminRoutes, { prefix: '/admin' });
  await app.register(morningReportRoutes, { prefix: '/morning-report' });
  await app.register(checkInRoutes);
  await app.register(activityInsightRoutes);

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, 'request error');
    if ('validation' in (err as any) || (err as any).code === 'FST_ERR_VALIDATION') {
      return reply.code(400).send({ error: 'Invalid request', details: (err as any).message });
    }
    if ((err as any).statusCode === 401) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    if ((err as any).statusCode === 423) {
      return reply.code(423).send({
        error: (err as any).message,
        classLock: (err as any).classLock,
      });
    }
    return reply.code(500).send({ error: 'Internal server error' });
  });

  return app;
}

async function main() {
  // Seed default admin (only if User table is empty)
  await ensureDefaultAdmin();
  // Seed achievements, skills, and item catalog (idempotent)
  await ensureAchievementsSeeded();
  await ensureSkillsSeeded();
  await seedItems();

  const app = await build();
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`fitquest API listening on http://${config.host}:${config.port}`);

  // USCCB daily readings: pre-cache the next 7 days on startup
  // so the spiritual director never has to wait on a cold fetch
  // + the RSS is the freshest source for the next 10 days. Any
  // dates RSS misses (e.g. today if the RSS hasn't published yet)
  // fall through to the Wayback Machine fallback inside
  // seedUpcomingReadings.
  try {
    const result = await seedUpcomingReadings(7);
    app.log.info(
      { fromCache: result.fromCache, fromWayback: result.fromWayback, failed: result.failed },
      'usccb readings seeded for next 7 days',
    );
  } catch (err: any) {
    app.log.warn({ err: String(err?.message ?? err) }, 'usccb seedUpcomingReadings failed on startup');
  }

  // Refresh once a day. Calendar-aligned to 04:30 EDT which is
  // when USCCB typically publishes — we want the new day's reading
  // to be in the cache shortly after it goes live. Falls back to
  // 24h from startup if the scheduler can't be aligned.
  const scheduleDaily = (cb: () => Promise<void>) => {
    const tick = async () => {
      try {
        await cb();
      } catch (err: any) {
        app.log.warn({ err: String(err?.message ?? err) }, 'usccb daily refresh failed');
      }
    };
    const now = new Date();
    const next = new Date(now.getTime());
    // 04:30 USCCB publish window. Compute next 04:30 in local tz;
    // we don't bother with tz math because the publish is
    // approximately +0..+30min from 04:30 EDT, and missing by an
    // hour is fine — the cache is good for the full day.
    next.setHours(4, 30, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    const ms = next.getTime() - now.getTime();
    app.log.info({ msUntilNext: ms }, 'usccb daily refresh scheduled');
    setTimeout(() => {
      tick();
      setInterval(tick, 24 * 60 * 60 * 1000);
    }, ms);
  };
  scheduleDaily(async () => {
    const r = await seedUpcomingReadings(7);
    app.log.info(r, 'usccb daily refresh complete');
  });

  // Correlation snapshot cron — 03:30 local is fine for the
  // Pearson-r pipeline too (it scans the last 90 days, so any
  // new data from yesterday's weigh-ins gets picked up). Run
  // before USCCB's daily refresh so the morning report's
  // correlation narrative (when wired) reads from fresh rows.
  // Using a separate scheduleDaily so failures don't block the
  // USCCB refresh.
  const correlationNow = new Date();
  const correlationFireAt = new Date(correlationNow.getTime());
  correlationFireAt.setHours(3, 30, 0, 0);
  if (correlationFireAt.getTime() <= correlationNow.getTime()) correlationFireAt.setDate(correlationFireAt.getDate() + 1);
  const corrMs = correlationFireAt.getTime() - correlationNow.getTime();
  app.log.info({ msUntilNext: corrMs }, 'correlation snapshot scheduled');
  setTimeout(() => {
    (async () => {
      try {
        const r = await snapshotAllUsers();
        app.log.info(r, 'correlation nightly snapshot complete');
      } catch (err: any) {
        app.log.warn({ err: String(err?.message ?? err) }, 'correlation nightly snapshot failed');
      }
    })();
    setInterval(async () => {
      try {
        const r = await snapshotAllUsers();
        app.log.info(r, 'correlation nightly snapshot complete');
      } catch (err: any) {
        app.log.warn({ err: String(err?.message ?? err) }, 'correlation nightly snapshot failed');
      }
    }, 24 * 60 * 60 * 1000);
  }, corrMs);

  const shutdown = async () => {
    app.log.info('shutting down');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
