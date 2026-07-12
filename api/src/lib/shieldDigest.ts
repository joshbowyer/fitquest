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
 *   - Dedup via a conditional `prisma.user.updateMany` that
 *     atomically claims the (user, yesterdayDate) pair on the
 *     `User.shieldDigestLastDate` column itself. The dedup
 *     record is therefore part of the user row, which the user
 *     CANNOT delete from the inbox UI — the previous
 *     `Notification.findFirst({ payload: { path: ['date'],
 *     equals: yesterdayDate } })` approach was destroyed by
 *     DELETE /notifications/:id (the user's "dismiss" button
 *     hard-deletes the notification row), and the next hourly
 *     tick would re-emit an identical notification until the
 *     user's local midnight advanced `yesterdayDate`. Moving the
 *     dedup state onto the user row closes that hole permanently.
 *   - The conditional WHERE is `shieldDigestLastDate IS NULL OR
 *     shieldDigestLastDate != yesterdayDate`, so a single
 *     atomic UPDATE handles both "never claimed" and "claimed
 *     for a previous day" in one round trip. This is a Postgres
 *     UPDATE statement, so it's atomic at the row level — no
 *     TOCTOU race between the read and the emit (which the
 *     prior findFirst → create sequence had). `claimed.count
 *     === 0` means a prior run already wrote
 *     `shieldDigestLastDate = yesterdayDate` and we short-circuit.
 *   - Trade-off: if we crash between the claim and the emit
 *     call, the next hour's tick will find the date already
 *     claimed and skip the entire day. This is the correct
 *     failure mode — skip a day rather than double-send the
 *     rollup. Acceptable because (a) the per-day emit is one
 *     cheap SELECT + one INSERT and the failure window is small,
 *     and (b) "no rollup today" is far less harmful than "user
 *     sees the same shield_repair_daily notification every hour".
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

  // Dedup: atomically claim (user, yesterdayDate) on the User row.
  // The WHERE matches when the row is unclaimed (NULL) OR claimed
  // for some other date — both cases need to proceed. When the
  // claim succeeds (count === 1) we own the slot for this date;
  // when it fails (count === 0) a prior run already wrote
  // yesterdayDate and we short-circuit. Atomic in Postgres as a
  // single conditional UPDATE — no TOCTOU race between the read
  // and the later Notification.create (which was the hole in the
  // old findFirst-then-create sequence).
  const claimed = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [
        { shieldDigestLastDate: null },
        { shieldDigestLastDate: { not: yesterdayDate } },
      ],
    },
    data: { shieldDigestLastDate: yesterdayDate },
  });
  if (claimed.count === 0) {
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

  // Show the actual date, not just "yesterday" — this digest fires
  // legitimately once per calendar day, forever, as long as there's
  // net-positive repair activity. With only relative wording every
  // day's fresh, genuinely-new notification is visually identical
  // to the previous day's (already-dismissed) one, which reads as
  // "the same notification keeps coming back" even when it's
  // actually a new one about a new day each time. A short absolute
  // date lets the user tell them apart at a glance.
  const shortDate = new Date(`${yesterdayDate}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

  await emitNotification({
    userId,
    category: 'PENANCE',
    kind: 'shield_repair_daily',
    title: `Shield +${netDelta} (${shortDate})`,
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
 * so the `updateMany` is the only query they incur, and it
 * short-circuits to count=0 immediately).
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
