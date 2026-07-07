// ============================================================
// The Breach — boss combat + rotation logic
// ============================================================
//
// At level 10 the Nexus reveals a sealed leak: a black hole
// in the constellation. Each user has exactly one ACTIVE boss
// at any time. Logging a workout deals damage to the boss if
// the workout's exercises match the boss's preferredTags, or
// heals it (a small amount) if they don't. The user wants to
// push the boss toward 0 HP, not feed it.
//
// Boundaries:
// - Daily damage cap: 1.5× boss.maxHp. The boss can be killed
//   in two consecutive workouts of good match; never in one.
// - Re-encounter: dying to a boss doesn't rotate it out. The
//   same boss comes back at +25% maxHp until killed.
// - No-repeat rotation: killed bosses are pushed onto
//   `recentBossIds` (capped at 10). New bosses picked from the
//   pool excluding the recent 10, weighted by class affinity.
//
// Drop table (per kill):
// - MINOR: 10-25 gold, 1 soulstone, 30% chance of COMMON item
// - ELITE: 25-50 gold, 2 soulstones, COMMON item guaranteed
// - LEGENDARY: 50-100 gold, 5 soulstones, RARE item guaranteed
// - APEX: 100-200 gold, 10 soulstones, EPIC item guaranteed

import type { Prisma, PrismaClient, WorkoutType } from './prisma.js';
import { prisma as defaultPrisma } from './prisma.js';
import { pickItemOfRarity } from './portalLeaks.js';
import { localDayKey } from './timezone.js';
import {
  applyCombatPetOutcome,
  getDeployedCombatPet,
  grantPosthumousPetXp,
  maxHpForLevel,
  PET_HP_LOSS_PER_BOSS,
  PET_XP_PER_BOSS_KILL,
} from './petStats.js';

export const BREACH_UNLOCK_LEVEL = 10;

// Daily damage cap as a multiplier of boss.maxHp. Single-workout
// insta-kills would defeat the whole point of the boss. Two
// consecutive good-match workouts can still kill a boss, which
// is the design — but never one.
export const DAILY_DAMAGE_CAP_RATIO = 1.5;

// Home-base shield tier scales outgoing damage to a boss:
//   FORTIFIED    0.5×  healthy home base resists the breach
//   STABLE       1.0×  baseline
//   COMPROMISED  1.25× slight bump
//   BREACHED     2.0×  the leak is already in; the breach escalates
// Heals aren't scaled (the mismatched-heal math doesn't amplify).
const SHIELD_TIER_DMG_MULT: Record<string, number> = {
  FORTIFIED: 0.5,
  STABLE: 1.0,
  COMPROMISED: 1.25,
  BREACHED: 2.0,
};

// Re-encounter rule: same boss after death returns at +25% maxHp.
// The HP delta is applied per death, so a third death makes it
// 1.25² = 1.5625× maxHp, etc. Caps at 2.0× to keep it bounded.
export const REENCOUNTER_HP_MULT_PER_DEATH = 0.25;
export const REENCOUNTER_HP_MULT_MAX = 2.0;

// XP per kill = baseXP × tierMultiplier × user.level
export const BREACH_KILL_XP_BASE = 50;
const TIER_XP_MULT: Record<string, number> = {
  MINOR: 1.0,
  ELITE: 1.5,
  LEGENDARY: 2.5,
  APEX: 4.0,
};

// Soulstone drops per kill by tier.
const TIER_SOULSTONES: Record<string, [number, number]> = {
  MINOR: [1, 1],
  ELITE: [2, 3],
  LEGENDARY: [4, 6],
  APEX: [8, 12],
};

// Gold range per kill by tier.
const TIER_GOLD: Record<string, [number, number]> = {
  MINOR: [10, 25],
  ELITE: [25, 50],
  LEGENDARY: [50, 100],
  APEX: [100, 200],
};

