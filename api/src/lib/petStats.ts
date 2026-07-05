// =============================================================
// Pet stats helpers.
//
// All pet-derived state — HP, attack, sprite stage, level-up
// thresholds — lives here. The route handlers and (later) the
// combat callers both consume these, so the formulas have a
// single source of truth.
//
// Reference: HANDOFF.md §"Stats" and §"Color variants" in the
// fitquest-sprites repo.
// =============================================================

export const PET_FOOD_GOLD_COST = 50;
export const PET_FOOD_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
export const PET_BREED_BUY_GOLD_COST = 1000;
export const PET_VET_GOLD_PER_LEVEL = 5;

/// Cap on pets per user. Enforced at /shop/buy-pet — returns 409
/// if the user already has this many. The user can release a pet
/// (via /pet/release) to make room. The schema's @@index on
/// userId keeps roster queries fast.
export const MAX_PETS_PER_USER = 6;

/// Combat XP awarded to a deployed, Lv15+ pet on each event.
/// These are the bonuses granted by the combat endpoints
/// (breach.ts / quest.ts / raids.ts). Below Lv15 or fainted
/// or not deployed, the pet gets 0 combat XP.
export const PET_XP_PER_MONSTER_KILL = 3;
export const PET_XP_PER_BOSS_KILL = 15;
export const PET_XP_PER_QUEST_LEVEL_CLEAR = 8;
export const PET_XP_PER_RAID_BOSS_KILL = 10;

/// HP the pet loses per combat event. Below 0 → faint.
export const PET_HP_LOSS_PER_MONSTER = 5;
export const PET_HP_LOSS_PER_BOSS = 20;

// =============================================================
// Combat XP + HP application.
//
// The combat endpoints (breach / quest / raid) call this helper
// at the moment of each kill event. It checks the pet's deploy
// status + combat eligibility and applies XP / HP loss / faint.
//
// XP gate: only when `deployed && level >= 15 && !faintedAt`.
// HP loss: -5 per monster, -20 per boss (cumulative, persisted on
//   PetInstance.hpAfterCombat).
// Faint: HP hits ≤ 0 OR `forceFaint` true (draw/loss on boss).
//   On faint, set deployed=false, snapshot boss progress (0-1) to
//   lastFaintProgress, set faintedAt, set injuredAt (sprite stage).
// Posthumous XP: call `grantPosthumousPetXp(userId, fullReward)`
//   after the boss is killed. Returns the XP awarded (0 if no
//   posthumous credit applies).
// =============================================================

type CombatTx = any; // Prisma transaction client

export type CombatPetResult =
  | { applied: false; reason: 'no_pet' | 'ineligible' | 'fainted' | 'not_deployed' }
  | { applied: true; xpAwarded: number; hpAfter: number; faintedThisStep: boolean };

/**
 * Apply combat XP + HP to a pet after a single kill event.
 * Pass `progressFraction` (0..1) for faint-snapshot bookkeeping.
 * Pass `forceFaint: true` for draw/loss events that faint the
 * pet regardless of HP. The caller passes `maxHp` (computed via
 * maxHpForLevel outside the transaction) so we can interpret
 * `hpAfterCombat = -1` ("never been in combat") as full HP.
 */
