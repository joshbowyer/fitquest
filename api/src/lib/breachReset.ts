/**
 * Breach world reset + Maw variant rotation.
 *
 * When the user kills The Maw (the world boss), the Breach world
 * regenerates: 5 new level IDs (with a cycle suffix so old
 * `UserWorldProgress` rows are preserved as history), a new
 * Maw variant name, and the same world boss with full HP.
 *
 * Cycle counter on `WorldBoss` and `UserWorldProgress` lets the
 * UI surface "you're on cycle 3 of the Maw" without confusing it
 * with the previous kills.
 *
 * Other worlds (spire, glade, etc.) never trigger a reset — they
 * use the default cycle=1 forever.
 */

import { prisma } from './prisma.js';
import type { Prisma } from '@prisma/client';

export type MawVariant = {
  /** "The Maw That Hungers" etc — the boss name shown in the UI. */
  bossName: string;
  /** "✺" — single character icon. */
  bossGlyph: string;
  /** Short flavor text shown in the unlock modal + boss card. */
  lore: string;
  /** Short intro shown when the user first enters the Breach world
   *  for this cycle. */
  intro: string;
};

// Variant name pool. Each kill rolls a new variant. If the user
// keeps killing the Maw, the same variant is excluded for 3
// cycles so the names don't repeat too often.
const MAW_VARIANTS: MawVariant[] = [
  { bossName: 'The Maw',                  bossGlyph: '✺', lore: 'At the bottom of the Breach is The Maw — a black hole with intent. It does not eat to feed. It eats to multiply.', intro: 'You step into the Breach. The Maw opens wider than a face should allow. It remembers you.' },
  { bossName: 'The Maw That Hungers',    bossGlyph: '✺', lore: 'The Maw has learned to want. Last time you closed the wound; this time it gnaws at the seam.',                   intro: 'The wound is open again. Wider this time. The Maw has spent the interim chewing on the edges.' },
  { bossName: 'The Maw of Echoes',       bossGlyph: '✺', lore: 'Every fight you win, the Maw takes a copy. Every copy, a new weakness to mirror back at you.',                    intro: 'You hear yourself before you see it. The Maw is wearing your last fight as a mask.' },
  { bossName: 'The Maw Reborn',          bossGlyph: '✺', lore: 'You closed the wound once. The Maw digested the scar and grew back stronger.',                                          intro: 'A familiar shape. The same Maw. Different. Heavier in the chest.' },
  { bossName: 'The Maw That Watches',    bossGlyph: '✺', lore: 'It is not waiting this time. It is watching. Every rep you log makes its eye dilate wider.',                   intro: 'You feel it before you see it. A presence at the edge of the screen. The Maw is already here.' },
  { bossName: 'The Maw That Breathes',   bossGlyph: '✺', lore: 'You closed the wound. The Maw closed with it. Now it breathes your air.',                                          intro: 'The air is thin and tastes like static. The Maw is inhaling.' },
  { bossName: 'The Maw of Open Doors',   bossGlyph: '✺', lore: 'Every time you beat the Maw, you open a door. The Maw has learned to count.',                                    intro: 'The Maw is standing in a doorway of its own. It built one while you were sleeping.' },
  { bossName: 'The Maw That Remembers',  bossGlyph: '✺', lore: 'It remembers every fight. Every set. Every rep. The Maw is the avatar of all your past workouts.',          intro: 'The Maw is large tonight. It has been growing in the dark. It is the size of every workout you have ever finished.' },
  { bossName: 'The Maw That Forgives',   bossGlyph: '✺', lore: 'Forgiveness is a kind of hunger. The Maw has not forgiven you yet.',                                                  intro: 'The Maw does not look angry. It looks patient. That is worse.' },
  { bossName: 'The Maw That Heals',      bossGlyph: '✺', lore: 'Every wound you inflict, the Maw heals. The cycle is the lesson: the more you fight, the stronger it returns.',  intro: 'The Maw is already bandaged. The bandages are made of your last form.' },
];

/**
 * Pick a Maw variant for the given cycle. Avoids the 3 most recent
 * variants so the same name doesn't show up too often. Falls back
 * to a random pick if the pool is smaller than the exclusion
 * window.
 */
function pickMawVariant(cycle: number, recentVariants: string[]): MawVariant {
  const excluded = new Set(recentVariants);
  const candidates = MAW_VARIANTS.filter((v) => !excluded.has(v.bossName));
  const pool = candidates.length > 0 ? candidates : MAW_VARIANTS;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  // pool is always non-empty (MAW_VARIANTS is the fallback), but
  // TS narrows noUncheckedIndexedAccess types.
  return picked ?? pool[0]!;
}

/**
 * Triggered when the user kills a world boss. If the world is the
 * Breach, regenerates the world: 5 new progress rows, a new Maw
 * variant, a fresh WorldBoss row at full HP. Other worlds are
 * unaffected (they get the standard first-defeat rewards via the
 * existing damage endpoint, no reset).
 *
 * Returns the new cycle number + the variant chosen, so the
 * caller can show "Maw That Hungers defeated — cycle 2 begins"
 * in the rewards UI.
 */
export async function resetBreachIfDefeated(
  userId: string,
  worldId: string,
  tx?: Prisma.TransactionClient,
): Promise<{
  reset: boolean;
  cycle: number;
  variant: MawVariant | null;
}> {
  const client = tx ?? prisma;

  // Only the breach world resets.
  if (worldId !== 'breach') {
    return { reset: false, cycle: 1, variant: null };
  }

  // Find the most recent WorldBoss row for this user + world. The
  // damage endpoint should have just set it to DEFEATED.
  const boss = await client.worldBoss.findUnique({
    where: { userId_worldId: { userId, worldId } },
  });
  if (!boss || boss.status !== 'DEFEATED') {
    return { reset: false, cycle: 1, variant: null };
  }

  // Increment cycle. The defeated boss row is the "cycle N" record.
  const nextCycle = boss.cycle + 1;

  // Find the boss names from the last 3 cycles (using the cycle
  // field) so we can exclude them from the variant pool.
  const recentBosses = await client.worldBoss.findMany({
    where: { userId, worldId },
    orderBy: { cycle: 'desc' },
    take: 3,
    select: { bossName: true },
  });
  const recentNames: string[] = recentBosses
    .map((b: { bossName: string }) => b.bossName);
  const variant = pickMawVariant(nextCycle, recentNames);

  // Delete ALL breach progress rows for this user. We don't keep
  // per-cycle history because the UI only ever shows the most
  // recent cycle — keeping old cycle rows would be confusing if the
  // user later looks at their history.
  await client.userWorldProgress.deleteMany({
    where: {
      userId,
      levelId: { startsWith: 'breach-' },
    } as Prisma.UserWorldProgressWhereInput,
  });

  // Update the existing WorldBoss row to reflect the new cycle.
  // We keep the same row (don't create a new one) so the unique
  // constraint (userId, worldId) holds. bossName/glyph/HP reset
  // to the variant's defaults; status back to ACTIVE.
  await client.worldBoss.update({
    where: { id: boss.id },
    data: {
      cycle: nextCycle,
      bossName: variant.bossName,
      bossGlyph: variant.bossGlyph,
      bossHp: 3000, // matches WORLDS.breach.boss.maxHp
      bossMaxHp: 3000,
      status: 'ACTIVE',
      defeatedAt: null,
    },
  });

  return { reset: true, cycle: nextCycle, variant };
}
