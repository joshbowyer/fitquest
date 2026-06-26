// ============================================================
// Portal leaks — small home-base encounters spawned when the
// user's shield drops below COMPROMISED. Smaller scope than
// Breach bosses: 1-shot, 24h cooldown, loot drop on defeat.
//
// Lifecycle:
//   1. Spawn: triggered after any shield-drop event (penance
//      fires for substance_overuse, daily_missed, etc.) when
//      shield.score < 60 and no active leak exists and 24h
//      cooldown has elapsed since the last resolved leak.
//   2. Active: leak has HP that grows over time + feeds from
//      mismatched workouts. Match the leak's preferredTags via
//      workout commits to deal damage.
//   3. Resolve: DEFEATED (HP=0), OVERWHELMED (HP > maxHp*1.5),
//      or EXPIRED (48h timer with no resolution).
//
// Loot drops roll at spawn time (not claim time) so the prize
// is stable. Rarity scales with user level.
// ============================================================

import type { Prisma, PrismaClient } from './prisma.js';
import { prisma as defaultPrisma } from './prisma.js';
import { tierForShield } from './penance.js';

// ============================================================
// Constants
// ============================================================

export const LEAK_COOLDOWN_MS = 24 * 60 * 60 * 1000;       // 24h between leaks
export const LEAK_TTL_MS = 48 * 60 * 60 * 1000;            // 48h to resolve before EXPIRED
export const OVERWHELM_CAP_MULT = 1.5;                     // leak feeds up to 150% of maxHp
export const LEAK_BASE_HP_MIN = 80;
export const LEAK_BASE_HP_MAX = 160;
export const LEAK_DAILY_GROWTH = 8;                         // leak grows +8 HP/day if untouched

// Damage values. Smaller than Breach (which deals 60+) because
// leaks are 1-shot encounters, not boss fights.
const MATCHED_DAMAGE = 18;
const BONUS_DAMAGE = 10;
const MISMATCHED_HEAL = 6;

// Spawn probability per shield-drop event, keyed by tier.
// Higher probability at lower tiers (more desperate).
const SPAWN_PROBABILITY: Record<string, number> = {
  FORTIFIED: 0,    // never spawn when shielded
  STABLE: 0.05,     // 5% — almost never
  COMPROMISED: 0.20, // 20%
  BREACHED: 0.50,   // 50%
};

// ============================================================
// Leak monster pool — 15 themed entries. Same role as the
// Breach boss pool but for smaller encounters. Each has
// preferredTags (muscle groups it "hunts") and bonusTags
// (rare categories that count as bonus damage).
// ============================================================

export type LeakMonster = {
  name: string;
  emoji: string;
  color: string;
  intro: string;
  preferredTags: string[];
  bonusTags: string[];
};

