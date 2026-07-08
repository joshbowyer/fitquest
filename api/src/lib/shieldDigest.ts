import { prisma } from './prisma.js';
import { emitNotification } from './notify.js';
import { todayInTz, localMidnightUtc } from './timezone.js';

/**
 * Daily shield-repair rollup notification.
 *
 * Background: every `firePenance()` call with a positive delta
 * (`firePenance` writes a `PenanceEvent` audit row) used to also
 * fire a per-event `shield_repair` notification. In practice this
 * was very noisy — a single workout commit can fire 2-3 repairs
 * in a row (mobility + cardio-30 + log_stretch), and a normal day
 * with several meal logs / water checks / prayers stacks them up
 * further. The signal-to-noise on a "+1 from a meal" notification
 * is poor; the user can't act on it any differently than on
 * "+8 from mobility".
 *
 * The new design (see `firePenance` in `./penance.ts`):
 *   - Damage (`delta < 0`) keeps emitting per-event. The "your
 *     shield just took a hit" signal is high-value when it
 *     happens; don't coalesce.
 *   - Repair (`delta > 0`) is silenced at the per-event level.
 *     The audit row is still written so /homebase can show the
 *     full breakdown.
 *   - At most one notification per user per local day aggregates
 *     the previous day's net shield repair and shows the top
 *     contributing penances. Emitted with kind
 *     `shield_repair_daily` and `category: 'PENANCE'`, so the
 *     inbox UI groups it with the damage notifications.
 *
 * Why "previous day" and not "today so far":
 *   - A user opens the app at 7am and gets a "you repaired +12
 *     today" notification. By 4pm the number is +47 and the
 *     morning's notification is already stale. The signal is
 *     "yesterday's net effect", which is a clean discrete number
 *     and lines up with the morning-popup "Yesterday recap".
 *
 * Why not at the user's exact local midnight:
 *   - We don't have per-user scheduled tasks. Running this cron
 *     every hour and computing "yesterday" per user in their tz
 *     gives the right semantics (each user gets the rollup within
 *     an hour of *their* midnight) at the cost of an extra few
 *     cheap DB queries per hour.
 *
 * Idempotency:
 *   - Dedup by querying `Notification.findFirst({ userId, kind,
 *     payload: { path: ['date'], equals: yesterday } })`. The
 *     `payload.date` is the user's local YYYY-MM-DD. No new
 *     model, no schema change, no unique index needed.
 *   - The hourly cron + dedup is correct across server restarts
 *     and clock drift: if the cron fires twice for the same user
 *     on the same day, the second call short-circuits.
 */

const SHIELD_REPAIR_KINDS = new Set([
  'substance_checkin',
  'substance_free_day',
  'logged_mobility',
  'logged_cardio_30',
  'log_stretch',
  'hit_protein_target',
  'hit_water_target',
  'completed_prayer',
  'meal_logged',
  'checkin_am',
  'checkin_pm',
  'checkin_weekly',
  'perfect_day',
  'streak_7day',
  'completed_spiritual_day',
  'logged_recovery_week',
  'logged_sleep_8h',
  'custom',
]);

/**
 * Compute and (if applicable) emit the daily shield-repair rollup
 * for a single user. Idempotent — re-running for the same user on
 * the same local day is a no-op.
 *
 * Returns `{ date, netDelta, count, emitted }` so the caller can
 * log + observe without re-querying.
 */
