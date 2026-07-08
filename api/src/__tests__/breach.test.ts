import { describe, expect, it } from 'vitest';
import {
  bossHpForDifficulty,
  classifyWorkout,
  damageForMatch,
  rewardForKill,
  BASE_MATCHED_DAMAGE,
  BASE_MISMATCHED_DAMAGE,
  BASE_BONUS_DAMAGE,
  DAILY_DAMAGE_CAP_RATIO,
  REENCOUNTER_HP_MULT_PER_DEATH,
  REENCOUNTER_HP_MULT_MAX,
  RECENT_BOSS_MEMORY,
  BREACH_UNLOCK_LEVEL,
  XP_PER_MATCHED_DAMAGE_UNIT,
  SHIELD_TIER_DMG_MULT,
} from '../lib/breach';

describe('bossHpForDifficulty', () => {
  it('returns expected HP per star', () => {
    expect(bossHpForDifficulty('ONE')).toBe(500);
    expect(bossHpForDifficulty('TWO')).toBe(800);
    expect(bossHpForDifficulty('THREE')).toBe(1200);
    expect(bossHpForDifficulty('FOUR')).toBe(1800);
    expect(bossHpForDifficulty('FIVE')).toBe(2500);
  });
  it('falls back to 1000 for unknown difficulty', () => {
    expect(bossHpForDifficulty('SIX')).toBe(1000);
    expect(bossHpForDifficulty('')).toBe(1000);
  });
});

describe('classifyWorkout', () => {
  it('maps bench press to push tags', () => {
    const c = classifyWorkout({ type: 'STRENGTH', exercises: [{ name: 'Bench Press' }] });
    expect(c.hitTags).toEqual(expect.arrayContaining(['push', 'chest', 'triceps']));
  });
  it('maps squats to legs/heavy_compound', () => {
    const c = classifyWorkout({ type: 'STRENGTH', exercises: [{ name: 'Squat' }] });
    expect(c.hitTags).toEqual(expect.arrayContaining(['legs', 'heavy_compound', 'push']));
  });
  it('maps pullups to back/biceps/pull/bodyweight', () => {
    const c = classifyWorkout({ type: 'CALISTHENICS', exercises: [{ name: 'Pullup' }] });
    expect(c.hitTags).toEqual(expect.arrayContaining(['pull', 'back', 'biceps', 'bodyweight']));
  });
  it('falls back to type defaults when exercise unknown', () => {
    const c = classifyWorkout({ type: 'CARDIO', exercises: [{ name: 'Mystery Exercise' }] });
    expect(c.hitTags).toEqual(expect.arrayContaining(['cardio', 'endurance']));
  });
  it('matches by partial name', () => {
    const c = classifyWorkout({ type: 'STRENGTH', exercises: [{ name: 'Incline Bench Press' }] });
    expect(c.hitTags).toEqual(expect.arrayContaining(['push', 'chest']));
  });
});

describe('damageForMatch', () => {
  it('deals full base damage on a single matched tag', () => {
    const r = damageForMatch({ hitTags: ['push'], preferredTags: ['push'] });
    expect(r.delta).toBe(BASE_MATCHED_DAMAGE);
    expect(r.matchType).toBe('partial');
  });
  it('deals bonus damage on 2+ matched tags', () => {
    const r = damageForMatch({ hitTags: ['push', 'chest'], preferredTags: ['push', 'chest'] });
    expect(r.delta).toBe(Math.round(BASE_MATCHED_DAMAGE * 1.5));
    expect(r.matchType).toBe('matched');
  });
  it('adds bonus-tag damage on top', () => {
    const r = damageForMatch({
      hitTags: ['push', 'tabata'],
      preferredTags: ['push'],
      bonusTags: ['tabata'],
    });
    expect(r.delta).toBe(BASE_MATCHED_DAMAGE + BASE_BONUS_DAMAGE);
    expect(r.matchType).toBe('bonus');
  });
  it('deals a small chip of damage on mismatched workout (was: heal)', () => {
    const r = damageForMatch({ hitTags: ['cardio'], preferredTags: ['push'] });
    expect(r.delta).toBe(BASE_MISMATCHED_DAMAGE);
    expect(r.delta).toBeGreaterThan(0);
    expect(r.matchType).toBe('mismatched');
  });
  it('caps volume bonus at 50%', () => {
    const tiny = damageForMatch({ hitTags: ['push'], preferredTags: ['push'], totalVolumeKg: 1000 });
    const huge = damageForMatch({ hitTags: ['push'], preferredTags: ['push'], totalVolumeKg: 100000 });
    expect(huge.delta / tiny.delta).toBeLessThanOrEqual(1.501);
  });
});