export async function applyCombatPetOutcome(
  tx: CombatTx,
  userId: string,
  opts: {
    xpAmount: number;
    hpLoss: number;
    progressFraction: number; // boss HP fraction lost at this moment
    maxHp: number;
    forceFaint?: boolean;
  },
): Promise<CombatPetResult> {
  const pet = await tx.petInstance.findUnique({ where: { userId } });
  if (!pet) return { applied: false, reason: 'no_pet' };
  if (!pet.deployed) return { applied: false, reason: 'not_deployed' };
  if (pet.level < 15) return { applied: false, reason: 'ineligible' };
  if (pet.faintedAt) return { applied: false, reason: 'fainted' };

  // Apply XP via the standard level-up loop.
  const newXp = pet.xp + opts.xpAmount;
  let newLevel = pet.level;
  let evolvedAt = pet.evolvedAt;
  let armoredAt = pet.armoredAt;
  while (leveledUp(newXp, newLevel)) {
    newLevel += 1;
    if (newLevel === 5 && !evolvedAt) evolvedAt = new Date();
    if (newLevel === 15 && !armoredAt) armoredAt = new Date();
  }

  // Apply HP loss. hpAfterCombat=-1 means "never been in combat,
  // full HP implied" → start from maxHp. Otherwise start from the
  // stored value (which the caller/serializer keeps in sync).
  let hpAfter = pet.hpAfterCombat < 0 ? opts.maxHp : pet.hpAfterCombat;
  hpAfter = Math.max(0, hpAfter - opts.hpLoss);

  // Determine faint. Either HP hit 0 or the encounter force-fainted.
  const willFaint = opts.forceFaint || hpAfter <= 0;
  const now = new Date();

  // If faint, capture the encounter progress snapshot for posthumous
  // XP. Cap progress to [0, 1] for safety.
  const snapshot = Math.max(0, Math.min(1, opts.progressFraction));

  const update: any = {
    xp: newXp,
    level: newLevel,
    hpAfterCombat: willFaint ? 0 : hpAfter,
    ...(evolvedAt && !pet.evolvedAt ? { evolvedAt } : {}),
    ...(armoredAt && !pet.armoredAt ? { armoredAt } : {}),
  };
  if (willFaint) {
    update.faintedAt = now;
    update.injuredAt = now;
    update.deployed = false; // immediate removal from combat
    update.lastFaintProgress = snapshot;
  }

  await tx.petInstance.update({ where: { id: pet.id }, data: update });

  return {
    applied: true,
    xpAwarded: opts.xpAmount,
    hpAfter,
    faintedThisStep: willFaint,
  };
}

/**
 * Find the user's currently-deployed combat pet (at most one).
 * Returns null if no pet is deployed, no pet exists, or the pet is
 * fainted / below Lv15. The combat endpoints call this before
 * granting pet XP — keeps the eligibility check in one place.
 */
export async function getDeployedCombatPet(userId: string) {
  const { prisma } = await import('./prisma.js');
  return prisma.petInstance.findFirst({
    where: { userId, deployed: true, faintedAt: null },
    include: { breed: true },
  });
}

/**
 * XP-only combat grant (no HP loss, no faint). Used for events
 * where the pet earns XP but isn't exposed to danger — e.g.
 * completing a non-boss quest level. Same XP gate as
 * applyCombatPetOutcome.
 */
export async function applyCombatPetXp(
  tx: CombatTx,
  userId: string,
  xpAmount: number,
): Promise<{ applied: boolean; xpAwarded: number }> {
  const pet = await tx.petInstance.findUnique({ where: { userId } });
  if (!pet) return { applied: false, xpAwarded: 0 };
  if (!pet.deployed) return { applied: false, xpAwarded: 0 };
  if (pet.level < 15) return { applied: false, xpAwarded: 0 };
  if (pet.faintedAt) return { applied: false, xpAwarded: 0 };

  const newXp = pet.xp + xpAmount;
  let newLevel = pet.level;
  let evolvedAt = pet.evolvedAt;
  let armoredAt = pet.armoredAt;
  while (leveledUp(newXp, newLevel)) {
    newLevel += 1;
    if (newLevel === 5 && !evolvedAt) evolvedAt = new Date();
    if (newLevel === 15 && !armoredAt) armoredAt = new Date();
  }
  await tx.petInstance.update({
    where: { id: pet.id },
    data: {
      xp: newXp,
      level: newLevel,
      ...(evolvedAt && !pet.evolvedAt ? { evolvedAt } : {}),
      ...(armoredAt && !pet.armoredAt ? { armoredAt } : {}),
    },
  });
  return { applied: true, xpAwarded: xpAmount };
}

/**
 * Grant posthumous XP to a pet that fainted mid-encounter. The
 * caller passes the full XP reward (e.g. 15 for boss kill) and
 * the pet gets `lastFaintProgress × fullXp` rounded down. Also
 * clears `lastFaintProgress` so it doesn't double-count if the
 * caller invokes this twice.
 */
