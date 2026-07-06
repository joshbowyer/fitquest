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
import { workoutTemplateRoutes } from './routes/workoutTemplates.js';
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
import { plateauRoutes } from './routes/plateaus.js';
import { checkInRoutes } from './routes/checkIns.js';
import { activityInsightRoutes } from './routes/activityInsights.js';
import { metricInsightRoutes } from './routes/metricInsights.js';
import { importRoutes } from './routes/import.js';
import { examenRoutes } from './routes/examen.js';
import { homeBaseRoutes } from './routes/homeBase.js';
import { breachRoutes } from './routes/breach.js';
import { portalLeakRoutes } from './routes/portalLeaks.js';
import { shopRoutes } from './routes/shop.js';
import { petRoutes } from './routes/pets.js';
import { exportRoutes } from './routes/export.js';
import { forecastRoutes } from './routes/forecast.js';
import { geocodeRoutes } from './routes/geocode.js';
import { supplementsRoutes } from './routes/supplements.js';
import { substanceRoutes } from './routes/substances.js';
import { foodRoutes, savedFoodRoutes } from './routes/foods.js';
import { mealRoutes } from './routes/meals.js';
import { ensureAchievementsSeeded } from './lib/achievements.js';
import { ensureSkillsSeeded } from './lib/skills.js';
import { seedSkills } from './lib/seedSkills.js';
import { seedItems } from './lib/seedItems.js';
import { ensureDefaultAdmin } from './lib/seedAdmin.js';