// Max recent bosses kept for "no repeat" rotation. The 11th kill
// pushes the oldest off, so the user sees a fresh boss every
// time after their first 10 kills.
export const RECENT_BOSS_MEMORY = 10;

// Base damage per matched workout. Tuned to ~kill a 1-star boss
// (500 HP) in 3 matched workouts at the upper end.
export const BASE_MATCHED_DAMAGE = 60;
export const BASE_BONUS_DAMAGE = 35;
export const BASE_MISMATCHED_DAMAGE = 6;  // mismatched workouts deal a small amount of damage (was a heal that fed the boss; flipped so any workout at least chips away at the boss)

// XP awarded per damage-dealing workout, scaled by match quality.
// Even failed workouts (mismatched) give a small floor so the
// user feels like every workout matters.
export const XP_PER_MATCHED_DAMAGE_UNIT = 0.4;
export const XP_FLOOR_PER_WORKOUT = 8;

// ============================================================
// Tag classification
// ============================================================

export const EXERCISE_BODY_PART_TAGS: Record<string, string[]> = {
  // Push: chest/shoulder/triceps dominant
  bench: ['chest', 'triceps', 'push'],
  incline_bench: ['chest', 'shoulder', 'push'],
  dumbbell_bench: ['chest', 'triceps', 'push'],
  decline_bench: ['chest', 'triceps', 'push'],
  push_up: ['chest', 'triceps', 'push', 'bodyweight'],
  dip: ['chest', 'triceps', 'push', 'bodyweight'],
  overhead_press: ['shoulder', 'triceps', 'push'],
  ohp: ['shoulder', 'triceps', 'push'],
  arnold_press: ['shoulder', 'triceps', 'push'],
  lateral_raise: ['shoulder', 'push'],
  tricep_extension: ['triceps', 'push'],
  skull_crusher: ['triceps', 'push'],
  // Pull: back/biceps dominant
  pullup: ['back', 'biceps', 'pull', 'bodyweight'],
  chin_up: ['back', 'biceps', 'pull', 'bodyweight'],
  row: ['back', 'pull'],
  pendlay_row: ['back', 'pull'],
  lat_pulldown: ['back', 'biceps', 'pull'],
  deadlift: ['back', 'legs', 'pull', 'heavy_compound'],
  romanian_deadlift: ['legs', 'back', 'pull'],
  rdl: ['legs', 'back', 'pull'],
  bicep_curl: ['biceps', 'pull'],
  hammer_curl: ['biceps', 'pull'],
  face_pull: ['back', 'pull'],
  // Legs: quads/hams/glutes/calves
  squat: ['legs', 'push', 'heavy_compound'],
  front_squat: ['legs', 'push', 'heavy_compound'],
  goblet_squat: ['legs', 'push'],
  lunge: ['legs', 'push'],
  bulgarian_split_squat: ['legs', 'push'],
  single_leg_rdl: ['legs', 'pull'],
  leg_press: ['legs', 'push'],
  leg_extension: ['legs', 'push'],
  leg_curl: ['legs', 'pull'],
  calf_raise: ['legs', 'calves'],
  hip_thrust: ['legs', 'glutes', 'push'],
  glute_bridge: ['legs', 'glutes', 'push'],
  // Core
  plank: ['core', 'bodyweight'],
  crunch: ['core', 'bodyweight'],
  sit_up: ['core', 'bodyweight'],
  hanging_leg_raise: ['core', 'pull', 'bodyweight'],
  ab_wheel: ['core'],
  russian_twist: ['core'],
  // Cardio / endurance / mobility
  running: ['cardio', 'endurance'],
  cycling: ['cardio', 'endurance'],
  swimming: ['cardio', 'endurance', 'full_body'],
  rowing: ['cardio', 'endurance', 'back', 'pull'],
  jump_rope: ['cardio', 'endurance', 'calves'],
  hiking: ['cardio', 'endurance', 'legs'],
  yoga: ['mobility', 'flexibility'],
  stretch: ['mobility', 'flexibility'],
  foam_roll: ['mobility', 'recovery'],
};