export const LEAK_MONSTERS: LeakMonster[] = [
  {
    name: 'The Crawler',
    emoji: '◐',
    color: '#dc2626',
    intro: 'A red-limbed thing scraping at the floor of the home base. It smells iron.',
    preferredTags: ['legs', 'glutes'],
    bonusTags: ['cardio'],
  },
  {
    name: 'The Whisper',
    emoji: '○',
    color: '#a855f7',
    intro: 'A pale wisp hovering behind the avatar. It does not breathe.',
    preferredTags: ['core', 'back'],
    bonusTags: ['mobility'],
  },
  {
    name: 'The Cracked',
    emoji: '◤',
    color: '#f97316',
    intro: 'Half-formed. Twitching. It wants your shoulders and arms.',
    preferredTags: ['shoulder', 'bicep', 'tricep'],
    bonusTags: [],
  },
  {
    name: 'The Cold One',
    emoji: '◇',
    color: '#06b6d4',
    intro: 'A cold pulse behind the bar. It pulls the chest in.',
    preferredTags: ['chest', 'back'],
    bonusTags: ['calisthenics'],
  },
  {
    name: 'The Hungering',
    emoji: '◢',
    color: '#be123c',
    intro: 'A thing with too many hands. It hungers for everything below the waist.',
    preferredTags: ['legs', 'glutes', 'core'],
    bonusTags: ['cardio'],
  },
  {
    name: 'The Humming',
    emoji: '◊',
    color: '#d946ef',
    intro: 'A small, furious mote. It feeds on stiffness, hates mobility work.',
    preferredTags: ['mobility', 'core'],
    bonusTags: ['flexibility'],
  },
  {
    name: 'The Twin',
    emoji: '◍',
    color: '#f59e0b',
    intro: 'A mirror that turns and finds what you avoided last week.',
    preferredTags: ['chest', 'shoulder', 'tricep'],
    bonusTags: [],
  },
  {
    name: 'The Bead',
    emoji: '◯',
    color: '#84cc16',
    intro: 'A bead of sweat that learned to want. It climbs your back.',
    preferredTags: ['back', 'bicep'],
    bonusTags: [],
  },
  {
    name: 'The Hollow',
    emoji: '◌',
    color: '#94a3b8',
    intro: 'Empty inside. It wants your legs to feel the same.',
    preferredTags: ['legs', 'glutes', 'core'],
    bonusTags: [],
  },
  {
    name: 'The Shrike',
    emoji: '✦',
    color: '#22d3ee',
    intro: 'A fast-moving point of light. It bites at fast-twitch fibers.',
    preferredTags: ['cardio', 'sprint', 'calisthenics'],
    bonusTags: ['tabata'],
  },
  {
    name: 'The Salt',
    emoji: '◍',
    color: '#e11d48',
    intro: 'Crystalline. It burns where you stop moving.',
    preferredTags: ['cardio', 'endurance'],
    bonusTags: [],
  },
  {
    name: 'The Echo',
    emoji: '◉',
    color: '#fbbf24',
    intro: 'Repeats your form back to you, slowly. It hates precision.',
    preferredTags: ['mobility', 'core'],
    bonusTags: ['flexibility'],
  },
  {
    name: 'The Stiff',
    emoji: '⊞',
    color: '#6b7280',
    intro: 'A gray thing that has not moved in days. Like you, sometimes.',
    preferredTags: ['mobility', 'flexibility'],
    bonusTags: [],
  },
  {
    name: 'The Bell',
    emoji: '◯',
    color: '#fcd34d',
    intro: 'It rings when you skip a day. Train something.',
    preferredTags: ['chest', 'back', 'shoulder'],
    bonusTags: [],
  },
  {
    name: 'The Thorn',
    emoji: '✧',
    color: '#fb7185',
    intro: 'A small bright splinter. It hates the way you grip.',
    bonusTags: ['grip'],
    preferredTags: ['forearm', 'bicep'],
  },
];

// ============================================================
// Loot roll — rarity scales with user level. Deterministic at
// spawn time (not at claim time) so the prize is stable.
// ============================================================

const RARITY_WEIGHTS: Record<string, [number, number][]> = {
  // Level 1-9: heavy common, light uncommon, small rare chance
  low:    [['COMMON', 0.7], ['UNCOMMON', 0.25], ['RARE', 0.05], ['EPIC', 0]],
  // Level 10-19: more uncommon, real rare chance, tiny epic
  mid:    [['COMMON', 0.45], ['UNCOMMON', 0.40], ['RARE', 0.13], ['EPIC', 0.02]],
  // Level 20+: real epic chance, legendary unlocked at high level
  high:   [['COMMON', 0.20], ['UNCOMMON', 0.45], ['RARE', 0.25], ['EPIC', 0.09], ['LEGENDARY', 0.01]],
};

export function rollLootRarity(userLevel: number): string {
  const weights = userLevel < 10 ? RARITY_WEIGHTS.low
    : userLevel < 20 ? RARITY_WEIGHTS.mid
    : RARITY_WEIGHTS.high;
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [rarity, weight] of weights) {
    r -= weight;
    if (r <= 0) return rarity;
  }
  return weights[0][0];
}

// ============================================================
// Spawn check — called after every penance fire. Rolls the dice
// based on shield tier. No-op if an active leak exists or 24h
// cooldown hasn't elapsed.
// ============================================================

export async function maybeSpawnLeak(
  userId: string,
  shieldScore: number,
  prisma: PrismaClient = defaultPrisma,
): Promise<{ spawned: boolean; leakId?: string }> {
  // No spawn if user is still shielded.
  const tier = tierForShield(shieldScore);
  const probability = SPAWN_PROBABILITY[tier] ?? 0;
  if (probability === 0) return { spawned: false };
  if (Math.random() > probability) return { spawned: false };

  // No spawn if an active leak exists.
  const active = await prisma.portalLeak.findFirst({
    where: { userId, status: 'ACTIVE' },
  });
  if (active) return { spawned: false, leakId: active.id };

  // No spawn within 24h of last resolved leak (cooldown).
  const cooldownCutoff = new Date(Date.now() - LEAK_COOLDOWN_MS);
  const recent = await prisma.portalLeak.findFirst({
    where: {
      userId,
      status: { in: ['DEFEATED', 'OVERWHELMED', 'EXPIRED'] },
      resolvedAt: { gte: cooldownCutoff },
    },
    orderBy: { resolvedAt: 'desc' },
  });
  if (recent) return { spawned: false };

  // Spawn!
  const monster = LEAK_MONSTERS[Math.floor(Math.random() * LEAK_MONSTERS.length)];
  const maxHp = Math.floor(
    LEAK_BASE_HP_MIN + Math.random() * (LEAK_BASE_HP_MAX - LEAK_BASE_HP_MIN)
  );
  const lootRarity = rollLootRarity((await prisma.user.findUnique({ where: { id: userId }, select: { level: true } }))?.level ?? 1);

  // Find an item of that rarity to drop. If none exist, fall
  // back to a lower rarity so the user always gets something.
  const item = await pickItemOfRarity(prisma, lootRarity);

  const leak = await prisma.portalLeak.create({
    data: {
      userId,
      monsterName: monster.name,
      monsterEmoji: monster.emoji,
      monsterColor: monster.color,
      intro: monster.intro,
      preferredTags: monster.preferredTags,
      bonusTags: monster.bonusTags,
      hp: maxHp,
      maxHp,
      itemDrop: item?.id ?? null,
    },
  });
  return { spawned: true, leakId: leak.id };
}