async function build() {
  const app = Fastify({
    logger: config.isDev
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : true,
  });

  await app.register(cookie, { secret: config.cookieSecret });
  // /_debug/req — diagnostic: log every incoming request with
  // its path, method, cookies (names only), and the response
  // status. Lets the user see exactly what's coming into the
  // api when something 401s. Always on (no auth, no cost).
  // View with: curl https://<api>/_debug/req
  let lastReq: { path: string; method: string; status: number; cookies: string[]; ts: number; userAgent: string } | null = null;
  app.addHook('onRequest', async (req) => {
    const cookieNames = Object.keys(req.cookies || {});
    lastReq = {
      path: req.url,
      method: req.method,
      status: 0, // filled in by onResponse
      cookies: cookieNames,
      ts: Date.now(),
      userAgent: req.headers['user-agent'] || '',
    };
  });
  app.addHook('onResponse', async (req, reply) => {
    if (lastReq && lastReq.path === req.url && lastReq.method === req.method) {
      lastReq.status = reply.statusCode;
    }
    // Also log a one-liner so the user can scan the api container
    // logs for 401s and other failures.
    const cookieInfo = Object.keys(req.cookies || {}).join(',') || '-';
    app.log.info({
      path: req.url,
      method: req.method,
      status: reply.statusCode,
      cookies: cookieInfo,
    }, 'req');
  });
  app.get('/_debug/req', async () => ({ lastReq }));
  // CORS allowlist: primary web origin + the extra list. The
  // Capacitor app loads at https://localhost (its androidScheme)
  // so that needs to be in here, or the preflight for any
  // cross-origin fetch from the WebView to the api fails.
  // WEB_ORIGIN_EXTRA is a comma-separated list of additional
  // allowed origins for cases where the api domain != the web
  // domain (e.g. api.fitquest.app vs fitquest.app) — the user
  // types the api domain in the app's first-run prompt.
  await app.register(cors, {
    origin: [config.webOrigin, ...config.webOriginExtra],
    credentials: true,
  });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 50 },
  });

  app.get('/health', async () => ({ ok: true, ts: Date.now() }));

  // Debug endpoint: dev only. Returns the cookies + the
  // session+user state so the user can verify the WebView is
  // sending the right cookie. Used to debug "data gone in the
  // Capacitor app" where /users/me works but other routes 401.
  if (config.isDev) {
    app.get('/_debug/auth', async (req) => ({
      cookies: req.cookies,
      cookieHeader: req.headers.cookie ?? null,
      origin: req.headers.origin ?? null,
      host: req.headers.host ?? null,
    }));
  }

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(userRoutes, { prefix: '/users' });
  await app.register(measurementRoutes, { prefix: '/measurements' });
  await app.register(workoutRoutes, { prefix: '/workouts' });
  await app.register(workoutTemplateRoutes, { prefix: '/workout-templates' });
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
  await app.register(mealRoutes, { prefix: '/meals' });
  await app.register(spiritualRoutes, { prefix: '/spiritual' });
  await app.register(habitRoutes, { prefix: '/habits' });
  await app.register(dailyRoutes, { prefix: '/dailies' });
  await app.register(adminRoutes, { prefix: '/admin' });
  await app.register(morningReportRoutes, { prefix: '/morning-report' });
  await app.register(checkInRoutes);
  await app.register(activityInsightRoutes);
  await app.register(metricInsightRoutes);
  await app.register(plateauRoutes, { prefix: '/plateaus' });
  await app.register(examenRoutes, { prefix: '/examen' });
  await app.register(homeBaseRoutes, { prefix: '/home-base' });
  await app.register(breachRoutes, { prefix: '/breach' });
  await app.register(portalLeakRoutes, { prefix: '/portal-leak' });
  await app.register(shopRoutes, { prefix: '/shop' });
  await app.register(petRoutes, { prefix: '/pet' });
  await app.register(forecastRoutes, { prefix: '/forecast' });
  await app.register(geocodeRoutes, { prefix: '/geocode' });
  await app.register(exportRoutes, { prefix: '' });

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
  // Seed achievements, skills, and item catalog (idempotent).
  // Every item now declares its own sprite path (items/<id>.png);
  // the upsert's `update` block rewrites the sprite on any
  // existing row whose id matches one in the ITEMS list, so this
  // is also the migration path off the old habitica/legacy sprite
  // paths in prod. No separate remap pass needed.
  await ensureAchievementsSeeded();
  await seedSkills();
  await seedItems();
  // System-default penance templates live as constants in
  // api/src/lib/penance.ts (PENANCE_DELTAS + PENANCE_LABELS +
  // PENANCE_FLAVORS). No DB seed needed — the constants are
  // always available.

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

  // Portal-leak daily tick — grows active leaks by +8 HP/day so an
  // un-engaged leak escalates. Leaks no longer expire (see
  // portalLeaks.ts MAX_ACTIVE_LEAKS comment for the user-feedback
  // rationale — leaks are the user's punishment for slipping, and
  // expiring them softened that). Runs every hour (cheap; just a
  // SELECT + UPDATE per active leak) so a leak born mid-day sees
  // its +8 growth tick before the user logs again. Runs at
  // minute-past-the-hour.
  const leakTick = () => {
    setTimeout(async () => {
      try {
        const { tickLeakGrowth } = await import('./lib/portalLeaks.js');
        const r = await tickLeakGrowth();
        if (r.ticked > 0) {
          app.log.info(r, 'portal leak hourly tick');
        }
      } catch (err: any) {
        app.log.warn({ err: String(err?.message ?? err) }, 'portal leak tick failed');
      }
      leakTick();
    }, 60 * 60 * 1000); // 1h
  };
  leakTick();
  app.log.info('portal leak hourly tick scheduled');

  // Plateau snapshot cron — Sunday 22:00 local. Runs detectPlateaus
  // for every active user and persists the result so the dashboard
  // can show a stale-badge count without forcing a morning-report
  // regeneration on every page load. Failed per-user runs are
  // caught + logged so one broken detector doesn't poison the batch.
  const plateauNow = new Date();
  const plateauFireAt = new Date(plateauNow.getTime());
  plateauFireAt.setHours(22, 0, 0, 0);
  if (plateauFireAt.getTime() <= plateauNow.getTime()) plateauFireAt.setDate(plateauFireAt.getDate() + ((7 - plateauFireAt.getDay() + 7) % 7) + 1);
  const plateauMs = plateauFireAt.getTime() - plateauNow.getTime();
  app.log.info({ msUntilNext: plateauMs }, 'plateau snapshot scheduled');
  setTimeout(() => {
    (async () => {
      try {
        const { refreshAllPlateauSnapshots } = await import('./lib/plateauSnapshot.js');
        const r = await refreshAllPlateauSnapshots();
        app.log.info(r, 'plateau weekly snapshot complete');
      } catch (err: any) {
        app.log.warn({ err: String(err?.message ?? err) }, 'plateau weekly snapshot failed');
      }
    })();
    setInterval(async () => {
      try {
        const { refreshAllPlateauSnapshots } = await import('./lib/plateauSnapshot.js');
        const r = await refreshAllPlateauSnapshots();
        app.log.info(r, 'plateau weekly snapshot complete');
      } catch (err: any) {
        app.log.warn({ err: String(err?.message ?? err) }, 'plateau weekly snapshot failed');
      }
    }, 7 * 24 * 60 * 60 * 1000);
  }, plateauMs);

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
