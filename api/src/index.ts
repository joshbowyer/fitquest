import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { config } from './lib/config.js';
import { prisma } from './lib/prisma.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { measurementRoutes } from './routes/measurements.js';
import { workoutRoutes } from './routes/workouts.js';
import { geneticMaxRoutes } from './routes/geneticMax.js';
import { partyRoutes } from './routes/parties.js';
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
import { importRoutes } from './routes/import.js';
import { supplementRoutes } from './routes/supplements.js';
import { ensureAchievementsSeeded } from './lib/achievements.js';
import { ensureSkillsSeeded } from './lib/skills.js';
import { seedItems } from './lib/seedItems.js';

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
  await app.register(supplementRoutes, { prefix: '/supplements' });
  await app.register(spiritualRoutes, { prefix: '/spiritual' });
  await app.register(habitRoutes, { prefix: '/habits' });
  await app.register(dailyRoutes, { prefix: '/dailies' });

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
  // Seed achievements, skills, and item catalog (idempotent)
  await ensureAchievementsSeeded();
  await ensureSkillsSeeded();
  await seedItems();

  const app = await build();
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`fitquest API listening on http://${config.host}:${config.port}`);

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