// Tags implied by workout type when no exercise name matches.
// Provides a fallback for users who log generic workouts.
const TYPE_DEFAULT_TAGS: Record<string, string[]> = {
  STRENGTH: ['strength', 'heavy_compound'],
  HYPERTROPHY: ['hypertrophy', 'bodybuilding'],
  CALISTHENICS: ['bodyweight', 'calisthenics'],
  CARDIO: ['cardio', 'endurance'],
  MOBILITY: ['mobility', 'flexibility'],
  OTHER: ['strength'],
};

export type MatchResult = {
  matchType: 'matched' | 'bonus' | 'partial' | 'mismatched';
  baseDamage: number;
  hitTags: string[];
};

export function classifyWorkout(input: {
  type: string;
  exercises: { name: string; totalVolumeKg?: number }[];
}): MatchResult {
  const bossPreferred = new Set<string>();
  const hitTags: string[] = [];

  // Gather tags from exercise names first.
  for (const ex of input.exercises) {
    const normalized = ex.name.toLowerCase().replace(/[^a-z0-9_ ]/g, '').replace(/\s+/g, '_');
    // Try exact match, then partial.
    const tags = EXERCISE_BODY_PART_TAGS[normalized] ||
      Object.entries(EXERCISE_BODY_PART_TAGS).find(([k]) => normalized.includes(k))?.[1] ||
      [];
    for (const t of tags) {
      if (!hitTags.includes(t)) hitTags.push(t);
    }
  }

  // Add type-default tags when no exercise tags matched.
  if (hitTags.length === 0) {
    const defaults = TYPE_DEFAULT_TAGS[input.type] || ['strength'];
    hitTags.push(...defaults);
  }

  return {
    matchType: 'partial', // caller cross-references against boss tags.
    baseDamage: BASE_MATCHED_DAMAGE,
    hitTags,
  };
}

// Returns damage deltas (positive = damage, negative = heal) given
// a workout classification and a boss's preferredTags.
export function damageForMatch(input: {
  hitTags: string[];
  preferredTags: string[];
  bonusTags?: string[];
  totalVolumeKg?: number;
}): { delta: number; matchType: MatchResult['matchType'] } {
  const pref = new Set(input.preferredTags);
  const bonus = new Set(input.bonusTags || []);
  const hits = input.hitTags.filter((t) => pref.has(t) || bonus.has(t));

  if (hits.length === 0) {
    // Mismatched: small heal (negative damage), capped to 1/4 of
    // BASE_MATCHED_DAMAGE so the user isn't punished too hard for
    // cardio on a strength day.
    return { delta: BASE_MISMATCHED_DAMAGE, matchType: 'mismatched' };
  }

  // Bonus tag hits deal bonus damage on top of the matched base.
  const matchedCount = hits.filter((t) => pref.has(t)).length;
  const bonusCount = hits.filter((t) => bonus.has(t) && !pref.has(t)).length;

  let delta = BASE_MATCHED_DAMAGE;
  if (matchedCount >= 2) delta += BASE_MATCHED_DAMAGE * 0.5;
  if (bonusCount > 0) delta += BASE_BONUS_DAMAGE * bonusCount;

  // Volume bonus: heavy compound sets scale damage up. Capped at
  // +50% so a marathon squat session doesn't one-shot a boss.
  if (input.totalVolumeKg && input.totalVolumeKg > 0) {
    const volumeBonus = Math.min(input.totalVolumeKg / 8000, 0.5);
    delta = Math.round(delta * (1 + volumeBonus));
  }

  const matchType = bonusCount > 0 && matchedCount > 0 ? 'bonus' : matchedCount >= 2 ? 'matched' : 'partial';
  return { delta, matchType };
}

