/**
 * Casual vs Hardcore difficulty mode. Casual is the legacy
 * no-consequences behavior. Hardcore engages a penalty ladder:
 *
 *  - **Hearts**: 5 hearts. Lose 1 per missed planned workout
 *    (routine day with no workout by end of day). Regen 1 per 8h.
 *    At 0 hearts: -50% XP, -50% gold, -50% raid damage until the
 *    user gets back to at least 1.
 *
 *  - **Streak break on miss**: routine streak resets to 0 if the
 *    user misses their weekly goal AND had a streak ≥ 1 last week.
 *    In Casual, the streak would just sit frozen at the last value
 *    (the existing "no penalty for missing a week" behaviour).
 *
 *  - **Substance over-use caps** (Hardcore only): >3 espressos / day
 *    flags a caffeine cap that reduces HRV credit the next morning.
 *    >5 alcoholic drinks / week reduces the weekly XP multiplier.
 *    These surfaces in the morning report's risk_flags as a label,
 *    not an actual stat change yet (see `applyHardcoreCaps`).
 *
 *  - **Casino limits** are already engine-enforced (raid attempts/day
 *    etc.) — Hardcore mode just exposes them more prominently in the
 *    /insights anti-staleness surface.
 *
 * Heart regen is computed at *read* time, not via a cron, because the
 * value is bounded (5 max, 0 min) and the math is trivial. We compute
 * `floor((now - heartsLastRegenAt) / 1 week)` and add it to the stored
 * value, capped at 5. The last-regen timestamp is anchored to local
 * Sunday-midnight in the user's tz, so a user who lost a heart on
 * Wednesday gets a new one on Sunday morning (not just "one week
 * from the loss"). The 8-hour cadence was too forgiving for users
 * with a single planned workout per day — they'd never lose a heart
 * in the first place, making Hardcore mode a no-op.
 *
 * The lib is pure-ish — the only DB touchpoints are read/write on
 * `User.hearts` + `User.heartsLastRegenAt`. The rest is computation.
 */
import { prisma } from './prisma.js';
import { lastSundayMidnightUtc } from './timezone.js';

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
 * Read the current heart count, applying accrued regen since the
 * last tick. Persists the bumped lastRegenAt so the next read sees
 * the new floor.
 *
 * Returns the freshly-ticked value. Mutates the row in place.
 */
export async function tickHearts(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hearts: true, heartsLastRegenAt: true, mode: true, timezone: true },
  });
  if (!user) return 0;

  // Casual mode never depletes or ticks hearts. The value stays at 5
  // for UI consistency but isn't read by any penalty logic.
  if (user.mode === 'CASUAL') return 5;

  if (user.hearts >= 5) {
    // Already full. Reset the timer so future losses regen from now.
    if (user.heartsLastRegenAt) {
      await prisma.user.update({
        where: { id: userId },
        data: { heartsLastRegenAt: new Date() },
      });
    }
    return 5;
  }

  // Anchor: the most recent Sunday midnight in the user's tz.
  // If the user just dropped to 4 hearts on Wednesday, this still
  // returns the same Sunday they ticked on, so the next regen
  // happens at the FOLLOWING Sunday — not "one week from the loss".
  const now = new Date();
  const lastSunday = lastSundayMidnightUtc(user.timezone, now);

  // Initial value: never ticked. Seed to this Sunday so the next
  // tick is at most a week away. For a user entering Hardcore
  // mid-week, their first regen is the upcoming Sunday.
  const last = user.heartsLastRegenAt ?? lastSunday;
  if (last.getTime() > now.getTime()) {
    // Stored value is in the future (legacy / clock skew). Snap to
    // this Sunday and re-evaluate.
    await prisma.user.update({
      where: { id: userId },
      data: { heartsLastRegenAt: lastSunday },
    });
    return user.hearts;
  }

  const weeksSince = Math.floor((now.getTime() - last.getTime()) / HEART_REGEN_MS);
  if (weeksSince < 1) {
    // Same Sunday window — no regen yet. Return current.
    return user.hearts;
  }
  const next = Math.min(5, user.hearts + weeksSince);
  // Bump the timer to the most recent Sunday (weeksSince back from
  // now rounded). Next tick is then the following Sunday.
  const newLast = new Date(now.getTime() - (now.getTime() - last.getTime()) % HEART_REGEN_MS);
  await prisma.user.update({
    where: { id: userId },
    data: { hearts: next, heartsLastRegenAt: newLast },
  });
  return next;
}

/**
 * Decrement hearts by 1 when a planned workout is missed.
 * Called by the workout-commit hook after `checkRoutineProgress`
 * when the user just completed a workout, OR by the cron-like
 * background sweep that runs daily.
 *
 * Clamped at 0. Returns the new count. Silent no-op in Casual mode.
 */
export async function loseHeart(userId: string, opts?: { reason?: string }): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hearts: true, mode: true },
  });
  if (!user || user.mode === 'CASUAL') return user?.hearts ?? 5;
  const next = Math.max(0, user.hearts - 1);
  // When dropping to 0, reset the regen timer so the next tick is a
  // full 8h away — preserves the cadence so a 0-heart user sees the
  // "next heart in" counter reset visually.
  await prisma.user.update({
    where: { id: userId },
    data: {
      hearts: next,
      heartsLastRegenAt: next === 0 ? new Date() : undefined,
    },
  });
  return next;
}

/// XP/gold/damage multiplier when hearts are at 0. Capped at 1.0
/// for any heart count ≥ 1. (Hardcore mode only — Casual ignores.)
export function heartMultiplier(hearts: number): number {
  if (hearts >= 1) return 1.0;
  return 0.5; // 50% — visible but not punishing to the point of quitting
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