import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const rows: Array<Record<string, unknown> & { loggedAt: Date }> = [];
  const daily = {
    id: 'daily-1',
    userId: 'u1',
    goldReward: 0,
    xpReward: 0,
  };
  let nextId = 1;
  return { rows, daily, nextId };
});

vi.mock('../lib/prisma', () => ({
  DayOfWeek: { SUN: 'SUN', MON: 'MON', TUE: 'TUE', WED: 'WED', THU: 'THU', FRI: 'FRI', SAT: 'SAT' },
  DailyCategory: { USER: 'USER', WORKOUT: 'WORKOUT', SPIRITUAL: 'SPIRITUAL' },
  prisma: {
    daily: {
      findUnique: vi.fn(async () => h.daily),
      findMany: vi.fn(async () => []),
    },
    dailyLog: {
      findFirst: vi.fn(async ({ where }: any) =>
        h.rows.find((row) => row.userId === where.userId
          && row.dailyKey === where.dailyKey
          && row.loggedAt >= where.loggedAt.gte) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `log-${h.nextId++}`, ...data };
        h.rows.push(row);
        return row;
      }),
      findMany: vi.fn(async () => []),
    },
    routineDay: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('../lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1', timezone: 'UTC' })),
}));

vi.mock('../lib/achievements', () => ({
  checkAchievements: vi.fn(async () => undefined),
}));

vi.mock('../lib/award', () => ({
  awardXpGold: vi.fn(async () => ({ gold: 0, xp: 0 })),
}));

import Fastify from 'fastify';
import { dailyRoutes } from '../routes/dailies';
import { localMidnightUtc, todayInTz } from '../lib/timezone';

function buildApp() {
  const app = Fastify();
  app.setErrorHandler((err: any, _req, reply) => {
    if (err?.name === 'ZodError' || Array.isArray(err?.issues)) {
      return reply.code(400).send({ error: 'zod' });
    }
    return reply.code(500).send({ error: err?.message ?? 'test' });
  });
  app.register(dailyRoutes, { prefix: '/dailies' });
  return app;
}

function previousDate(date: string): string {
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

beforeEach(() => {
  h.rows.length = 0;
  h.nextId = 1;
});

describe('POST /dailies/:id/complete with an explicit date', () => {
  it('stores a missed daily in the requested day and keeps today idempotency separate', async () => {
    const app = buildApp();
    const today = todayInTz('UTC');
    const pastDate = previousDate(today);
    const pastStart = localMidnightUtc(pastDate, 'UTC');
    const todayStart = localMidnightUtc(today, 'UTC');

    const pastResponse = await app.inject({
      method: 'POST',
      url: '/dailies/daily-1/complete',
      payload: { date: pastDate },
    });
    expect(pastResponse.statusCode).toBe(200);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]?.loggedAt).toEqual(pastStart);
    expect((h.rows[0]?.loggedAt as Date).getTime()).toBeLessThan(todayStart.getTime());

    // The existing Today-page flow omits date and must create today's
    // instance rather than colliding with the backdated completion.
    const todayResponse = await app.inject({
      method: 'POST',
      url: '/dailies/daily-1/complete',
    });
    expect(todayResponse.statusCode).toBe(200);
    expect(h.rows).toHaveLength(2);
    expect(h.rows[1]?.loggedAt).toEqual(todayStart);

    const repeatPastResponse = await app.inject({
      method: 'POST',
      url: '/dailies/daily-1/complete',
      payload: { date: pastDate },
    });
    expect(repeatPastResponse.statusCode).toBe(200);
    expect(repeatPastResponse.json().alreadyDone).toBe(true);
    expect(h.rows).toHaveLength(2);
  });
});
