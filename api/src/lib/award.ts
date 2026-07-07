/**
 * Centralized XP / gold / soulstone awarding.
 *
 * Every reward path in the app funnels through awardXpGold() so
 * three invariants hold EVERYWHERE, not just on the workout route:
 *
 *   1. The Hardcore heart multiplier applies to all positive XP and
 *      gold (mode.ts's contract: "Applied to XP, gold, and raid
 *      damage… 0 hearts: ×0.00 — no progress at all"). Before this
 *      helper existed, only workouts.ts applied it — dailies,
 *      habits, quests, bosses, raid victory shares, and skill
 *      unlocks all paid full rewards at 0 hearts.
 *
 *   2. User.level is recomputed from the new XP total on every
 *      award. Previously only the workout route (and skill unlock)
 *      recomputed level, so XP from any other source didn't level
 *      you up until your next workout.
 *
 *   3. Negative deltas (e.g. negative-habit ticks) are applied at
 *      full magnitude — the multiplier never softens a penalty.
 *
 * Soulstones are NOT multiplied (rare fixed drops, not a rate
 * reward) — callers should generally create TTL Soulstone rows
 * instead (see schema `Soulstone`); the counter passthrough here
 * exists only for legacy call shapes.
 */
import { prisma } from './prisma.js';
import { levelFromXp } from './xp.js';
import { tickHearts, heartMultiplier, type UserMode } from './mode.js';

export type AwardResult = {
  /// Actually-granted amounts (after the multiplier).
  xp: number;
  gold: number;
  /// The multiplier that was applied to positive components.
  mult: number;
  /// User totals AFTER the award (so callers don't need a
  /// second user query to build their response).
  totalXp: number;
  totalGold: number;
  previousLevel: number;
  level: number;
  leveledUp: boolean;
};

export async function awardXpGold(
  userId: string,
  base: { xp?: number; gold?: number },
  opts: {
    /// Skip the heart multiplier (e.g. when the caller already
    /// applied it to the base amounts, like the workout route).
    applyHeartMultiplier?: boolean;
  } = {},
): Promise<AwardResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { xp: true, gold: true, level: true, mode: true },
  });
  if (!user) {
    return { xp: 0, gold: 0, mult: 1, totalXp: 0, totalGold: 0, previousLevel: 1, level: 1, leveledUp: false };
  }

  // Tick hearts first so the multiplier reflects any regen that
  // accrued since the last read. Non-finite hearts (malformed row)
  // fall back to no penalty rather than ×0.
  const applyMult = opts.applyHeartMultiplier !== false;
  let mult = 1;
  if (applyMult) {
    const hearts = await tickHearts(userId);
    mult = Number.isFinite(hearts)
      ? heartMultiplier(hearts, (user.mode ?? 'CASUAL') as UserMode)
      : 1;
  }

  // Positive components get the multiplier; negative ones apply at
  // full magnitude (penalties don't shrink when hearts are low).
  const scale = (v: number) => (v > 0 ? Math.round(v * mult) : Math.round(v));
  const xp = scale(base.xp ?? 0);
  const gold = scale(base.gold ?? 0);

  const newXp = user.xp + xp;
  // Never de-level: XP clawbacks (negative deltas) can drop the
  // total below the current level's threshold; keeping the higher
  // level matches the pre-existing behavior everywhere.
  const newLevel = Math.max(user.level, levelFromXp(newXp));

  await prisma.user.update({
    where: { id: userId },
    data: {
      xp: { increment: xp },
      gold: { increment: gold },
      ...(newLevel !== user.level ? { level: newLevel } : {}),
    },
  });

  return {
    xp,
    gold,
    mult,
    totalXp: newXp,
    totalGold: (user.gold ?? 0) + gold,
    previousLevel: user.level,
    level: newLevel,
    leveledUp: newLevel > user.level,
  };
}
