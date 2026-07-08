/**
 * Casual vs Hardcore difficulty mode. Casual is the "slap on the
 * wrist" mode — hearts still drop (so the user can SEE they're
 * missing things) but no XP/gold/raid penalty applies. Hardcore
 * engages a graduated penalty ladder where every lost heart chops
 * a percentage off rewards.
 *
 *  - **Hearts**: 10 hearts (both modes). Lose 1 per missed planned
 *    workout (routine day with no workout by end of day) in either
 *    mode. Regen: Hardcore +1 per week (anchored to local Sunday
 *    midnight in the user's tz); Casual +1 per local day — the
 *    Casual drop is visual-only, so recovery is deliberately fast.
 *    Casual drops are visual-only; Hardcore drops apply a
 *    graduated multiplier (see heartMultiplier below).
 *
 *  - **Hardcore graduated penalty** (per current heart count):
 *      10 hearts: ×1.00
 *       9 hearts: ×0.95
 *       8 hearts: ×0.90
 *       7 hearts: ×0.85
 *       6 hearts: ×0.80
 *       5 hearts: ×0.70
 *       4 hearts: ×0.60
 *       3 hearts: ×0.50
 *       2 hearts: ×0.40
 *       1 heart:  ×0.25
 *       0 hearts: ×0.00
 *    Applied to XP, gold, and raid damage. Casual: always ×1.00.
 *
 *  - **Streak break on miss**: routine streak resets to 0 if the
 *    user misses their weekly goal AND had a streak ≥ 1 last week.
 *    In Casual, the streak would just sit frozen at the last value
 *    (the existing "no penalty for missing a week" behaviour).
 *
 *  - **Substance over-use caps** (Hardcore only): any overage
 *    (espresso / day, drinks / week, nicotine logs / week) drops a
 *    heart the next morning via the `HeartLossEvent` machinery
 *    driven by the morning-report sweep. Because `heartMultiplier`
 *    is what scales XP / gold / raid damage, that heart drop is
 *    the actual consequence — the morning report's risk_flags
 *    link the overage to the heart drop and the resulting
 *    multiplier reduction. Per-substance-per-stat multipliers
 *    (a "caffeine HRV credit", an "alcohol weekly XP multiplier")
 *    are NOT implemented; the original plan described them but
 *    shipping them would require separate product decisions.
 *
 *  - **Casino limits** are already engine-enforced (raid attempts/day
 *    etc.) — Hardcore mode just exposes them more prominently in the
 *    /insights anti-staleness surface.
 *
 * Heart regen is computed at *read* time, not via a cron, because the
 * value is bounded (10 max, 0 min) and the math is trivial. We count
 * regen boundaries crossed since heartsLastRegenAt (local Sundays
 * for Hardcore, local midnights for Casual) and add them to the
 * stored value, capped at 10. The anchor is always a boundary
 * instant, so a Hardcore user who lost a heart on Wednesday gets a
 * new one on Sunday morning (not just "one week from the loss").
 *
 * The lib is pure-ish — the only DB touchpoints are read/write on
 * `User.hearts` + `User.heartsLastRegenAt`. The rest is computation.
 */
import { prisma } from './prisma.js';
import { lastSundayMidnightUtc, localMidnightUtc, todayInTz, localDayKey } from './timezone.js';

/// Maximum hearts. Bumped from 5 to 10 so the graduated Hardcore
/// penalty curve has meaningful resolution. The default is also 10
/// (see User.hearts in schema.prisma) for new users.
export const MAX_HEARTS = 10;

/// 1 week in ms. Hardcore regen cadence: +1 heart per local
/// Sunday (in the user's tz). Anchored to Sunday midnight rather
/// than "1 week from the last loss" so users get a predictable
/// weekly recharge regardless of when they last dropped a heart.
export const HEART_REGEN_MS = 7 * 24 * 60 * 60 * 1000;

/// Substance thresholds for Hardcore mode. Anything above these
/// caps fires a heart-loss event the next morning:
///   - caffeine: per-day count (typical = coffee + pre-workout)
///   - alcohol:  rolling 7-day count (drinks/week, not unique days)
///   - nicotine: rolling 7-day count (most restrictive — nicotine is
///               the most damaging of the three)
/// Conservative — the point is to flag, not to nag. Could be tuned
/// per-user later via /settings.
export const HARDCORE_SUBSTANCE_CAPS = {
  caffeinePerDay: 3,
  alcoholPerWeek: 5,
  nicotinePerWeek: 2,
};

