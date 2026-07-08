/**
 * Tests for the WEIGHT check in the morning-popup recap.
 *
 * Bug being fixed: the recap's `weighInLogged` boolean used to be
 * computed by taking the SINGLE most recent WEIGHT measurement
 * and checking whether its `recordedAt` fell in the target day's
 * window. That's wrong — a user who weighed in on day X-1 (most
 * recent) AND on day X-2 (older) would show weighInLogged=false
 * for X-2 even though they had a measurement that day. The
 * user's report: "I have weigh-in data for every day but the
 * calendar shows empty" — the morning-popup is what the calendar
 * uses to render the per-day BLUF, so the bug surfaced there.
 *
 * The fix is a direct day-windowed WEIGHT query (filtered by
 * recordedAt) for the boolean, plus a separate unfiltered query
 * for the "most recent known weight" fallback display.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
  // Seeded WEIGHT measurements, indexed by id. The mock's
  // measurement.findFirst filters this list using the `where`
  // clause the route passes.
  type Weight = {
    id: string;
    userId: string;
    metric: 'WEIGHT';
    value: number;
    unit: 'kg';
    recordedAt: Date;
  };
  const weights: Weight[] = [];
  let nextId = 1;
  const user = { id: 'u1', timezone: 'UTC', level: 4, xp: 120, mode: 'CASUAL', hearts: 5 };
  return { weights, user, nextId };
});

vi.mock('../lib/prisma', () => ({
  DayOfWeek: { SUN: 'SUN', MON: 'MON', TUE: 'TUE', WED: 'THU', THU: 'THU', FRI: 'FRI', SAT: 'SAT' },
  DailyCategory: { USER: 'USER', WORKOUT: 'WORKOUT', SPIRITUAL: 'SPIRITUAL' },
  prisma: {
    morningPopupDismissal: {
      upsert: vi.fn(),
      findUnique: vi.fn(async () => null),
    },
    user: {
      findUnique: vi.fn(async () => ({
        level: h.user.level,
        xp: h.user.xp,
        mode: h.user.mode,
        hearts: h.user.hearts,
        heartsLastRegenAt: null,
      })),
    },
    // The two WEIGHT queries + the SLEEP_HOURS query. The mock
    // inspects `where` to decide which seed rows to return.
    measurement: {
      findFirst: vi.fn(async ({ where }: any) => {
        const matches = h.weights.filter((w) => {
          if (where.userId && w.userId !== where.userId) return false;
          if (where.metric && w.metric !== where.metric) return false;
          if (where.recordedAt?.gte && w.recordedAt < where.recordedAt.gte) return false;
          if (where.recordedAt?.lt && w.recordedAt >= where.recordedAt.lt) return false;
          return true;
        });
        if (matches.length === 0) return null;
        // orderBy: { recordedAt: 'desc' } — most recent first.
        matches.sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
        return matches[0];
      }),
    },
    workout: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    heartLossEvent: { findMany: vi.fn(async () => []) },
    daily: { findMany: vi.fn(async () => []) },
    dailyLog: { findMany: vi.fn(async () => []) },
    routineDay: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('../lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1', timezone: h.user.timezone })),
}));

vi.mock('../lib/recovery', () => ({
  computeRecovery: vi.fn(async () => ({ score: null })),
}));

import Fastify from 'fastify';
import { dailyRoutes } from '../routes/dailies';

function buildApp() {
  const app = Fastify();
  app.setErrorHandler((err: any, _req, reply) => {
    if (err?.name === 'ZodError' || Array.isArray(err?.issues)) return reply.code(400).send({ error: 'zod' });
    return reply.code(500).send({ error: err?.message ?? 'test' });
  });
  app.register(dailyRoutes, { prefix: '/dailies' });
  return app;
}

// Seed a WEIGHT measurement. `dayOffset` = -1 → yesterday 12:00 UTC,
// 0 → today 12:00 UTC, +1 → tomorrow 12:00 UTC.
function seedWeight(value: number, dayOffset: number) {
  const base = new Date(Date.UTC(2026, 6, 8, 12, 0, 0)); // 2026-07-08 12:00 UTC
  const at = new Date(base.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  h.weights.push({
    id: `w-${h.nextId++}`,
    userId: 'u1',
    metric: 'WEIGHT',
    value,
    unit: 'kg',
    recordedAt: at,
  });
}

beforeEach(() => {
  h.weights.length = 0;
  h.user.timezone = 'UTC';
  h.nextId = 1;
});

describe('GET /dailies/morning-popup — weigh-in check', () => {
  it('weighInLogged=true when a WEIGHT exists on the target day', async () => {
    seedWeight(80.5, 0); // today
    const res = await buildApp().inject({
      method: 'GET',
      url: '/dailies/morning-popup?date=2026-07-08',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recap.weighInLogged).toBe(true);
    expect(body.recap.latestWeightKg).toBe(80.5);
  });

  it('weighInLogged=false when no WEIGHT exists on the target day', async () => {
    seedWeight(80.5, -1); // yesterday
    const res = await buildApp().inject({
      method: 'GET',
      url: '/dailies/morning-popup?date=2026-07-08',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recap.weighInLogged).toBe(false);
    // Falls back to the most recent weight for the display value
    expect(body.recap.latestWeightKg).toBe(80.5);
  });

  it('REGRESSION: weighInLogged=true for a past day when a WEIGHT exists on that day, even if a more recent WEIGHT exists', async () => {
    // The bug: previous code only checked the SINGLE most recent
    // WEIGHT. So this scenario (weighed in 2 days ago, AGAIN
    // yesterday, asking about 2 days ago) used to incorrectly
    // report weighInLogged=false because the most recent was
    // yesterday, not 2 days ago.
    seedWeight(80.0, -2); // 2 days ago
    seedWeight(79.5, -1); // yesterday (most recent)
    const res = await buildApp().inject({
      method: 'GET',
      url: '/dailies/morning-popup?date=2026-07-06', // 2 days ago
    });
    const body = res.json();
    expect(body.recap.weighInLogged).toBe(true);
    // The display value for 2 days ago is the 80.0 measurement
    // from that day, not the more recent 79.5 from yesterday.
    expect(body.recap.latestWeightKg).toBe(80.0);
  });

  it('uses the target-day weight for display, not a more-recent weight', async () => {
    seedWeight(78.0, -2);
    seedWeight(78.5, 0);  // today
    const res = await buildApp().inject({
      method: 'GET',
      url: '/dailies/morning-popup?date=2026-07-08',
    });
    const body = res.json();
    expect(body.recap.weighInLogged).toBe(true);
    expect(body.recap.latestWeightKg).toBe(78.5);
  });

  it('falls back to the most recent weight when the target day has no WEIGHT', async () => {
    seedWeight(82.0, -5);
    seedWeight(81.5, -2);
    // No weight on 2026-07-08 (today)
    const res = await buildApp().inject({
      method: 'GET',
      url: '/dailies/morning-popup?date=2026-07-08',
    });
    const body = res.json();
    expect(body.recap.weighInLogged).toBe(false);
    // Most recent (the 81.5 from 2 days ago)
    expect(body.recap.latestWeightKg).toBe(81.5);
  });

  it('weighInLogged=false when no WEIGHT exists at all', async () => {
    const res = await buildApp().inject({
      method: 'GET',
      url: '/dailies/morning-popup?date=2026-07-08',
    });
    const body = res.json();
    expect(body.recap.weighInLogged).toBe(false);
    expect(body.recap.latestWeightKg).toBeNull();
  });

  it('isolates per-user (a different user\'s WEIGHT on the target day does not flip this user\'s flag)', async () => {
    h.weights.push({
      id: 'w-other',
      userId: 'u-other',
      metric: 'WEIGHT',
      value: 90,
      unit: 'kg',
      recordedAt: new Date(Date.UTC(2026, 6, 8, 12, 0, 0)),
    });
    const res = await buildApp().inject({
      method: 'GET',
      url: '/dailies/morning-popup?date=2026-07-08',
    });
    const body = res.json();
    expect(body.recap.weighInLogged).toBe(false);
    expect(body.recap.latestWeightKg).toBeNull();
  });
});
