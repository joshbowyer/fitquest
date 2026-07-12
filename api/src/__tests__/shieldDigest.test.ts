/**
 * Tests for the daily shield-repair rollup notification.
 *
 * Why this exists: every per-event `shield_repair` notification
 * was silenced in `firePenance` because it was too noisy. The
 * signal-to-noise on "+1 from a meal" is poor; a single
 * "Shield +N yesterday" notification per user per day is much
 * higher signal. This test pins the behavior of the rollup
 * helper: idempotency, correct net-delta math, no-emit-when-zero,
 * no-emit-when-negative, top-3 contributors in the body.
 *
 * `firePenance` itself is tested by `penance.test.ts` (covers
 * the per-event skip-repair behavior change); the rollup lives
 * in its own module and is covered here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
  // Per-user PenanceEvent log + Notification log. Both keyed
  // by the same shared userId the test will use.
  type PenanceRow = {
    id: string;
    userId: string;
    penanceKey: string;
    label: string;
    shieldDelta: number;
    shieldAfter: number;
    tierAfter: string;
    source: string;
    createdAt: Date;
  };
  const penanceByUser = new Map<string, PenanceRow[]>();
  type NotifRow = {
    id: string;
    userId: string;
    category: string;
    kind: string;
    title: string;
    body: string | null;
    link: string | null;
    payload: any;
    readAt: Date | null;
    createdAt: Date;
  };
  const notifsByUser = new Map<string, NotifRow[]>();
  // User rows: id + timezone + the dedup column the cron writes
  // (`shieldDigestLastDate`). Tests that want to simulate a
  // re-run on the same day seed the date explicitly; the rest
  // start unclaimed (undefined → matches the OR-NULL branch in
  // the updateMany WHERE).
  const users = new Map<
    string,
    { id: string; timezone: string; shieldDigestLastDate?: string | null }
  >();
  let nextId = 1;
  return { penanceByUser, notifsByUser, users, nextId };
});

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(async () => [...h.users.values()]),
      // The shield-digest dedup: a conditional UPDATE that
      // claims (user, yesterdayDate) atomically. Mimics the
      // Postgres semantics — read + write is one atomic
      // statement, so concurrent callers can't both succeed.
      // Returns count = 1 on a fresh claim, count = 0 when the
      // date is already claimed for this user.
      updateMany: vi.fn(async ({ where, data }: any) => {
        const u = h.users.get(where.id);
        if (!u) return { count: 0 };
        // Mirror the OR clause: (shieldDigestLastDate IS NULL OR
        // shieldDigestLastDate != data.shieldDigestLastDate).
        const claimed = u.shieldDigestLastDate == null
          || u.shieldDigestLastDate !== data.shieldDigestLastDate;
        if (!claimed) return { count: 0 };
        u.shieldDigestLastDate = data.shieldDigestLastDate;
        return { count: 1 };
      }),
    },
    penanceEvent: {
      findMany: vi.fn(async ({ where }: any) => {
        const all = h.penanceByUser.get(where.userId) ?? [];
        return all.filter((p) => {
          if (where.createdAt?.gte && p.createdAt < where.createdAt.gte) return false;
          if (where.createdAt?.lt && p.createdAt >= where.createdAt.lt) return false;
          if (where.shieldDelta?.gt != null && !(p.shieldDelta > where.shieldDelta.gt)) return false;
          return true;
        });
      }),
    },
    notification: {
      create: vi.fn(async ({ data }: any) => {
        const row: NotifRow = {
          id: `n-${h.nextId++}`,
          userId: data.userId,
          category: data.category,
          kind: data.kind,
          title: data.title,
          body: data.body ?? null,
          link: data.link ?? null,
          payload: data.payload ?? null,
          readAt: null,
          createdAt: new Date(),
        };
        const list = h.notifsByUser.get(data.userId) ?? [];
        list.push(row);
        h.notifsByUser.set(data.userId, list);
        return row;
      }),
    },
  },
}));

// Stable Date for "now" so the test can reason about "yesterday".
// Pinned to a Tuesday afternoon UTC so the day boundaries are
// unambiguous.
const NOW_MS = Date.UTC(2026, 6, 8, 14, 0, 0); // 2026-07-08 14:00 UTC

vi.mock('../lib/timezone', () => ({
  // todayInTz(tz, refDate?) → YYYY-MM-DD in the user's tz.
  // When no refDate is passed, uses real "now"; when passed, uses
  // that date. Our test calls it with and without an argument,
  // so the mock needs to honour both.
  todayInTz: vi.fn((tz: string | null, refDate?: Date) => {
    const d = refDate ?? new Date(NOW_MS);
    if (tz === 'America/Los_Angeles') {
      // LA is UTC-7 in July (PDT). Shift the UTC date back 7h
      // and format the resulting local YYYY-MM-DD. At 14:00 UTC
      // on 2026-07-08, LA local time is 07:00 on 2026-07-08 (no
      // day boundary). At 02:00 UTC on 2026-07-08, LA local is
      // 19:00 on 2026-07-07 (one day earlier).
      const shifted = new Date(d.getTime() - 7 * 60 * 60 * 1000);
      return shifted.toISOString().slice(0, 10);
    }
    return d.toISOString().slice(0, 10);
  }),
  localMidnightUtc: vi.fn((dateStr: string, _tz: string) => {
    return new Date(`${dateStr}T00:00:00Z`);
  }),
}));

import { runShieldDigestForUser, runShieldDigestForAllUsers } from '../lib/shieldDigest';

function seedUser(id: string, timezone: string) {
  h.users.set(id, { id, timezone });
}

function seedRepair(
  userId: string,
  penanceKey: string,
  label: string,
  shieldDelta: number,
  dayOffset: number, // -1 = yesterday, 0 = today
) {
  const base = new Date(NOW_MS);
  // dayOffset -1 = yesterday 12:00 UTC. Today = 12:00 UTC today.
  const at = new Date(base.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  at.setUTCHours(12, 0, 0, 0);
  const list = h.penanceByUser.get(userId) ?? [];
  list.push({
    id: `p-${h.nextId++}`,
    userId,
    penanceKey,
    label,
    shieldDelta,
    shieldAfter: 0,
    tierAfter: 'STABLE',
    source: 'auto_decay',
    createdAt: at,
  });
  h.penanceByUser.set(userId, list);
}

beforeEach(() => {
  h.penanceByUser.clear();
  h.notifsByUser.clear();
  h.users.clear();
  h.nextId = 1;
});

describe('runShieldDigestForUser', () => {
  it('emits a rollup when the net repair delta is positive', async () => {
    seedUser('u1', 'UTC');
    seedRepair('u1', 'logged_mobility', 'Mobility logged', 8, -1);
    seedRepair('u1', 'meal_logged', 'Meal logged', 1, -1);
    seedRepair('u1', 'meal_logged', 'Meal logged', 1, -1);
    seedRepair('u1', 'meal_logged', 'Meal logged', 1, -1);

    const r = await runShieldDigestForUser('u1', 'UTC');
    expect(r.emitted).toBe(true);
    expect(r.netDelta).toBe(11);
    expect(r.count).toBe(4);

    const notifs = h.notifsByUser.get('u1') ?? [];
    expect(notifs).toHaveLength(1);
    expect(notifs[0].kind).toBe('shield_repair_daily');
    expect(notifs[0].category).toBe('PENANCE');
    expect(notifs[0].title).toContain('+11');
    // Top contributor should be the +8 mobility
    expect(notifs[0].body).toContain('Mobility logged');
  });

  it('is a no-op when there are zero repair events yesterday', async () => {
    seedUser('u1', 'UTC');
    const r = await runShieldDigestForUser('u1', 'UTC');
    expect(r.emitted).toBe(false);
    expect(r.netDelta).toBe(0);
    expect((h.notifsByUser.get('u1') ?? []).length).toBe(0);
  });

  it('is a no-op when yesterday had only damage events (no repairs)', async () => {
    // The rollup query filters to `shieldDelta > 0`, so a day
    // with only damage events yields a 0-net and a no-op. The
    // damage events have their own per-event notifications, so
    // the user already saw the signal — the rollup deliberately
    // stays silent on damage-only days.
    seedUser('u1', 'UTC');
    seedRepair('u1', 'missed_workout', 'Missed workout', -15, -1);
    seedRepair('u1', 'missed_all_dailies', 'All dailies missed', -20, -1);
    const r = await runShieldDigestForUser('u1', 'UTC');
    expect(r.emitted).toBe(false);
    expect(r.netDelta).toBe(0);
    expect((h.notifsByUser.get('u1') ?? []).length).toBe(0);
  });

  it('does not count damage events even if they happened alongside repairs', async () => {
    seedUser('u1', 'UTC');
    seedRepair('u1', 'logged_mobility', 'Mobility logged', 8, -1);
    seedRepair('u1', 'missed_workout', 'Missed workout', -15, -1);
    // The findMany filter excludes shieldDelta <= 0, so the
    // damage is invisible to the rollup. The +8 mobility
    // still triggers a positive-net rollup.
    const r = await runShieldDigestForUser('u1', 'UTC');
    expect(r.emitted).toBe(true);
    expect(r.netDelta).toBe(8);
  });

  it('idempotent — second call for the same day is a no-op', async () => {
    seedUser('u1', 'UTC');
    seedRepair('u1', 'logged_mobility', 'Mobility logged', 8, -1);
    const r1 = await runShieldDigestForUser('u1', 'UTC');
    expect(r1.emitted).toBe(true);
    const r2 = await runShieldDigestForUser('u1', 'UTC');
    expect(r2.emitted).toBe(false);
    expect((h.notifsByUser.get('u1') ?? []).length).toBe(1);
  });

  it('payload.date is the local yesterday, not today', async () => {
    seedUser('u1', 'UTC');
    seedRepair('u1', 'logged_mobility', 'Mobility logged', 8, -1);
    await runShieldDigestForUser('u1', 'UTC');
    const notif = (h.notifsByUser.get('u1') ?? [])[0];
    expect(notif.payload.date).toBe('2026-07-07');
  });

  it('top contributors are sorted by total contribution, capped at 3', async () => {
    seedUser('u1', 'UTC');
    seedRepair('u1', 'meal_logged', 'Meal logged', 1, -1);
    seedRepair('u1', 'meal_logged', 'Meal logged', 1, -1);
    seedRepair('u1', 'meal_logged', 'Meal logged', 1, -1);
    seedRepair('u1', 'meal_logged', 'Meal logged', 1, -1);
    seedRepair('u1', 'logged_mobility', 'Mobility logged', 8, -1);
    seedRepair('u1', 'completed_prayer', 'Completed prayer', 4, -1);
    seedRepair('u1', 'checkin_am', 'Morning check-in', 3, -1);
    seedRepair('u1', 'checkin_pm', 'Evening check-in', 3, -1);
    await runShieldDigestForUser('u1', 'UTC');
    const notif = (h.notifsByUser.get('u1') ?? [])[0];
    expect(notif.payload.topContributors).toEqual([
      'Mobility logged +8',
      'Meal logged +4',
      'Completed prayer +4',
    ]);
  });
});

describe('runShieldDigestForAllUsers', () => {
  it('iterates every user and only emits for those with positive net', async () => {
    seedUser('u-busy', 'UTC');
    seedUser('u-quiet', 'UTC');
    seedUser('u-zero', 'UTC');
    seedRepair('u-busy', 'logged_mobility', 'Mobility logged', 8, -1);
    seedRepair('u-busy', 'meal_logged', 'Meal logged', 1, -1);
    // u-quiet has 0 events
    // u-zero has only damage yesterday
    seedRepair('u-zero', 'missed_workout', 'Missed workout', -15, -1);

    const r = await runShieldDigestForAllUsers();
    expect(r.users).toBe(3);
    expect(r.emitted).toBe(1); // only u-busy
    expect(r.errors).toBe(0);
    expect((h.notifsByUser.get('u-busy') ?? []).length).toBe(1);
    expect((h.notifsByUser.get('u-quiet') ?? []).length).toBe(0);
    expect((h.notifsByUser.get('u-zero') ?? []).length).toBe(0);
  });
});
