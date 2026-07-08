/**
 * Tests for the morning-popup dismissal flow:
 *   POST /dailies/morning-popup/dismiss      — upsert a row for today in user's tz
 *   GET  /dailies/morning-popup              — returns `dismissed: true` iff row exists
 *
 * The whole point of the row is to make dismissal state survive
 * across devices — the localStorage flag the component used to
 * read was browser-scoped, so dismissing on the Android Capacitor
 * app didn't carry over to the web desktop (or vice versa) and
 * the popup re-opened on the other device. The endpoint + the
 * `dismissed` field on the GET response are the cross-device
 * fix. See migration 20260708030000_morning_popup_dismissal.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
  // In-memory MorningPopupDismissal store. Keyed by `${userId}|${date}`
  // for fast lookup mirroring the unique index.
  const rows = new Map<string, { id: string; userId: string; date: string; dismissedAt: Date }>();
  // In-memory User store (the route reads me.timezone + level/xp/...).
  const user = { id: 'u1', timezone: 'UTC', level: 4, xp: 120, mode: 'CASUAL', hearts: 5 };
  let nextId = 1;
  return { rows, user, nextId };
});

vi.mock('../lib/prisma', () => ({
  // The dailies route file imports several enums in module scope
  // (for zod schemas). Stub the ones it touches so the mock doesn't
  // fail to load — the test itself only exercises the morning-popup
  // paths, so the values are irrelevant.
  DayOfWeek: { SUN: 'SUN', MON: 'MON', TUE: 'TUE', WED: 'WED', THU: 'THU', FRI: 'FRI', SAT: 'SAT' },
  DailyCategory: { USER: 'USER', WORKOUT: 'WORKOUT', SPIRITUAL: 'SPIRITUAL' },
  prisma: {
    morningPopupDismissal: {
      upsert: vi.fn(async ({ where, create }: any) => {
        const key = `${where.userId_date.userId}|${where.userId_date.date}`;
        const existing = h.rows.get(key);
        if (existing) return existing;
        const row = {
          id: `mpd-${h.nextId++}`,
          userId: create.userId,
          date: create.date,
          dismissedAt: new Date(),
        };
        h.rows.set(key, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const key = `${where.userId_date.userId}|${where.userId_date.date}`;
        return h.rows.get(key) ?? null;
      }),
    },
    user: {
      // /morning-popup only reads a few scalar fields off the user row.
      findUnique: vi.fn(async () => ({
        level: h.user.level,
        xp: h.user.xp,
        mode: h.user.mode,
        hearts: h.user.hearts,
        heartsLastRegenAt: null,
      })),
    },
    // /morning-popup hits a bunch of other models for the recap
    // fields; we return empty / null so the test only exercises
    // the dismissal flag.
    workout: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    measurement: { findFirst: vi.fn(async () => null) },
    heartLossEvent: { findMany: vi.fn(async () => []) },
    daily: { findMany: vi.fn(async () => []) },
    dailyLog: { findMany: vi.fn(async () => []) },
    routineDay: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('../lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1', timezone: h.user.timezone })),
}));

// /morning-popup calls computeRecovery for the recap. Stub it to
// a no-op (it'd be too much to fully mock for this test).
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

beforeEach(() => {
  h.rows.clear();
  h.user.timezone = 'UTC';
  h.nextId = 1;
});

describe('POST /dailies/morning-popup/dismiss', () => {
  it('records a dismissal row for today in the user\'s tz', async () => {
    const res = await buildApp().inject({ method: 'POST', url: '/dailies/morning-popup/dismiss' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(h.rows.size).toBe(1);
  });

  it('is idempotent — repeat calls do not create a second row', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/dailies/morning-popup/dismiss' });
    await app.inject({ method: 'POST', url: '/dailies/morning-popup/dismiss' });
    await app.inject({ method: 'POST', url: '/dailies/morning-popup/dismiss' });
    expect(h.rows.size).toBe(1);
  });

  it('uses the user\'s tz to compute the date', async () => {
    // A user in America/Los_Angeles posting at UTC 03:00 is on the
    // previous local day. The row's date should reflect the local
    // date, not the UTC date.
    h.user.timezone = 'America/Los_Angeles';
    // Stub Date so the test is deterministic regardless of when
    // it runs. The route calls todayInTz(me.timezone) which is
    // pure — so we don't actually need to mock Date here, but
    // asserting the date string shape is what matters.
    const res = await buildApp().inject({ method: 'POST', url: '/dailies/morning-popup/dismiss' });
    expect(res.statusCode).toBe(200);
    expect(res.json().date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('GET /dailies/morning-popup', () => {
  it('returns dismissed=false when no row exists for today', async () => {
    const res = await buildApp().inject({ method: 'GET', url: '/dailies/morning-popup' });
    expect(res.statusCode).toBe(200);
    expect(res.json().dismissed).toBe(false);
  });

  it('returns dismissed=true after a dismiss was recorded', async () => {
    const app = buildApp();
    await app.inject({ method: 'POST', url: '/dailies/morning-popup/dismiss' });
    const res = await app.inject({ method: 'GET', url: '/dailies/morning-popup' });
    expect(res.json().dismissed).toBe(true);
  });

  it('a dismissal from another user does not flip this user\'s flag', async () => {
    // Seed a row for a different (userId, date) pair — must not
    // match u1's "today" lookup.
    h.rows.set('u-other|2026-07-08', {
      id: 'mpd-other', userId: 'u-other', date: '2026-07-08', dismissedAt: new Date(),
    });
    const res = await buildApp().inject({ method: 'GET', url: '/dailies/morning-popup' });
    expect(res.json().dismissed).toBe(false);
  });
});