export async function runShieldDigestForUser(
  userId: string,
  tz: string | null,
): Promise<{ date: string; netDelta: number; count: number; emitted: boolean }> {
  // "Yesterday" in the user's tz. We're treating "today" as the
  // date the user is currently in; the rollup describes the day
  // that just ended. This way, a user opening the app at 8:30am
  // local gets a rollup of yesterday's net, not a partial
  // "today so far" that would be stale within hours.
  const todayStr = todayInTz(tz);
  const todayMidnight = localMidnightUtc(todayStr, tz ?? 'UTC');
  const yesterdayMidnight = new Date(todayMidnight.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayDate = todayInTz(tz, yesterdayMidnight);

  // Dedup: skip if a rollup for this (user, date) was already
  // emitted. The payload.date is the local YYYY-MM-DD we're
  // summarizing, NOT the date the row was written — the row may
  // have been written an hour after the user's local midnight.
  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      kind: 'shield_repair_daily',
      payload: { path: ['date'], equals: yesterdayDate },
    },
    select: { id: true },
  });
  if (existing) {
    return { date: yesterdayDate, netDelta: 0, count: 0, emitted: false };
  }

  // Fetch yesterday's repair events. The penance system fires
  // both damage AND repair events into PenanceEvent; we filter
  // to repairs here so the rollup only shows "+" totals.
  const events = await prisma.penanceEvent.findMany({
    where: {
      userId,
      createdAt: { gte: yesterdayMidnight, lt: todayMidnight },
      shieldDelta: { gt: 0 },
    },
    select: { penanceKey: true, label: true, shieldDelta: true },
    orderBy: { shieldDelta: 'desc' },
  });

  const netDelta = events.reduce((sum, e) => sum + e.shieldDelta, 0);
  if (netDelta <= 0) {
    // Nothing to roll up. Mark as "processed" implicitly by
    // NOT writing a row — next day's run will pick up a fresh
    // date. (If the user had repairs on day X but somehow the
    // net was 0 or negative — i.e. damages outweighed repairs —
    // we deliberately stay silent. The damage events have their
    // own per-event notifications, so the user has the full
    // history.)
    return { date: yesterdayDate, netDelta, count: events.length, emitted: false };
  }

  // Top 3 contributing penance keys. The full breakdown is
  // available in /homebase via the PenanceEvent feed; the
  // notification only needs to surface the headline + a
  // brief hint at the dominant sources.
  const byKey = new Map<string, { label: string; total: number; count: number }>();
  for (const e of events) {
    if (!SHIELD_REPAIR_KINDS.has(e.penanceKey)) continue;
    const cur = byKey.get(e.penanceKey) ?? { label: e.label, total: 0, count: 0 };
    cur.total += e.shieldDelta;
    cur.count += 1;
    byKey.set(e.penanceKey, cur);
  }
  const top = [...byKey.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 3)
    .map((c) => `${c.label} +${c.total}`);

  await emitNotification({
    userId,
    category: 'PENANCE',
    kind: 'shield_repair_daily',
    title: `Shield +${netDelta} yesterday`,
    body:
      top.length > 0
        ? `Top contributors: ${top.join(', ')} · ${events.length} action${events.length === 1 ? '' : 's'}`
        : `${events.length} action${events.length === 1 ? '' : 's'} yesterday`,
    link: '/homebase',
    payload: {
      date: yesterdayDate,
      netDelta,
      count: events.length,
      topContributors: top,
    },
  });

  return { date: yesterdayDate, netDelta, count: events.length, emitted: true };
}

/**
 * Iterate all users and run the daily rollup. Designed for an
 * hourly cron — the per-user dedup keeps it cheap (most users
 * are already-processed by the time the hourly tick fires again,
 * so the `findFirst` is the only query they incur).
 */
export async function runShieldDigestForAllUsers(): Promise<{
  users: number;
  emitted: number;
  errors: number;
}> {
  // Pull only the fields we need. tz drives the "yesterday"
  // boundary per user; falling back to UTC for users without a
  // tz is fine — they get a UTC-bucketed rollup, which is at
  // least consistent with the rest of the app's UTC fallbacks.
  const users = await prisma.user.findMany({
    select: { id: true, timezone: true },
  });

  let emitted = 0;
  let errors = 0;
  for (const u of users) {
    try {
      const r = await runShieldDigestForUser(u.id, u.timezone);
      if (r.emitted) emitted += 1;
    } catch (err) {
      errors += 1;
      // eslint-disable-next-line no-console
      console.warn('[shieldDigest] user failed', { userId: u.id, err });
    }
  }
  return { users: users.length, emitted, errors };
}