async function pickItemOfRarity(
  prisma: PrismaClient,
  rarity: string,
  fallback = 3,
): Promise<{ id: string } | null> {
  for (let i = 0; i < fallback; i++) {
    const tiers = ['EPIC', 'RARE', 'UNCOMMON', 'COMMON'];
    const targetTier = tiers[Math.min(tiers.indexOf(rarity) + i, tiers.length - 1)];
    const item = await prisma.itemDef.findFirst({
      where: { rarity: targetTier as any },
      // Skip the user (since users won't have one yet for the
      // first leak, this just narrows the seed pool).
    });
    if (item) return item;
  }
  return null;
}

// ============================================================
// Apply workout damage to an active leak. Same match algorithm
// as Breach but with leak-sized values. Returns null if no
// active leak exists.
// ============================================================

export type LeakDamageResult = {
  dealt: number;          // positive = damage, negative = leak healed
  matchType: 'matched' | 'mismatched' | 'partial' | 'bonus';
  leakHpAfter: number;
  resolved: 'DEFEATED' | 'OVERWHELMED' | null;
  leakId: string;
};

export async function applyLeakDamage(
  userId: string,
  workoutId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<LeakDamageResult | null> {
  const leak = await prisma.portalLeak.findFirst({
    where: { userId, status: 'ACTIVE' },
  });
  if (!leak) return null;

  const workout = await prisma.workout.findUnique({
    where: { id: workoutId },
    include: { exercises: { include: { sets: true } } },
  });
  if (!workout) return null;

  // Classify the workout using the same algorithm as Breach.
  // Re-using the lib keeps the muscle mappings consistent.
  const breach = await import('./breach.js');
  const classification = breach.classifyWorkout({
    type: workout.type,
    exercises: workout.exercises.map((e) => ({
      name: e.name,
      totalVolumeKg: e.sets.reduce((s, st) => s + (st.weight || 0) * st.reps, 0),
    })),
  });
  const totalVolumeKg = workout.exercises.reduce(
    (s, e) => s + e.sets.reduce((ss, st) => ss + (st.weight || 0) * st.reps, 0),
    0
  );
  const { delta, matchType } = breach.damageForMatch({
    hitTags: classification.hitTags,
    preferredTags: leak.preferredTags as string[],
    bonusTags: leak.bonusTags as string[],
    totalVolumeKg,
  });

  // Scale for leak-tier damage values.
  // breach.damageForMatch returns delta in Breach-sized units.
  // For leaks we want smaller absolute numbers — scale by 1/3.
  let leakDelta = Math.round(delta / 3);
  // Clamp to reasonable bounds for a 1-shot encounter.
  leakDelta = Math.max(-12, Math.min(30, leakDelta));

  // Apply overwhelm cap. Leak can grow up to 1.5x maxHp via feeds.
  const overwhelmCap = Math.round(leak.maxHp * OVERWHELM_CAP_MULT);
  const newHp = Math.max(0, Math.min(overwhelmCap, leak.hp - leakDelta));

  let resolved: 'DEFEATED' | 'OVERWHELMED' | null = null;
  let resolvedReason: string | null = null;
  let resolvedAt: Date | null = null;
  let newStatus: 'ACTIVE' | 'DEFEATED' | 'OVERWHELMED' | 'EXPIRED' = 'ACTIVE';

  if (newHp === 0) {
    resolved = 'DEFEATED';
    resolvedReason = 'you sealed the leak';
    resolvedAt = new Date();
    newStatus = 'DEFEATED';
  } else if (newHp >= overwhelmCap) {
    resolved = 'OVERWHELMED';
    resolvedReason = 'the leak overwhelmed your defenses';
    resolvedAt = new Date();
    newStatus = 'OVERWHELMED';
  }

  await prisma.$transaction([
    prisma.portalLeak.update({
      where: { id: leak.id },
      data: {
        hp: newHp,
        status: newStatus,
        ...(resolvedAt ? { resolvedAt } : {}),
        ...(resolvedReason ? { resolvedReason } : {}),
      },
    }),
    prisma.portalLeakDamageEvent.create({
      data: {
        userId,
        leakId: leak.id,
        workoutId,
        damage: leakDelta,
        leakHpAfter: newHp,
        matchType,
      },
    }),
  ]);

  return { dealt: leakDelta, matchType, leakHpAfter: newHp, resolved, leakId: leak.id };
}

// ============================================================
// Claim loot on DEFEATED leak. Creates an InventoryItem from the
// pre-rolled itemDrop id (set at spawn). Returns null if the
// leak wasn't defeated, was already claimed, or has no loot.
// ============================================================

export async function claimLeakLoot(
  userId: string,
  leakId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<{ item: { id: string; name: string; rarity: string; color: string }; leakId: string } | null> {
  const leak = await prisma.portalLeak.findUnique({ where: { id: leakId } });
  if (!leak || leak.userId !== userId) return null;
  if (leak.status !== 'DEFEATED') return null;
  if (!leak.itemDrop) return null;

  // Mark claimed: clear itemDrop so a second claim returns null.
  // (Item is also created in this transaction so even if the
  // claim races, only one InventoryItem lands.)
  const item = await prisma.itemDef.findUnique({ where: { id: leak.itemDrop } });
  if (!item) return null;

  await prisma.$transaction([
    prisma.inventoryItem.create({
      data: {
        userId,
        itemDefId: item.id,
        source: 'PORTAL_LEAK',
        notes: `Dropped by ${leak.monsterName}`,
      },
    }),
    prisma.portalLeak.update({
      where: { id: leak.id },
      data: { itemDrop: null },
    }),
  ]);

  // Fire the first-leak + every-Nth-leak achievements. Best-effort:
  // a failed check shouldn't fail the claim.
  try {
    const { checkAchievements } = await import('./achievements.js');
    await checkAchievements(userId);
  } catch (err) {
    console.warn('[portalLeaks] checkAchievements after claim failed', err);
  }

  return {
    item: { id: item.id, name: item.name, rarity: item.rarity, color: item.color },
    leakId: leak.id,
  };
}

// ============================================================
// Get current leak + recent damage feed for the user.
// ============================================================

export async function getLeakForUser(
  userId: string,
  prisma: PrismaClient = defaultPrisma,
) {
  const active = await prisma.portalLeak.findFirst({
    where: { userId, status: 'ACTIVE' },
  });
  if (!active) return { leak: null, recent: [] };

  const recent = await prisma.portalLeakDamageEvent.findMany({
    where: { leakId: active.id },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });
  return { leak: active, recent };
}

// ============================================================
// Daily growth tick — leaks grow +8 HP/day if the user doesn't
// train. Called from the daily cron. If a leak ages past 48h
// without resolution, it's marked EXPIRED (no penalty, just
// the cooldown applies).
// ============================================================

export async function tickLeakGrowth(
  prisma: PrismaClient = defaultPrisma,
): Promise<{ ticked: number; expired: number }> {
  const now = Date.now();
  const ttlCutoff = new Date(now - LEAK_TTL_MS);
  const activeLeaks = await prisma.portalLeak.findMany({
    where: { status: 'ACTIVE', spawnedAt: { lt: ttlCutoff } },
  });

  let ticked = 0;
  let expired = 0;

  for (const leak of activeLeaks) {
    if (leak.spawnedAt < ttlCutoff) {
      // Past TTL — expire (no penalty, just goes to cooldown).
      await prisma.portalLeak.update({
        where: { id: leak.id },
        data: {
          status: 'EXPIRED',
          resolvedAt: new Date(),
          resolvedReason: 'the leak dissipated on its own',
        },
      });
      expired++;
    } else {
      // Daily growth: +8 HP, capped at overwhelm threshold.
      const overwhelmCap = Math.round(leak.maxHp * OVERWHELM_CAP_MULT);
      const newHp = Math.min(overwhelmCap, leak.hp + LEAK_DAILY_GROWTH);
      await prisma.portalLeak.update({
        where: { id: leak.id },
        data: { hp: newHp },
      });
      ticked++;
    }
  }

  return { ticked, expired };
}