describe('damageForMatch edge cases', () => {
  it('handles empty hit tags', () => {
    const r = damageForMatch({ hitTags: [], preferredTags: ['push'] });
    expect(r.delta).toBe(BASE_MISMATCHED_DAMAGE);
  });
  it('handles empty preferred tags (always mismatched, still positive damage)', () => {
    const r = damageForMatch({ hitTags: ['push', 'chest'], preferredTags: [] });
    expect(r.delta).toBeGreaterThan(0);
  });
});

describe('rewardForKill', () => {
  it('MINOR tier rewards 10-25 gold, 1 soulstone', () => {
    const r = rewardForKill({ tier: 'MINOR', maxHp: 500 }, 5);
    expect(r.gold).toBeGreaterThanOrEqual(10);
    expect(r.gold).toBeLessThanOrEqual(25);
    expect(r.soulstones).toBe(1);
    expect(r.itemTier).toBe('COMMON');
    expect(r.itemDropChance).toBe(0.30);
  });
  it('ELITE tier guarantees a COMMON item', () => {
    const r = rewardForKill({ tier: 'ELITE', maxHp: 1200 }, 10);
    expect(r.itemTier).toBe('COMMON');
    expect(r.itemDropChance).toBe(1.0);
  });
  it('LEGENDARY tier rolls RARE', () => {
    const r = rewardForKill({ tier: 'LEGENDARY', maxHp: 1800 }, 20);
    expect(r.itemTier).toBe('RARE');
  });
  it('APEX tier rolls EPIC and pays big', () => {
    const r = rewardForKill({ tier: 'APEX', maxHp: 2500 }, 50);
    expect(r.itemTier).toBe('EPIC');
    expect(r.gold).toBeGreaterThanOrEqual(100);
    expect(r.soulstones).toBeGreaterThanOrEqual(8);
  });
  it('XP scales with user level + tier multiplier', () => {
    const lowLevel = rewardForKill({ tier: 'LEGENDARY', maxHp: 1800 }, 5);
    const highLevel = rewardForKill({ tier: 'LEGENDARY', maxHp: 1800 }, 50);
    expect(highLevel.xp).toBeGreaterThan(lowLevel.xp);
  });
});

describe('breach constants', () => {
  it('unlock level is 10', () => {
    expect(BREACH_UNLOCK_LEVEL).toBe(10);
  });
  it('daily damage cap is 1.5x boss HP', () => {
    expect(DAILY_DAMAGE_CAP_RATIO).toBe(1.5);
  });
  it('re-encounter caps at 2x HP', () => {
    expect(REENCOUNTER_HP_MULT_PER_DEATH).toBe(0.25);
    expect(REENCOUNTER_HP_MULT_MAX).toBe(2.0);
  });
  it('recent boss memory is 10', () => {
    expect(RECENT_BOSS_MEMORY).toBe(10);
  });
  it('XP per damage unit is reasonable', () => {
    expect(XP_PER_MATCHED_DAMAGE_UNIT).toBeGreaterThan(0);
    expect(XP_PER_MATCHED_DAMAGE_UNIT).toBeLessThan(1);
  });
});

describe('SHIELD_TIER_DMG_MULT — world-boss damage scaling (item 6)', () => {
  // Item 6: lift the home-base shield-tier damage multiplier out
  // of breach.ts so the manual world-boss endpoint can apply the
  // same scaling the workout-driven path uses. Without it the
  // manual endpoint and the workout path disagreed on effective
  // damage for any non-STABLE tier — a BREACHED user tapping
  // a boss got the workout path's 2× but the manual endpoint's
  // 1×. The multipliers below are the contract.

  it('is exported (so routes/bosses.ts can import it without re-deriving)', () => {
    expect(typeof SHIELD_TIER_DMG_MULT).toBe('object');
    expect(SHIELD_TIER_DMG_MULT).not.toBeNull();
  });

  it('FORTIFIED halves damage', () => {
    expect(SHIELD_TIER_DMG_MULT.FORTIFIED).toBe(0.5);
  });

  it('STABLE is the 1.0× baseline', () => {
    expect(SHIELD_TIER_DMG_MULT.STABLE).toBe(1.0);
  });

  it('BREACHED doubles damage', () => {
    expect(SHIELD_TIER_DMG_MULT.BREACHED).toBe(2.0);
  });

  it('COMPROMISED bumps slightly (1.25×)', () => {
    expect(SHIELD_TIER_DMG_MULT.COMPROMISED).toBe(1.25);
  });

  it('the full {FORTIFIED, STABLE, COMPROMISED, BREACHED} set is defined', () => {
    // Lock the complete set so a future tier rename can't
    // silently lose a multiplier — the manual endpoint falls
    // back to 1.0 when the lookup misses, so a missing tier
    // would silently flatten damage.
    const keys = Object.keys(SHIELD_TIER_DMG_MULT).sort();
    expect(keys).toEqual(['BREACHED', 'COMPROMISED', 'FORTIFIED', 'STABLE']);
  });
});

