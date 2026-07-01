/**
 * Casual vs Hardcore difficulty mode. Casual is the "slap on the
 * wrist" mode — hearts still drop (so the user can SEE they're
 * missing things) but no XP/gold/raid penalty applies. Hardcore
 * engages a graduated penalty ladder where every lost heart chops
 * a percentage off rewards.
 *
 *  - **Hearts**: 10 hearts (both modes). Lose 1 per missed planned
 *    workout (routine day with no workout by end of day) in either
 *    mode. Regen 1 per week (anchored to local Sunday midnight in
 *    the user's tz). Casual drops are visual-only; Hardcore drops
 *    apply a graduated multiplier (see heartMultiplier below).
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
 * value is bounded (10 max, 0 min) and the math is trivial. We compute
 * `floor((now - heartsLastRegenAt) / 1 week)` and add it to the stored
 * value, capped at 10. The last-regen timestamp is anchored to local
 * Sunday-midnight in the user's tz, so a user who lost a heart on
 * Wednesday gets a new one on Sunday morning (not just "one week
 * from the loss"). Casual mode skips the regen math entirely and
 * just returns the current count.
 *
 * The lib is pure-ish — the only DB touchpoints are read/write on
 * `User.hearts` + `User.heartsLastRegenAt`. The rest is computation.
 */
import { prisma } from './prisma.js';
import { lastSundayMidnightUtc } from './timezone.js';

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

  // Casual: hearts are visual-only — no regen math, no penalty. Just
  // return the current value (the UI shows the count, the user can
  // see it dropping, but no reward is affected).
  if (user.mode === 'CASUAL') return user.hearts;

  if (user.hearts >= MAX_HEARTS) {
    // Already full. Reset the timer so future losses regen from now.
    if (user.heartsLastRegenAt) {
      await prisma.user.update({
        where: { id: userId },
        data: { heartsLastRegenAt: new Date() },
      });
    }
    return MAX_HEARTS;
  }

  // Anchor: the most recent Sunday midnight in the user's tz.
  // If the user just dropped to 9 hearts on Wednesday, this still
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
  const next = Math.min(MAX_HEARTS, user.hearts + weeksSince);
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
    select: { hearts: true, mode: true },
  });
  if (!user) return 0;
  const next = Math.max(0, user.hearts - 1);
  // When dropping to 0 (Hardcore only — Casual regen cadence is
  // daily so this doesn't apply), reset the regen timer so the next
  // tick is a full regen-window away. For Casual we leave the
  // existing timer alone (it's a 24h cadence; see tickHearts).
  const isHardcore = user.mode === 'HARDCORE';
  await prisma.user.update({
    where: { id: userId },
    data: {
      hearts: next,
      ...(isHardcore && next === 0
        ? { heartsLastRegenAt: new Date() }
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