// ============================================================
// Difficulty → maxHp
// ============================================================

export function bossHpForDifficulty(d: string): number {
  switch (d) {
    case 'ONE': return 500;
    case 'TWO': return 800;
    case 'THREE': return 1200;
    case 'FOUR': return 1800;
    case 'FIVE': return 2500;
    default: return 1000;
  }
}

// ============================================================
// Progress lazy-create + unlock
// ============================================================

export async function getOrCreateProgress(
  userId: string,
  prisma: PrismaClient = defaultPrisma
) {
  let progress = await prisma.userBreachProgress.findUnique({ where: { userId } });
  if (!progress) {
    progress = await prisma.userBreachProgress.create({
      data: {
        userId,
        status: 'LOCKED',
        bossHp: 0,
        kills: 0,
        deaths: 0,
        // NOTE: no `soulstones` here — the counter column was
        // dropped in the soulstone-TTL migration (021082d);
        // writing it made Prisma reject the create at runtime.
        damageToday: 0,
        recentBossIds: [],
      },
    });
  }
  return progress;
}

export async function unlockBreachIfReady(
  userId: string,
  userLevel: number,
  prisma: PrismaClient = defaultPrisma
) {
  if (userLevel < BREACH_UNLOCK_LEVEL) return null;
  const progress = await getOrCreateProgress(userId, prisma);
  if (progress.unlockedAt) return progress;
  const now = new Date();
  // First unlock: rotate in a boss so the user has something to
  // fight immediately.
  const boss = await rollNextBoss(userId, progress.recentBossIds as string[], prisma);
  const reHp = progress.deaths > 0
    ? Math.round(boss.maxHp * Math.min(1 + progress.deaths * REENCOUNTER_HP_MULT_PER_DEATH, REENCOUNTER_HP_MULT_MAX))
    : boss.maxHp;
  const updated = await prisma.userBreachProgress.update({
    where: { userId },
    data: {
      unlockedAt: now,
      status: 'ACTIVE',
      currentBossId: boss.id,
      bossHp: reHp,
      recentBossIds: [boss.id, ...(progress.recentBossIds as string[])].slice(0, RECENT_BOSS_MEMORY),
    },
  });
  return updated;
}

// ============================================================
// Rotation: pick the next boss from the pool
// ============================================================

export async function rollNextBoss(
  userId: string,
  excludeIds: string[],
  prisma: PrismaClient = defaultPrisma
) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { class: true } });
  const userClass = user?.class;

  const candidates = await prisma.breachBoss.findMany({
    where: { id: { notIn: excludeIds } },
  });
  if (candidates.length === 0) {
    // All bosses fought recently — clear memory and retry.
    const all = await prisma.breachBoss.findMany();
    return weightedPick(all, userClass);
  }
  return weightedPick(candidates, userClass);
}

// Generic over the candidate row so callers get back the full
// BreachBoss shape they passed in (rollNextBoss passes complete
// rows — the old inline annotation dropped maxHp/name/etc.).
function weightedPick<T extends { classAffinity: string }>(
  candidates: T[],
  userClass?: string | null
): T {
  // Weight per candidate:
  //   - Matching classAffinity: 4x
  //   - ANY class: 2x (always relevant)
  //   - Other class: 1x (variety)
  //   - Bosses the user just fought are excluded by caller.
  const weighted = candidates.map((c) => {
    let weight = 1;
    if (c.classAffinity === 'ANY') weight = 2;
    else if (c.classAffinity === userClass) weight = 4;
    return { c, weight };
  });
  const total = weighted.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const w of weighted) {
    r -= w.weight;
    if (r <= 0) return w.c;
  }
  // Non-null assertion preserves the original behavior exactly:
  // with a non-empty list the loop above always returns (weights
  // sum to `total` and r < total); an empty list threw TypeError
  // before and still does.
  return weighted[weighted.length - 1]!.c;
}