describe('manual world-boss damage — shield-tier scaling applied before the 25% per-request cap', () => {
  // Item 6 regression: a BREACHED user with a 2× multiplier
  // tapping a boss for a number that would normally sit below
  // the 25% cap must see exactly 2× the post-class-mult damage,
  // THEN clamp to the 25% ceiling. FORTIFIED (0.5×) cuts in
  // half but NEVER produces a negative hit. A non-shield user
  // (no HomeBase row) defaults to STABLE 1.0× — same as the
  // pre-fix behaviour for the common case.
  //
  // The endpoint drives these via `routes/bosses.ts`. We exercise
  // the math directly (the same multiplication + cap sequence
  // the route uses) to keep the test free of fastify wiring +
  // prisma transactions.

  function applyShieldAndCap(opts: {
    bodyDamage: number;
    classMult: number;
    shieldMult: number;
    bossMaxHp: number;
  }): { scaledDamage: number; cappedDamage: number } {
    const scaledDamage = Math.floor(opts.bodyDamage * opts.classMult * opts.shieldMult);
    const maxPerRequest = Math.max(1, Math.floor(opts.bossMaxHp * 0.25));
    return { scaledDamage, cappedDamage: Math.min(scaledDamage, maxPerRequest) };
  }

  it('FORTIFIED (0.5×) halves damage; 25% cap still applies', () => {
    // 200 dmg × 1.0 class × 0.5 shield = 100 scaled
    // 1000 maxHp × 0.25 = 250 cap → cap not triggered → 100
    const shieldMult = SHIELD_TIER_DMG_MULT.FORTIFIED ?? 1.0;
    const r = applyShieldAndCap({
      bodyDamage: 200, classMult: 1.0, shieldMult, bossMaxHp: 1000,
    });
    expect(r.scaledDamage).toBe(100);
    expect(r.cappedDamage).toBe(100);
  });

  it('BREACHED (2.0×) doubles damage, but the 25% per-request cap still applies AFTER the multiplier', () => {
    // 5000 dmg × 1.0 class × 2.0 shield = 10000 scaled
    // 1000 maxHp × 0.25 = 250 cap → applied post-mult → 250
    // (This is the precise regression the audit was worried
    //  about — a BREACHED user could otherwise dump >10000 dmg
    //  on one tap if the order were wrong.)
    const shieldMult = SHIELD_TIER_DMG_MULT.BREACHED ?? 1.0;
    const r = applyShieldAndCap({
      bodyDamage: 5000, classMult: 1.0, shieldMult, bossMaxHp: 1000,
    });
    expect(r.scaledDamage).toBe(10000);
    expect(r.cappedDamage).toBe(250);
  });

  it('STABLE (no HomeBase row → 1.0×) acts as the baseline and matches pre-fix behaviour', () => {
    const r = applyShieldAndCap({
      bodyDamage: 200, classMult: 1.2, shieldMult: 1.0, bossMaxHp: 1000,
    });
    // 200 × 1.2 = 240; cap is 250; 240 < 250 → 240 not capped
    expect(r.scaledDamage).toBe(240);
    expect(r.cappedDamage).toBe(240);
  });

  it('shield-mult combines multiplicatively with class-mult (BREACHED × Juggernaut)', () => {
    // Juggernaut × 1.2 + BREACHED × 2.0 = × 2.4
    const r = applyShieldAndCap({
      bodyDamage: 100, classMult: 1.2, shieldMult: 2.0, bossMaxHp: 10000,
    });
    expect(r.scaledDamage).toBe(240);
    // 10000 × 0.25 = 2500 cap → not triggered
    expect(r.cappedDamage).toBe(240);
  });

  it('shield-mult ROUNDS DOWN with Math.floor (consistent with int damage column)', () => {
    // 100 × 1.25 = 125 (clean); 101 × 1.25 = 126.25 → 126 after floor
    const a = applyShieldAndCap({
      bodyDamage: 100, classMult: 1.0, shieldMult: 1.25, bossMaxHp: 10000,
    });
    const b = applyShieldAndCap({
      bodyDamage: 101, classMult: 1.0, shieldMult: 1.25, bossMaxHp: 10000,
    });
    expect(a.scaledDamage).toBe(125);
    expect(b.scaledDamage).toBe(126);
  });

  it('floor of 1 HP for tiny boss (cap formula `max(1, floor(maxHp * 0.25))`) so bosses never go uncapped to 0', () => {
    // bossMaxHp = 4 → floor(4 * 0.25) = 1; max(1, 1) = 1 → no over-capping
    const r = applyShieldAndCap({
      bodyDamage: 5, classMult: 1.0, shieldMult: 1.0, bossMaxHp: 4,
    });
    expect(r.cappedDamage).toBe(1);
  });
});
