import { describe, it, expect } from 'vitest';
import { computeRaidDamage } from '../lib/raidDamage.js';

describe('computeRaidDamage', () => {
  const baseWorkout = (overrides: any = {}) => ({
    type: 'STRENGTH' as const,
    durationMin: 60,
    exercises: [
      {
        name: 'Bench',
        sets: [
          { reps: 5, weight: 100, duration: null, rpe: 8, completed: true },
          { reps: 5, weight: 100, duration: null, rpe: 8, completed: true },
          { reps: 5, weight: 100, duration: null, rpe: 8, completed: true },
        ],
      },
    ],
    ...overrides,
  });

  it('returns 0 for empty workout', () => {
    const result = computeRaidDamage(
      { type: 'STRENGTH', durationMin: 0, exercises: [] },
      'JUGGERNAUT',
    );
    expect(result.total).toBe(0);
  });

  it('returns 0 for class = null (no class assigned)', () => {
    const result = computeRaidDamage(baseWorkout(), null);
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  it('JUGGERNAUT applies 1.0× multiplier (raw, consistent damage)', () => {
    // Run multiple times to average out crits/evades (JUGGERNAUT has none)
    let sum = 0;
    for (let i = 0; i < 100; i++) {
      const result = computeRaidDamage(baseWorkout(), 'JUGGERNAUT');
      sum += result.total;
    }
    const avg = sum / 100;
    // Expected: 3 sets × (5×1 + 100×5×0.08) = 3 × 45 = 135, then ×1.0
    expect(avg).toBeCloseTo(135, 0);
  });

  it('BERSERKER has lower base but crits give 1.75×', () => {
    let critCount = 0;
    for (let i = 0; i < 100; i++) {
      const result = computeRaidDamage(baseWorkout(), 'BERSERKER');
      critCount += result.crit;
    }
    // 3 sets × 100 runs × 15% crit chance = ~45 crits expected
    expect(critCount).toBeGreaterThan(20);
    expect(critCount).toBeLessThan(80);
  });

  it('PHANTOM has evade chance and no crits', () => {
    let evadeCount = 0;
    for (let i = 0; i < 100; i++) {
      const result = computeRaidDamage(baseWorkout(), 'PHANTOM');
      evadeCount += result.evade;
    }
    // 3 sets × 100 runs × 12% evade chance = ~36 evades expected
    expect(evadeCount).toBeGreaterThan(15);
    expect(evadeCount).toBeLessThan(70);
  });

  it('SCOUT gets a discovery bonus from duration', () => {
    const shortWorkout = baseWorkout({ durationMin: 0 });
    const longWorkout = baseWorkout({ durationMin: 90 });
    let shortSum = 0;
    let longSum = 0;
    for (let i = 0; i < 50; i++) {
      shortSum += computeRaidDamage(shortWorkout, 'SCOUT').total;
      longSum += computeRaidDamage(longWorkout, 'SCOUT').total;
    }
    expect(longSum).toBeGreaterThan(shortSum);
  });

  it('ORACLE generates shield equal to 25% of damage dealt', () => {
    let shield = 0;
    let total = 0;
    for (let i = 0; i < 50; i++) {
      const result = computeRaidDamage(baseWorkout(), 'ORACLE');
      shield += result.shield;
      total += result.total;
    }
    // shield should be ~25% of total
    const ratio = shield / total;
    expect(ratio).toBeCloseTo(0.25, 1);
  });

  it('caps per-workout damage at 5000', () => {
    const huge = baseWorkout({
      exercises: Array.from({ length: 20 }, () => ({
        name: 'Heavy',
        sets: Array.from({ length: 10 }, () => ({
          reps: 10,
          weight: 200,
          duration: null,
          rpe: 10,
          completed: true,
        })),
      })),
    });
    const result = computeRaidDamage(huge, 'JUGGERNAUT');
    expect(result.total).toBeLessThanOrEqual(5000);
  });

  it('reports the correct ability tag per class', () => {
    expect(computeRaidDamage(baseWorkout(), 'JUGGERNAUT').ability).toBe('+DMG');
    expect(computeRaidDamage(baseWorkout(), 'BERSERKER').ability).toBe('+CRIT');
    expect(computeRaidDamage(baseWorkout(), 'PHANTOM').ability).toBe('+EVA');
    expect(computeRaidDamage(baseWorkout(), 'SCOUT').ability).toBe('+DISC');
    expect(computeRaidDamage(baseWorkout(), 'ORACLE').ability).toBe('+HEAL');
  });
});
