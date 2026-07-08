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
import { ClassName, prisma as defaultPrisma } from './prisma.js';
import { tierForShield } from './penance.js';

// ============================================================
// Constants
// ============================================================

export const LEAK_COOLDOWN_MS = 24 * 60 * 60 * 1000;       // 24h between leaks
export const LEAK_TTL_MS = 48 * 60 * 60 * 1000;            // 48h soft hint — leaks no longer auto-expire
// Max active leaks a user can have at once. Stacking already works
// (existing active leaks don't block new spawns), but without a
// cap the dashboard's leak card and the leak-queue UI become
// unreadable past ~5. 3 fits the 3-column dashboard grid + the
// "/portal-leak" page's side-by-side layout without overlap.
// Spawn gate: no new leak when active count >= MAX; resumes when
// active count drops to MAX - 1. The MAX - 1 hysteresis avoids a
// thrash loop where killing one leak immediately spawns its
// replacement mid-fight.
export const MAX_ACTIVE_LEAKS = 3;
export const LEAK_RESUME_AT = MAX_ACTIVE_LEAKS - 1;
export const OVERWHELM_CAP_MULT = 1.5;                     // leak feeds up to 150% of maxHp
export const LEAK_BASE_HP_MIN = 80;
export const LEAK_BASE_HP_MAX = 160;
// Breach-themed leaks are slightly tougher so the user feels the
// consequence of clearing the Breach world.
export const BREACH_LEAK_HP_MIN = 120;
export const BREACH_LEAK_HP_MAX = 200;
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
    name: 'The Gains Goblin',
    emoji: '✦',
    color: '#84cc16',
    intro: 'A small, cackling green thing that hovers near your equipment rack. It only wants one thing: gains. It will not stop until you have more of them than yesterday. If you beat it, it drops a small piece of loot. If it beats you, it steals a single stat point and laughs. The lore says it cannot be killed — only out-trained. The lore is wrong.',
    preferredTags: ['chest', 'bicep', 'tricep', 'shoulder'],
    bonusTags: ['PR', 'BODY_COMP'],
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

// Keyed record (not Record<string, ...>) so .low/.mid/.high are
// known-present; entries are [rarityName, weight] pairs.
const RARITY_WEIGHTS: Record<'low' | 'mid' | 'high', [string, number][]> = {
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
  // `!`: every RARITY_WEIGHTS tier is a non-empty literal array.
  return weights[0]![0];
}

// Drop-table filter helper. When `classFilter` is provided, restricts
// the candidate pool to items whose `classRestriction` matches (or
// whose classRestriction is null = universal). Used by the world →
// loot mapping: Glade drops Phantom gear, Spire drops Juggernaut
// gear, etc. NEUTRAL worlds / ANY-affinity bosses pass null so the
// pool stays unfiltered.

export function buildItemWhere(rarity: string, classFilter: ClassName | null) {
  const where: any = { rarity: rarity as any };
  if (classFilter) {
    where.OR = [
      { classRestriction: classFilter },
      { classRestriction: null },
    ];
  }
  return where;
}

// Look up the user's most-recently-cleared world level and return
// the class it maps to (so leaks spawned from world activity drop
// themed gear). Returns null when:
//   - user has never cleared a level
//   - the most recent cleared level is in a NEUTRAL world
//   - any lookup error occurs (fail-open: unfiltered drops still work)
async function lastClearedWorldClass(
  userId: string,
  prisma: PrismaClient,
): Promise<ClassName | null> {
  try {
    const recent = await prisma.userWorldProgress.findFirst({
      where: { userId, completed: true },
      orderBy: { updatedAt: 'desc' },
      select: { levelId: true },
    });
    if (!recent) return null;
    // levelId is "worldId-N" — extract the world prefix
    const worldId = recent.levelId.split('-')[0] ?? '';
    if (!worldId) return null;
    const { classForWorld } = await import('./worlds.js');
    return classForWorld(worldId);
  } catch {
    return null;
  }
}

