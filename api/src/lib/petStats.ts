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

export const PET_FOOD_GOLD_COST = 10;
export const PET_FOOD_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
export const PET_BREED_BUY_GOLD_COST = 200;
export const PET_VET_GOLD_PER_LEVEL = 5;

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