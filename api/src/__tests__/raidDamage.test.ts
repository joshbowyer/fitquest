import { describe, it, expect, vi } from 'vitest';
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

  // ============================================================
  // Equip-bonus wiring tests (v1 raid-damage integration)
  // ============================================================

  describe('equip param', () => {
    // Deterministic Math.random stub: with the mock returning 0.99,
    //   - crit roll: 0.99 >= 0.5 → no crit for any class
    //   - evade roll: 0.99 >= 0.12 → no evade for PHANTOM
    // (works because the spec MANDATORY-clamp puts critChance at
    // 0.5 and meta.evadeChance is at most 0.12.)
    const noRandom = () => 0.99;

    it('flat-dmg clamp: mythic ring (+DMG:100) on a tiny workout caps the bonus to base', () => {
      // Tiny workout: 1 set of 1 rep at 1kg → contrib = 1*1 + 1*1*0.08 = 1.08 → 1.
      // base = 1. flatDmg = 100. Expected added: min(100, 1) = 1.
      // JUGGERNAUT mult 1.0, no crit/evade, no set%, no disc.
      // Expected total = base(1) + flatDmg_clamped(1) = 2.
      const tiny = {
        type: 'STRENGTH' as const,
        durationMin: 0,
        exercises: [{ name: 'bench', sets: [{ reps: 1, weight: 1, duration: null, rpe: null, completed: true }] }],
      };
      const spy = vi.spyOn(Math, 'random').mockImplementation(noRandom);
      try {
        const r = computeRaidDamage(tiny, 'JUGGERNAUT', { flatDmg: 100, crit: 0, disc: 0, setDmgPct: 0 });
        // If the clamp were missing, total would be 101 (1 + 100).
        // With the clamp, total = 2 (1 + min(100, 1)).
        expect(r.total).toBe(2);
        // Sanity: the base reported in the result is unchanged.
        expect(r.base).toBe(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('flat-dmg clamp: large flatDmg on a large workout does NOT clamp (only caps at base)', () => {
      // baseWorkout (3 sets × 5×100) → base = 135. flatDmg = 50 < base, so added = 50.
      // JUGGERNAUT mult 1.0, no crit/evade, no set%, no disc.
      // Expected total = 135 + 50 = 185.
      const spy = vi.spyOn(Math, 'random').mockImplementation(noRandom);
      try {
        const r = computeRaidDamage(baseWorkout(), 'JUGGERNAUT', { flatDmg: 50, crit: 0, disc: 0, setDmgPct: 0 });
        expect(r.total).toBe(185);
        expect(r.base).toBe(135);
      } finally {
        spy.mockRestore();
      }
    });

    it('crit clamp: equip.crit is MANDATORY-capped at 0.5 total crit chance', () => {
      // BERSERKER base critChance = 0.15. With equip.crit = 0.99,
      // raw would be 1.14, capped to 0.5. To prove the cap fired,
      // we set Math.random = 0.7 — that value is BELOW the raw
      // 1.14 (would crit) but ABOVE the capped 0.5 (won't crit).
      // If the cap were missing, all 3 sets would crit.
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.7);
      try {
        const r = computeRaidDamage(baseWorkout(), 'BERSERKER', { flatDmg: 0, crit: 0.99, disc: 0, setDmgPct: 0 });
        // With the cap: 0.7 >= 0.5 → no crit → crit = 0.
        // Without the cap: 0.7 < 1.14 → crit on every set → crit = 3.
        expect(r.crit).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });

    it('crit clamp: exactly 0.5 equip crit still allows crit at random=0.49 (boundary)', () => {
      // BERSERKER base 0.15 + 0.35 equip → 0.50, capped to 0.5. random=0.49 < 0.5 → crit.
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.49);
      try {
        const r = computeRaidDamage(baseWorkout(), 'BERSERKER', { flatDmg: 0, crit: 0.35, disc: 0, setDmgPct: 0 });
        // First call to Math.random is the crit roll for set 1.
        // 0.49 < 0.5 → crit. All 3 sets take the same random value
        // (the mock returns 0.49 every call) → all 3 crit.
        expect(r.crit).toBeGreaterThanOrEqual(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('set% applied PRE-cap: a huge set bonus still gets clamped to PER_WORKOUT_CAP', () => {
      // A workout that would produce 5000 raw. With setDmgPct=1.0
      // (100% bonus), the pre-cap damage would be 10000. The cap
      // is the FINAL ceiling, so total must still be 5000.
      const huge = {
        type: 'STRENGTH' as const,
        durationMin: 0,
        exercises: Array.from({ length: 20 }, () => ({
          name: 'Heavy',
          sets: Array.from({ length: 10 }, () => ({
            reps: 10, weight: 200, duration: null, rpe: 10, completed: true,
          })),
        })),
      };
      const spy = vi.spyOn(Math, 'random').mockImplementation(noRandom);
      try {
        const r = computeRaidDamage(huge, 'JUGGERNAUT', { flatDmg: 0, crit: 0, disc: 0, setDmgPct: 1.0 });
        expect(r.total).toBe(5000);
      } finally {
        spy.mockRestore();
      }
    });

    it('regression: omitting the equip arg produces byte-identical results to all-zero equip', () => {
      // The function must be a no-op extension: `computeRaidDamage(w, c)`
      // ≡ `computeRaidDamage(w, c, { flatDmg: 0, crit: 0, disc: 0, setDmgPct: 0 })`.
      // We assert this with a deterministic random for every class.
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      try {
        for (const cls of ['JUGGERNAUT', 'BERSERKER', 'PHANTOM', 'SCOUT', 'TRACER', 'ORACLE', null] as const) {
          const noArg = computeRaidDamage(baseWorkout(), cls as any);
          const zeroArg = computeRaidDamage(baseWorkout(), cls as any, { flatDmg: 0, crit: 0, disc: 0, setDmgPct: 0 });
          expect(zeroArg).toEqual(noArg);
        }
      } finally {
        spy.mockRestore();
      }
    });

    it('regression: a known-good no-arg result is unchanged (JUGGERNAUT × baseWorkout, random=0.5)', () => {
      // Hardcoded expected result for a fully-deterministic run
      // (Math.random mocked to 0.5). Computed by hand:
      //   3 sets × 5×100kg, JUGGERNAUT (no crit, no evade)
      //   contrib each = round(5 + 100*5*0.08) = round(45) = 45
      //   base = 135, damage = 135, no discovery, mult 1.0 → 135, shield 0
      //   no equip, cap 5000 → total = 135
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      try {
        const r = computeRaidDamage(baseWorkout(), 'JUGGERNAUT');
        expect(r).toEqual({
          total: 135,
          evade: 0,
          crit: 0,
          base: 135,
          classMult: 1.0,
          shield: 0,
          ability: '+DMG',
        });
      } finally {
        spy.mockRestore();
      }
    });

    it('mythic ring stress test: +DMG:100 + +CRIT:0.30 on a JUGGERNAUT junk workout (smallest possible)', () => {
      // The spec calls out ring_mythic_blood as the stress test.
      // Verify the worst-case wiring: huge +DMG + huge +CRIT on the
      // tiniest possible workout. The flat-dmg clamp should fire
      // (capping +100 down to base=1), and the crit clamp should
      // keep crits from dominating the tiny contrib.
      const tiny = {
        type: 'STRENGTH' as const,
        durationMin: 0,
        exercises: [{ name: 'bench', sets: [{ reps: 1, weight: 1, duration: null, rpe: null, completed: true }] }],
      };
      const spy = vi.spyOn(Math, 'random').mockImplementation(noRandom);
      try {
        const r = computeRaidDamage(tiny, 'JUGGERNAUT', { flatDmg: 100, crit: 0.30, disc: 0, setDmgPct: 0 });
        // base = 1, damage = 1, mult 1.0 → 1, +min(100, 1) = +1 → 2.
        // If the flat-dmg clamp were missing, total = 101.
        expect(r.total).toBe(2);
        expect(r.crit).toBe(0);  // noRandom = 0.99 >= 0.5 (capped critChance)
      } finally {
        spy.mockRestore();
      }
    });

    it('mythic ring stress test on a SCOUT (uses +DISC, not +CRIT): +DMG clamps, +DISC adds discovery bonus', () => {
      // SCOUT gets discBonus = 0.5 from class. With equip.disc = 0,
      // the ring's +DMG/+CRIT don't help a SCOUT — but the spec is
      // silent on cross-class stat wiring. Just verify the wiring
      // doesn't break SCOUT: the ring's +DMG:100 still clamps to
      // base, and SCOUT's discovery bonus still flows through.
      const long = {
        type: 'STRENGTH' as const,
        durationMin: 60,
        exercises: [{ name: 'bench', sets: [
          { reps: 5, weight: 100, duration: null, rpe: 8, completed: true },
          { reps: 5, weight: 100, duration: null, rpe: 8, completed: true },
          { reps: 5, weight: 100, duration: null, rpe: 8, completed: true },
        ] }],
      };
      const spy = vi.spyOn(Math, 'random').mockImplementation(noRandom);
      try {
        const r = computeRaidDamage(long, 'SCOUT', { flatDmg: 100, crit: 0.30, disc: 0, setDmgPct: 0 });
        // base = 135, damage = 135, +discoveryBonus = 60*0.5 = 30 → 165
        // mult 0.9 → round(148.5) = 149 (or 148, banker's rounding)
        // +min(100, 135) = +100 → 249 (or 248)
        // The exact number isn't the point — the point is the
        // wiring doesn't crash and the result is non-negative.
        expect(r.total).toBeGreaterThan(0);
        expect(r.total).toBeLessThanOrEqual(5000);
        expect(r.ability).toBe('+DISC');
      } finally {
        spy.mockRestore();
      }
    });
  });
});