// ============================================================
// Spawn check — called after every penance fire. Rolls the dice
// based on shield tier. Leaks STACK: the user can have multiple
// active leaks at once if they've been slipping. The 24h cooldown
// is on a per-resolved-leak basis — if the user just resolved a
// leak, no new ones spawn for 24h. But existing active leaks stay
// active and queued.
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

  // Cooldown: no spawn within 24h of the last resolved leak.
  // Existing active leaks do NOT short-circuit — they stack, up
  // to MAX_ACTIVE_LEAKS. When the cap is hit, no new spawns until
  // the user resolves enough leaks to drop below LEAK_RESUME_AT.
  // Hysteresis at MAX - 1 prevents thrash (kill one, spawn one
  // mid-fight, etc.).
  const cooldownCutoff = new Date(Date.now() - LEAK_COOLDOWN_MS);
  const recent = await prisma.portalLeak.findFirst({
    where: {
      userId,
      status: { in: ['DEFEATED', 'OVERWHELMED'] },
      resolvedAt: { gte: cooldownCutoff },
    },
    orderBy: { resolvedAt: 'desc' },
  });
  if (recent) return { spawned: false };

  // Cap: count currently-active leaks. Skip spawn when at cap.
  // Resumes when count drops to LEAK_RESUME_AT (currently 2).
  const activeCount = await prisma.portalLeak.count({
    where: { userId, status: 'ACTIVE' },
  });
  if (activeCount >= MAX_ACTIVE_LEAKS) return { spawned: false };

// Spawn!
  // `!`: floor(random * length) is always in-bounds for the
  // non-empty LEAK_MONSTERS literal.
  const monster = LEAK_MONSTERS[Math.floor(Math.random() * LEAK_MONSTERS.length)]!;
  const maxHp = Math.floor(
    LEAK_BASE_HP_MIN + Math.random() * (LEAK_BASE_HP_MAX - LEAK_BASE_HP_MIN)
  );
  const lootRarity = rollLootRarity((await prisma.user.findUnique({ where: { id: userId }, select: { level: true } }))?.level ?? 1);

  // World-themed drop: pull the user's most-recently-cleared world
  // level and pick an item from that world's class. If the user has
  // never cleared a world level (or the most recent one is NEUTRAL),
  // classFilter is null and the pool stays unfiltered.
  const classFilter = await lastClearedWorldClass(userId, prisma);

  // Find an item of that rarity to drop. If none exist, fall
  // back to a lower rarity so the user always gets something.
  const item = await pickItemOfRarity(prisma, lootRarity, classFilter);

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
  // Notify the user — a new leak in the home-base queue is a
  // "stop what you're doing and deal with this" signal, the
  // inverse of a shield_repair digest. Fire-and-forget; a
  // failed emit must not roll back the leak spawn.
  try {
    const { emitNotification } = await import('./notify.js');
    await emitNotification({
      userId,
      category: 'PENANCE',
      kind: 'leak_spawn',
      title: `Leak spawned: ${monster.name}`,
      body: `A ${monster.name.toLowerCase()} tore through at ${maxHp} HP. Match its preferred tags to damage it.`,
      link: '/homebase',
      payload: {
        leakId: leak.id,
        monsterName: monster.name,
        monsterEmoji: monster.emoji,
        hp: maxHp,
        maxHp,
        worldSource: 'AMBIENT',
      },
    });
  } catch (err) {
    console.warn('[portalLeaks] leak_spawn emit failed', { userId, err });
  }
  return { spawned: true, leakId: leak.id };
}