// ============================================================
// Apply workout damage
// ============================================================

export async function applyWorkoutDamage(
  userId: string,
  workoutId: string,
  prisma: PrismaClient = defaultPrisma
): Promise<{
  dealt: number;
  matchType: string;
  bossHpAfter: number;
  killed: boolean;
  /** Shield-tier multiplier that was applied to this hit (0.5×..2.0×). */
  shieldMult: number;
  /** Tier name (FORTIFIED / STABLE / COMPROMISED / BREACHED). */
  shieldTier: string;
} | null> {
  const progress = await getOrCreateProgress(userId, prisma);
  if (progress.status !== 'ACTIVE' || !progress.currentBossId) return null;

  // Look up the user's tz for tz-aware damage-cap day boundaries.
  // The damageToday/damageDayKey pair is reset whenever the local
  // date rolls over in the user's tz — was previously UTC midnight.
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const tz = userRow?.timezone ?? null;

  const boss = await prisma.breachBoss.findUnique({ where: { id: progress.currentBossId } });
  if (!boss) return null;

  // Read the user's current shield tier so we can scale outgoing
  // damage per the home-base engagement rule. We look it up from
  // HomeBase which is the source of truth for shield state.
  const homeBase = await prisma.homeBase.findUnique({ where: { userId } });
  const userShieldTier = (homeBase?.tier ?? 'STABLE') as keyof typeof SHIELD_TIER_DMG_MULT;

  const workout = await prisma.workout.findUnique({
    where: { id: workoutId },
    include: { exercises: { include: { sets: true } } },
  });
  if (!workout) return null;

  const classification = classifyWorkout({
    type: workout.type,
    exercises: workout.exercises.map((e) => ({
      name: e.name,
      totalVolumeKg: e.sets.reduce((s, st) => s + (st.completed ? (st.weight || 0) * st.reps : 0), 0),
    })),
  });

  const totalVolumeKg = workout.exercises.reduce(
    (s, e) => s + e.sets.reduce((ss, st) => ss + (st.completed ? (st.weight || 0) * st.reps : 0), 0),
    0
  );

  const { delta, matchType } = damageForMatch({
    hitTags: classification.hitTags,
    preferredTags: boss.preferredTags as string[],
    bonusTags: boss.bonusTags as string[],
    totalVolumeKg,
  });

  // Daily cap (positive damage only — heals aren't capped).
  let appliedDelta = delta;
  const dayKey = todayKey(tz);
  let damageToday = progress.damageToday || 0;
  let damageDayKey = progress.damageDayKey || dayKey;
  if (damageDayKey !== dayKey) {
    damageToday = 0;
    damageDayKey = dayKey;
  }

  // Shield-tier damage modifier. FORTIFIED halves damage (a healthy
  // home base resists), BREACHED doubles it (the leak is already
  // in). Heals aren't multiplied — negative damage stays as the
  // raw mismatched-heal value so the boss can't be healed harder
  // by a vulnerable home base.
  const shieldMult = SHIELD_TIER_DMG_MULT[userShieldTier] ?? 1.0;
  if (appliedDelta > 0) {
    appliedDelta = Math.round(appliedDelta * shieldMult);
  }
  if (delta > 0) {
    const cap = Math.round(boss.maxHp * DAILY_DAMAGE_CAP_RATIO);
    const remaining = Math.max(0, cap - damageToday);
    if (appliedDelta > remaining) appliedDelta = remaining;
    damageToday += appliedDelta;
  }

  const bossHpBefore = progress.bossHp;
  const newHp = Math.max(0, Math.min(boss.maxHp, bossHpBefore - appliedDelta));
  const killed = newHp === 0;

  // Apply in a transaction: progress + damage event.
  await prisma.$transaction([
    prisma.userBreachProgress.update({
      where: { userId },
      data: {
        bossHp: newHp,
        damageToday,
        damageDayKey,
        ...(killed ? { status: 'VICTORY' } : {}),
      },
    }),
    prisma.breachDamageEvent.create({
      data: {
        userId,
        bossId: boss.id,
        workoutId,
        damage: appliedDelta,
        bossHpAfter: newHp,
        matchType,
      },
    }),
  ]);

  return {
    dealt: appliedDelta,
    matchType,
    bossHpAfter: newHp,
    killed,
    shieldMult,
    shieldTier: userShieldTier,
  };
}

