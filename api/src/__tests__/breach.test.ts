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