export type UserMode = 'CASUAL' | 'HARDCORE';

/**
 * The most recent regen boundary for the user's mode:
 *   HARDCORE → the most recent local Sunday midnight (1 heart/week)
 *   CASUAL   → the most recent local midnight (1 heart/day)
 * Both as UTC instants.
 */
function regenBoundary(mode: UserMode, timezone: string | null, now: Date): Date {
  if (mode === 'CASUAL') {
    return localMidnightUtc(todayInTz(timezone, now), timezone ?? 'UTC');
  }
  return lastSundayMidnightUtc(timezone, now);
}

/**
 * Count regen boundaries crossed in (anchor, boundary]. Computed in
 * LOCAL-DATE space (day keys), not instant arithmetic, so DST
 * transitions and legacy mid-week anchors can't skew the count:
 *   - CASUAL: one boundary per local midnight → the day difference.
 *   - HARDCORE: one per Sunday → ceil(days/7) handles both
 *     Sunday-aligned anchors (7 days → 1) and legacy arbitrary
 *     anchors (Wed→Sun = 4 days → 1; the header's "lost a heart on
 *     Wednesday, new one Sunday morning" contract).
 */
function boundariesCrossed(
  mode: UserMode,
  timezone: string | null,
  anchor: Date,
  boundary: Date,
): number {
  const anchorDay = localDayKey(anchor, timezone);
  const boundaryDay = localDayKey(boundary, timezone);
  const days = Math.round((Date.parse(`${boundaryDay}T00:00:00Z`) - Date.parse(`${anchorDay}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return 0;
  return mode === 'CASUAL' ? days : Math.ceil(days / 7);
}

/**
 * Read the current heart count, applying accrued regen since the
 * last tick. Persists the bumped lastRegenAt so the next read sees
 * the new floor.
 *
 * Regen cadence: Hardcore +1/local-Sunday, Casual +1/local-day (the
 * Casual drop is visual-only, so the recovery is gentle-fast).
 *
 * Anchor discipline (the previous version got this wrong): the
 * heartsLastRegenAt anchor is ONLY ever set to a boundary instant
 * (Sunday midnight / local midnight), never to `new Date()`. The
 * old code reset the anchor to "now" on every full-hearts read,
 * which un-anchored the whole system — a heart lost on Wednesday
 * regenerated the following Wednesday-at-whatever-time you last
 * opened the app, instead of Sunday morning.
 *
 * Returns the freshly-ticked value. Mutates the row in place.
 */
export async function tickHearts(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hearts: true, heartsLastRegenAt: true, mode: true, timezone: true },
  });
  if (!user) return 0;

  const now = new Date();
  const mode: UserMode = user.mode === 'HARDCORE' ? 'HARDCORE' : 'CASUAL';
  const boundary = regenBoundary(mode, user.timezone, now);

  if (user.hearts >= MAX_HEARTS) {
    // Full: pin the anchor to the CURRENT boundary (not `now`!) so
    // a future loss starts its countdown from the boundary the
    // user was last full at — i.e. the next boundary after a loss
    // grants the heart back. Only write when it actually moves
    // (once per day/week) instead of on every read.
    if (!user.heartsLastRegenAt || user.heartsLastRegenAt.getTime() !== boundary.getTime()) {
      await prisma.user.update({
        where: { id: userId },
        data: { heartsLastRegenAt: boundary },
      });
    }
    return MAX_HEARTS;
  }

  // Never ticked → seed to the current boundary (first regen is the
  // next boundary). Future-dated anchor (legacy/clock skew) → snap.
  const anchor = user.heartsLastRegenAt ?? boundary;
  if (!user.heartsLastRegenAt || anchor.getTime() > now.getTime()) {
    await prisma.user.update({
      where: { id: userId },
      data: { heartsLastRegenAt: boundary },
    });
    return user.hearts;
  }

  const ticks = boundariesCrossed(mode, user.timezone, anchor, boundary);
  if (ticks < 1) return user.hearts;

  const next = Math.min(MAX_HEARTS, user.hearts + ticks);
  await prisma.user.update({
    where: { id: userId },
    data: { hearts: next, heartsLastRegenAt: boundary },
  });
  return next;
}

/**
 * Decrement hearts by 1 in EITHER mode. Casual: visual-only (the
 * count drops so the user can see they missed something, but no
 * reward is affected). Hardcore: count drops AND the
 * heartMultiplier() drops apply to subsequent XP / gold / raid.
 *
 * Called from the morning-report sweep
 * (`fireHardcoreHeartPenalties` in morningReport.ts) once per
 * (user, local-date, trigger-kind) — the HeartLossEvent unique
 * constraint makes re-fires within the same day a no-op.
 *
 * Clamped at 0. Returns the new count.
 */
export async function loseHeart(userId: string, opts?: { reason?: string }): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hearts: true, mode: true, timezone: true, heartsLastRegenAt: true },
  });
  if (!user) return 0;
  const next = Math.max(0, user.hearts - 1);
  // When dropping FROM full, pin the anchor to the current boundary
  // so the regen countdown starts from a boundary instant — a
  // long-idle full-hearts user could otherwise have a months-old
  // anchor and instantly refill on the next tick. We deliberately
  // do NOT touch the anchor otherwise: regen stays boundary-aligned
  // (next local Sunday for Hardcore / next local midnight for
  // Casual). The old code reset the anchor to `new Date()` when
  // hitting 0, which pushed the "Sunday" regen to a random mid-week
  // instant a full week away.
  const mode: UserMode = user.mode === 'HARDCORE' ? 'HARDCORE' : 'CASUAL';
  const pinAnchor = user.hearts >= MAX_HEARTS;
  await prisma.user.update({
    where: { id: userId },
    data: {
      hearts: next,
      ...(pinAnchor
        ? { heartsLastRegenAt: regenBoundary(mode, user.timezone, new Date()) }
        : {}),
    },
  });
  return next;
}

/**
 * XP / gold / raid-damage multiplier derived from current heart
 * count. Both modes show the heart count visually, but only
 * Hardcore applies the penalty. Casual always returns 1.0.
 *
 * Graduated curve (Hardcore only) — see file header for the table.
 * The curve is steeper at the bottom (1 heart = 0.25x, 0 hearts =
 * 0x) and gentler at the top (10 hearts = 1.0x, 9 hearts = 0.95x)
 * so the top of the bar feels like breathing room while the bottom
 * feels like genuine warning.
 */
export function heartMultiplier(hearts: number, mode: UserMode = 'HARDCORE'): number {
  if (mode === 'CASUAL') return 1.0;
  if (hearts >= 10) return 1.0;
  if (hearts === 9) return 0.95;
  if (hearts === 8) return 0.90;
  if (hearts === 7) return 0.85;
  if (hearts === 6) return 0.80;
  if (hearts === 5) return 0.70;
  if (hearts === 4) return 0.60;
  if (hearts === 3) return 0.50;
  if (hearts === 2) return 0.40;
  if (hearts === 1) return 0.25;
  return 0.0; // hearts === 0 — no progress at all
}

/// Apply hardcore substance caps to a windowed substance count.
/// Returns the cap reason (or null if the user is under all caps).
export function hardcoreSubstanceCapReason(args: {
  caffeineLast24h: number;
  alcoholLast7d: number;
  nicotineLast7d?: number;
}): string | null {
  const reasons: string[] = [];
  if (args.caffeineLast24h > HARDCORE_SUBSTANCE_CAPS.caffeinePerDay) {
    reasons.push(`>${HARDCORE_SUBSTANCE_CAPS.caffeinePerDay} espressos in 24h`);
  }
  if (args.alcoholLast7d > HARDCORE_SUBSTANCE_CAPS.alcoholPerWeek) {
    reasons.push(`>${HARDCORE_SUBSTANCE_CAPS.alcoholPerWeek} drinks in last 7d`);
  }
  if (typeof args.nicotineLast7d === 'number'
    && args.nicotineLast7d > HARDCORE_SUBSTANCE_CAPS.nicotinePerWeek) {
    reasons.push(`>${HARDCORE_SUBSTANCE_CAPS.nicotinePerWeek} nicotine uses in last 7d`);
  }
  return reasons.length ? reasons.join(', ') : null;
}