// ============================================================
// Kill reward — claim after VICTORY state
// ============================================================

export type BreachKillReward = {
  gold: number;
  soulstones: number;
  xp: number;
  itemTier: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | null;
  itemDropChance: number;
};

export function rewardForKill(boss: { tier: string; maxHp: number }, userLevel: number): BreachKillReward {
  // `.MINOR!` — MINOR is a static key of the literals above; the
  // Record<string, ...> index type just can't prove it.
  const goldRange = TIER_GOLD[boss.tier] || TIER_GOLD.MINOR!;
  const ssRange = TIER_SOULSTONES[boss.tier] || TIER_SOULSTONES.MINOR!;
  const tierMult = TIER_XP_MULT[boss.tier] || 1.0;
  const gold = randInt(goldRange[0], goldRange[1]);
  const soulstones = randInt(ssRange[0], ssRange[1]);
  const xp = Math.round(BREACH_KILL_XP_BASE * tierMult + userLevel * 5);

  // Drop table by tier.
  let itemTier: BreachKillReward['itemTier'] = null;
  let itemDropChance = 0;
  switch (boss.tier) {
    case 'MINOR':
      itemTier = 'COMMON';
      itemDropChance = 0.30;
      break;
    case 'ELITE':
      itemTier = 'COMMON';
      itemDropChance = 1.0;
      break;
    case 'LEGENDARY':
      itemTier = 'RARE';
      itemDropChance = 1.0;
      break;
    case 'APEX':
      itemTier = 'EPIC';
      itemDropChance = 1.0;
      break;
  }

  return { gold, soulstones, xp, itemTier, itemDropChance };
}