// Breach-themed leaks. The monster pool is the same LEAK_MONSTERS
// (random cosmic horror vibes), but the worldSource field on the
// leak row is set to 'BREACH' so the UI can highlight them. These
// are spawned when the user defeats the Maw — the Breach world
// "bleeds" into the homebase defense loop.
export async function maybeSpawnBreachLeak(
  userId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<{ spawned: boolean; leakId?: string }> {
  // Stacking applies to breach leaks too — only skip spawn when the
  // user is already at MAX_ACTIVE_LEAKS. Resumes when count drops
  // to LEAK_RESUME_AT. The old "block on any active" behaviour
  // made breach clears feel unrewarded (defeating the Maw
  // sometimes produced no leak because the user had a leftover).
  const activeCount = await prisma.portalLeak.count({
    where: { userId, status: 'ACTIVE' },
  });
  if (activeCount >= MAX_ACTIVE_LEAKS) return { spawned: false };

  // `!`: floor(random * length) is always in-bounds for the
  // non-empty LEAK_MONSTERS literal.
  const monster = LEAK_MONSTERS[Math.floor(Math.random() * LEAK_MONSTERS.length)]!;
  // Breach leaks are slightly tougher (taller HP range) so the
  // user feels the consequence of clearing the Breach world.
  const maxHp = Math.floor(
    BREACH_LEAK_HP_MIN + Math.random() * (BREACH_LEAK_HP_MAX - BREACH_LEAK_HP_MIN)
  );
  const lootRarity = rollLootRarity((await prisma.user.findUnique({ where: { id: userId }, select: { level: true } }))?.level ?? 1);
  // Breach is NEUTRAL — classForWorld('breach') returns null so the
  // pool stays unfiltered (drops universal + any-class gear).
  const item = await pickItemOfRarity(prisma, lootRarity, null);

  const leak = await prisma.portalLeak.create({
    data: {
      userId,
      monsterName: monster.name,
      monsterEmoji: monster.emoji,
      monsterColor: monster.color,
      intro: `${monster.intro} It came out of the Breach when the Maw was beaten.`,
      preferredTags: monster.preferredTags,
      bonusTags: monster.bonusTags,
      hp: maxHp,
      maxHp,
      itemDrop: item?.id ?? null,
      worldSource: 'BREACH',
    },
  });
  // Breach-sourced leak — same fire-and-forget notification as
  // the ambient spawn path, with `worldSource: 'BREACH'` so the
  // inbox row can be highlighted differently in future UI work.
  try {
    const { emitNotification } = await import('./notify.js');
    await emitNotification({
      userId,
      category: 'PENANCE',
      kind: 'leak_spawn',
      title: `Breach leak: ${monster.name}`,
      body: `Defeating the Maw tore a ${monster.name.toLowerCase()} loose at ${maxHp} HP.`,
      link: '/homebase',
      payload: {
        leakId: leak.id,
        monsterName: monster.name,
        monsterEmoji: monster.emoji,
        hp: maxHp,
        maxHp,
        worldSource: 'BREACH',
      },
    });
  } catch (err) {
    console.warn('[portalLeaks] breach leak_spawn emit failed', { userId, err });
  }
  return { spawned: true, leakId: leak.id };
}

export async function pickItemOfRarity(
  prisma: PrismaClient,
  rarity: string,
  classFilter?: ClassName | null,
  fallback = 3,
): Promise<{ id: string } | null> {
  for (let i = 0; i < fallback; i++) {
    // LEGENDARY was missing from this walk even though
    // rollLootRarity() can return it at level 20+. indexOf then
    // gave -1 → tiers[-1] === undefined → buildItemWhere built a
    // rarity-less filter and the "legendary" drop was whatever
    // ItemDef row came back first. Unknown rarities now clamp to
    // COMMON instead of undefined.
    const tiers = ['LEGENDARY', 'EPIC', 'RARE', 'UNCOMMON', 'COMMON'];
    const idx = tiers.indexOf(rarity);
    // The min() clamp keeps the index in bounds; `?? 'COMMON'`
    // never fires and matches the documented clamp-to-COMMON intent.
    const targetTier = tiers[Math.min((idx < 0 ? tiers.length - 1 : idx) + i, tiers.length - 1)] ?? 'COMMON';
    const item = await prisma.itemDef.findFirst({
      where: buildItemWhere(targetTier, classFilter ?? null),
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

  // DEFEATED is a high-signal "you sealed it" moment — notify
  // the user so they can come back to /homebase and claim the
  // pre-rolled loot. OVERWHELMED is the opposite (a punishment),
  // also worth surfacing. Other resolutions (no status change)
  // stay silent — the user can see HP in the portal-leak card.
  // Fire-and-forget; a failed emit must not block the damage
  // return.
  if (resolved) {
    try {
      const { emitNotification } = await import('./notify.js');
      if (resolved === 'DEFEATED') {
        await emitNotification({
          userId,
          category: 'PENANCE',
          kind: 'leak_defeated',
          title: `Leak sealed: ${leak.monsterName}`,
          body: 'Visit /homebase to claim your loot.',
          link: '/homebase',
          payload: {
            leakId: leak.id,
            monsterName: leak.monsterName,
            monsterEmoji: leak.monsterEmoji,
            worldSource: leak.worldSource,
          },
        });
      } else {
        // OVERWHELMED
        await emitNotification({
          userId,
          category: 'PENANCE',
          kind: 'leak_overwhelmed',
          title: `Leak overwhelmed your defenses: ${leak.monsterName}`,
          body: 'Shield will need extra repair to recover.',
          link: '/homebase',
          payload: {
            leakId: leak.id,
            monsterName: leak.monsterName,
            monsterEmoji: leak.monsterEmoji,
            worldSource: leak.worldSource,
          },
        });
      }
    } catch (err) {
      console.warn('[portalLeaks] leak resolution emit failed', { userId, leakId: leak.id, err });
    }
  }

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
// Stacking — multiple leaks can be active at once. When the user has
// been slipping, each shield-drop rolls the spawn dice independently
// so the queue grows. The user picks which leak to attack next;
// they all share the same recent-damage feed and the dashboard
// shows them oldest-first as a queue.
// ============================================================

/**
 * All active leaks for a user, oldest first (the natural order
 * to fight them in). Each leak can be attacked + claimed + dismissed
 * independently. The shape change from "single leak" to "array of
 * leaks" is the main API-surface change for the stacking feature.
 */
export async function getLeakForUser(
  userId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<{
  leaks: Array<{
    leak: Awaited<ReturnType<typeof prisma.portalLeak.findFirst>>;
    recent: Awaited<ReturnType<typeof prisma.portalLeakDamageEvent.findMany>>;
  }>;
  recentDamage: Awaited<ReturnType<typeof prisma.portalLeakDamageEvent.findMany>>;
}> {
  const activeLeaks = await prisma.portalLeak.findMany({
    where: { userId, status: 'ACTIVE' },
    orderBy: { spawnedAt: 'asc' },
  });

  if (activeLeaks.length === 0) {
    return { leaks: [], recentDamage: [] };
  }

  // Per-leak recent damage events, then aggregate for the global
  // recent-damage feed. The dashboard's "Last 36h" feed is across
  // all leaks.
  const leakDetails = await Promise.all(
    activeLeaks.map(async (leak) => {
      const recent = await prisma.portalLeakDamageEvent.findMany({
        where: { leakId: leak.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      return { leak, recent };
    }),
  );

  const recentDamage = await prisma.portalLeakDamageEvent.findMany({
    where: { leakId: { in: activeLeaks.map((l) => l.id) } },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });

  return { leaks: leakDetails, recentDamage };
}

// ============================================================
// Daily growth tick — leaks grow +8 HP/day if the user doesn't
// train. Called from the daily cron. If a leak ages past 48h
// without resolution, it's marked EXPIRED (no penalty, just
// the cooldown applies).
// ============================================================

export async function tickLeakGrowth(
  prisma: PrismaClient = defaultPrisma,
): Promise<{ ticked: number }> {
  // Daily growth tick. Previously leaks aged out at 48h via an
  // EXPIRED branch here; that's gone now — leaks stack instead
  // of expiring (user feedback: leaks are the user's punishment
  // for slipping, expiring them softens that). The +8 HP/day
  // escalation already makes neglected leaks worse than fresh
  // ones, which provides a soft self-balancing mechanism. The
  // LEAK_TTL_MS constant is kept as a hint for future UI copy
  // ("leaks grow stronger the longer you ignore them") but no
  // longer drives any logic.
  const activeLeaks = await prisma.portalLeak.findMany({
    where: { status: 'ACTIVE' },
  });

  let ticked = 0;

  for (const leak of activeLeaks) {
    // Daily growth: +8 HP, capped at overwhelm threshold.
    const overwhelmCap = Math.round(leak.maxHp * OVERWHELM_CAP_MULT);
    const newHp = Math.min(overwhelmCap, leak.hp + LEAK_DAILY_GROWTH);
    await prisma.portalLeak.update({
      where: { id: leak.id },
      data: { hp: newHp },
    });
    ticked++;
  }

  return { ticked };
}