export async function grantPosthumousPetXp(
  tx: CombatTx,
  userId: string,
  fullXpReward: number,
): Promise<{ awarded: number; reason: 'no_pet' | 'no_progress_snapshot' | 'already_revived' }> {
  const pet = await tx.petInstance.findUnique({ where: { userId } });
  if (!pet) return { awarded: 0, reason: 'no_pet' };
  if (!pet.faintedAt) return { awarded: 0, reason: 'already_revived' };
  if (pet.lastFaintProgress == null) return { awarded: 0, reason: 'no_progress_snapshot' };
  const awarded = Math.floor(pet.lastFaintProgress * fullXpReward);
  if (awarded <= 0) {
    // Just clear the snapshot — no XP to award.
    await tx.petInstance.update({
      where: { id: pet.id },
      data: { lastFaintProgress: null },
    });
    return { awarded: 0, reason: 'no_progress_snapshot' };
  }
  const newXp = pet.xp + awarded;
  let newLevel = pet.level;
  let evolvedAt = pet.evolvedAt;
  let armoredAt = pet.armoredAt;
  while (leveledUp(newXp, newLevel)) {
    newLevel += 1;
    if (newLevel === 5 && !evolvedAt) evolvedAt = new Date();
    if (newLevel === 15 && !armoredAt) armoredAt = new Date();
  }
  await tx.petInstance.update({
    where: { id: pet.id },
    data: {
      xp: newXp,
      level: newLevel,
      lastFaintProgress: null,
      ...(evolvedAt && !pet.evolvedAt ? { evolvedAt } : {}),
      ...(armoredAt && !pet.armoredAt ? { armoredAt } : {}),
    },
  });
  return { awarded, reason: 'already_revived' };
}

/** hp at level 1 = baseHp (50 puppy). Hops to baseHp*2 once evolved. */
export function maxHpForLevel(level: number, baseHp: number): number {
  if (level >= 5) return baseHp * 2;
  return baseHp;
}

/** attack = baseAttack + level * 2, clamped to baseAttack at L1. */
export function attackForLevel(level: number, baseAttack: number): number {
  return baseAttack + level * 2;
}

/**
 * Quadratic XP curve: level N requires (N+1)^2 total XP.
 * So xpToNextLevel at level N = (N+1)^2 - (N^2 + current_xp_in_level).
 * The current call site passes `xp` as total XP, so:
 *   xpToNextLevel = (level+1)^2 - xp
 */
export function xpToNextLevel(level: number, xp: number): number {
  const target = (level + 1) * (level + 1);
  return Math.max(0, target - xp);
}

/**
 * Returns the sprite stage name for a pet, given the lifecycle
 * timestamps. Order of precedence (most-decorated first):
 *   - injuredAt set                  → "injuredArmored"
 *   - else armoredAt set              → "adultArmored"
 *   - else evolvedAt set              → "adult"
 *   - else                            → "puppy"
 *
 * `injuredAt` clears when the user pays the vet, at which point
 * the pet falls back to its armed/unarmed adult state.
 */
export function spriteStage(pet: {
  evolvedAt: Date | null;
  armoredAt: Date | null;
  injuredAt: Date | null;
}): 'puppy' | 'adult' | 'adultArmored' | 'injuredArmored' {
  if (pet.injuredAt) return 'injuredArmored';
  if (pet.armoredAt) return 'adultArmored';
  if (pet.evolvedAt) return 'adult';
  return 'puppy';
}

/**
 * Web-facing sprite path. Looks like:
 *   /sprites/pets/german-shepherd-puppy-black-tan.png
 * Caller passes the breed (for base path + variant suffix).
 *
 * The path is RELATIVE to web/public/, which is how vite serves
 * static assets; the frontend can prepend WEB_BASE as needed.
 */
export function spritePath(
  breed: { spriteBasePath: string },
  stage: 'puppy' | 'adult' | 'adultArmored' | 'injuredArmored',
  colorVariant: string,
): string {
  return `/sprites/pets/${breed.spriteBasePath}-${stage}-${colorVariant}.png`;
}

/**
 * Returns whether the pet has crossed a level-up threshold since
 * the last call. Callers should loop this until it returns false,
 * applying each level-up side-effect (set evolvedAt at L5, etc).
 *
 * `xp` here is the total XP the pet has after the increment.
 * `level` is the pet's CURRENT level (before any updates).
 */
export function leveledUp(xp: number, level: number): boolean {
  const required = (level + 1) * (level + 1);
  return xp >= required;
}

/**
 * Cost for the vet to revive a fainted pet. Per HANDOFF:
 *   cost = 10 + 5 * level
 */
export function vetCostGold(level: number): number {
  return 10 + PET_VET_GOLD_PER_LEVEL * level;
}