export async function claimKill(
  userId: string,
  prisma: PrismaClient = defaultPrisma
): Promise<BreachKillReward | null> {
  const progress = await getOrCreateProgress(userId, prisma);
  if (progress.status !== 'VICTORY' || !progress.currentBossId) return null;
  const boss = await prisma.breachBoss.findUnique({ where: { id: progress.currentBossId } });
  if (!boss) return null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  const reward = rewardForKill(boss, user.level);

  // Roll item if applicable. Filter by boss class affinity so
  // e.g. a JUGGERNAUT-affinity breach boss drops Juggernaut gear
  // (plus universals). ANY affinity = unfiltered pool.
  let itemId: string | null = null;
  if (reward.itemTier && Math.random() < reward.itemDropChance) {
    const classFilter = boss.classAffinity === 'ANY' ? null : boss.classAffinity;
    const pick = await pickItemOfRarity(prisma, reward.itemTier, classFilter);
    if (pick) {
      itemId = pick.id;
      await prisma.inventoryItem.create({
        data: {
          userId,
          itemDefId: pick.id,
          source: 'BOSS_DROP',
          notes: `Dropped by ${boss.name}`,
        },
      });
    }
  }

  // Rotate next boss.
  const nextBoss = await rollNextBoss(
    userId,
    (progress.recentBossIds as string[]).filter((id) => id !== boss.id),
    prisma
  );

  await prisma.userBreachProgress.update({
    where: { userId },
    data: {
      status: 'ACTIVE',
      currentBossId: nextBoss.id,
      bossHp: nextBoss.maxHp,
      kills: progress.kills + 1,
      // NOTE: no `soulstones` counter update — the column was
      // dropped in the soulstone-TTL migration (021082d); the
      // stale write made Prisma reject this update at runtime.
      // reward.soulstones is still returned to the caller.
      recentBossIds: [nextBoss.id, ...((progress.recentBossIds as string[]).filter((id) => id !== boss.id))].slice(0, RECENT_BOSS_MEMORY),
    },
  });
  await prisma.user.update({
    where: { id: userId },
    data: {
      gold: { increment: reward.gold },
      xp: { increment: reward.xp },
    },
  });
  await prisma.breachDamageEvent.create({
    data: {
      userId,
      bossId: boss.id,
      workoutId: null,
      damage: 0,
      bossHpAfter: 0,
      matchType: 'kill',
    },
  });

  // Pet combat XP — boss kill. Awards full XP if the pet was
  // deployed and survived; posthumous XP if it fainted mid-fight
  // (proportional to lastFaintProgress). No XP if the pet wasn't
  // deployed or wasn't combat-eligible. Also applies HP loss to
  // the pet (cumulative across encounters).
  const petForCombat = await getDeployedCombatPet(userId);
  if (petForCombat) {
    if (petForCombat.level >= 15) {
      const maxHp = maxHpForLevel(petForCombat.level, petForCombat.breed.baseHp);
      await applyCombatPetOutcome(prisma, userId, {
        xpAmount: PET_XP_PER_BOSS_KILL,
        hpLoss: PET_HP_LOSS_PER_BOSS,
        progressFraction: 1.0,
        maxHp,
      });
    } else if (petForCombat.faintedAt && petForCombat.lastFaintProgress != null) {
      // Pet fainted mid-fight — posthumous credit proportional to
      // boss HP fraction at moment of faint.
      await grantPosthumousPetXp(prisma, userId, PET_XP_PER_BOSS_KILL);
    }
  }

  return reward;
}

// ============================================================
// Death handler — triggered when a user "dies" (HP <= 0 from
// mismatched workouts). The boss doesn't disappear; it returns
// at +25% HP until the user kills it.
// ============================================================

export async function recordDeath(
  userId: string,
  prisma: PrismaClient = defaultPrisma
) {
  const progress = await getOrCreateProgress(userId, prisma);
  if (!progress.currentBossId) return null;
  const boss = await prisma.breachBoss.findUnique({ where: { id: progress.currentBossId } });
  if (!boss) return null;
  const deaths = progress.deaths + 1;
  const mult = Math.min(1 + deaths * REENCOUNTER_HP_MULT_PER_DEATH, REENCOUNTER_HP_MULT_MAX);
  const newHp = Math.round(boss.maxHp * mult);
  const now = new Date();
  await prisma.userBreachProgress.update({
    where: { userId },
    data: {
      status: 'COOLDOWN',
      deaths,
      lastDeathAt: now,
      bossHp: newHp,
    },
  });
  return { deaths, newHp, bossName: boss.name };
}

// Cooldown check: caller calls this before damage to flip the
// user from COOLDOWN back to ACTIVE if 24h has elapsed.
export async function tickCooldown(
  userId: string,
  prisma: PrismaClient = defaultPrisma
) {
  const progress = await getOrCreateProgress(userId, prisma);
  if (progress.status !== 'COOLDOWN' || !progress.lastDeathAt) return;
  const elapsed = Date.now() - progress.lastDeathAt.getTime();
  if (elapsed < 24 * 60 * 60 * 1000) return;
  await prisma.userBreachProgress.update({
    where: { userId },
    data: { status: 'ACTIVE' },
  });
}

// ============================================================
// Helpers
// ============================================================

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function todayKey(tz: string | null): string {
  // Today's date in the user's tz — was previously server-local
  // (UTC in Docker), so a NYC user who deals damage at 11pm EDT
  // (= 03:00 UTC next day) rolled into the next damage-cap day at
  // 7pm local. Now uses the shared localDayKey helper.
  return localDayKey(new Date(), tz);
}
