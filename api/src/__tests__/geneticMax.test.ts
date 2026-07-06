import { describe, it, expect } from 'vitest';
import { computeGeneticMax, computeAllGeneticMaxes } from '../lib/geneticMax.js';

// Reference frame: 180cm tall, 15.24cm wrist (6"), 22cm ankle,
// 80kg, 15% body fat, 30yo male. The Casey Butt formulas should
// produce consistent, well-known values for this baseline.
const baseline: any = {
  sex: 'MALE' as const,
  heightCm: 180,
  wristCm: 15.24,
  ankleCm: 22,
  forearmLengthCm: null,
  neckCircCm: null,
  weightKg: 80,
  bodyFatPct: 15,
  birthDate: new Date('1996-01-01'),
};

describe('computeGeneticMax', () => {
  describe('Casey Butt upper body', () => {
    it('BICEP from wrist is 2.7×wrist (≈41cm for 6" wrist)', () => {
      expect(computeGeneticMax('BICEP', baseline)).toBeCloseTo(15.24 * 2.7, 1);
      // BICEP_FLEXED uses the same Casey Butt formula as the legacy
      // BICEP enum (which is now an alias kept for backward compat).
      expect(computeGeneticMax('BICEP_FLEXED', baseline)).toBeCloseTo(15.24 * 2.7, 1);
      // BICEP_RELAXED applies a 0.92 reduction to the flexed formula
      // (~1.5-2cm smaller for the same arm, no pump).
      expect(computeGeneticMax('BICEP_RELAXED', baseline)).toBeCloseTo(15.24 * 2.7 * 0.92, 1);
    });

    it('FOREARM from wrist is 2.3×wrist', () => {
      expect(computeGeneticMax('FOREARM', baseline)).toBeCloseTo(15.24 * 2.3, 1);
    });

    it('CHEST from wrist is 7.5×wrist', () => {
      expect(computeGeneticMax('CHEST', baseline)).toBeCloseTo(15.24 * 7.5, 1);
    });

    it('SHOULDER from wrist is 8.5×wrist', () => {
      expect(computeGeneticMax('SHOULDER', baseline)).toBeCloseTo(15.24 * 8.5, 1);
    });

    it('NECK uses measured neckCircCm when available', () => {
      expect(computeGeneticMax('NECK', { ...baseline, neckCircCm: 40 })).toBeCloseTo(40, 0);
    });

    it('NECK falls back to 2.9×wrist when not measured', () => {
      const { neckCircCm: _, ...noNeck } = baseline;
      expect(computeGeneticMax('NECK', noNeck)).toBeCloseTo(15.24 * 2.9, 1);
    });
  });

  describe('Casey Butt lower body', () => {
    it('QUAD from ankle is 2.85×ankle', () => {
      expect(computeGeneticMax('QUAD', baseline)).toBeCloseTo(22 * 2.85, 1);
    });

    it('CALF from ankle is 1.9×ankle', () => {
      expect(computeGeneticMax('CALF', baseline)).toBeCloseTo(22 * 1.9, 1);
    });
  });

  describe('Height fallback when no wrist/ankle', () => {
    it('BICEP falls back to 0.228×height when no wrist', () => {
      const { wristCm: _, ...noWrist } = baseline;
      expect(computeGeneticMax('BICEP', noWrist)).toBeCloseTo(180 * 0.228, 1);
      // BICEP_FLEXED height-fallback matches BICEP (legacy alias).
      expect(computeGeneticMax('BICEP_FLEXED', noWrist)).toBeCloseTo(180 * 0.228, 1);
      // BICEP_RELAXED height-fallback is 0.92× the flexed one.
      expect(computeGeneticMax('BICEP_RELAXED', noWrist)).toBeCloseTo(180 * 0.228 * 0.92, 1);
    });

    it('QUAD falls back to 0.352×height when no ankle', () => {
      const { ankleCm: _, ...noAnkle } = baseline;
      expect(computeGeneticMax('QUAD', noAnkle)).toBeCloseTo(180 * 0.352, 1);
    });
  });

  describe('Returns null when no relevant input', () => {
    it('BICEP returns null with no wrist or height', () => {
      expect(computeGeneticMax('BICEP', { weightKg: 80, bodyFatPct: 15 })).toBeNull();
    });
  });

  describe('Strength maxes (bodyweight multipliers)', () => {
    it('BENCH is 1.5×bodyweight', () => {
      expect(computeGeneticMax('BENCH_1RM', baseline)).toBeCloseTo(80 * 1.5, 1);
    });

    it('SQUAT is 2.25×bodyweight', () => {
      expect(computeGeneticMax('SQUAT_1RM', baseline)).toBeCloseTo(80 * 2.25, 1);
    });

    it('DEADLIFT is 2.75×bodyweight', () => {
      expect(computeGeneticMax('DEADLIFT_1RM', baseline)).toBeCloseTo(80 * 2.75, 1);
    });

    it('OHP is 1.0×bodyweight', () => {
      expect(computeGeneticMax('OHP_1RM', baseline)).toBeCloseTo(80 * 1.0, 1);
    });

    it('PULLUP is 0.5×bodyweight, floor at 0', () => {
      expect(computeGeneticMax('PULLUP_1RM', baseline)).toBeCloseTo(80 * 0.5, 1);
    });

    it('POWERLIFT_TOTAL is 6.5×bodyweight (SBD)', () => {
      expect(computeGeneticMax('POWERLIFT_TOTAL', baseline)).toBeCloseTo(80 * 6.5, 1);
    });
  });

  describe('Lean mass / FFMI', () => {
    it('LEAN_MASS uses FFMI 25 ceiling from height (~178 lb for 180cm)', () => {
      // 25 * (1.80)^2 kg = 81 kg = 178.6 lb
      const result = computeGeneticMax('LEAN_MASS', baseline);
      expect(result).toBeCloseTo(81, 0);
    });
  });

  describe('Returns null for excluded metrics', () => {
    // These are tracked in Measurements, not Genetic Maxes
    it.each([
      'BODY_FAT_PCT',
      'WAIST',
      'WEIGHT',
      'PLANK_HOLD',
      'L_SIT_HOLD',
      'FFMI',
    ])('%s returns null', (m) => {
      expect(computeGeneticMax(m as any, baseline)).toBeNull();
    });
  });

  describe('VO2 max is sex-aware and age-adjusted', () => {
    it('male 25yo ceiling is ~60', () => {
      const result = computeGeneticMax('VO2_MAX', {
        ...baseline,
        sex: 'MALE',
        birthDate: new Date(new Date().getFullYear() - 25, 0, 1),
      });
      // 60 - decline(0) = 60
      expect(result).toBeGreaterThanOrEqual(58);
      expect(result).toBeLessThanOrEqual(60);
    });

    it('female 25yo ceiling is ~55', () => {
      const result = computeGeneticMax('VO2_MAX', {
        ...baseline,
        sex: 'FEMALE',
        birthDate: new Date(new Date().getFullYear() - 25, 0, 1),
      });
      expect(result).toBeGreaterThanOrEqual(53);
      expect(result).toBeLessThanOrEqual(55);
    });

    it('declines ~0.4 per year past 25', () => {
      const young = computeGeneticMax('VO2_MAX', {
        ...baseline,
        sex: 'MALE',
        birthDate: new Date(new Date().getFullYear() - 25, 0, 1),
      })!;
      const old = computeGeneticMax('VO2_MAX', {
        ...baseline,
        sex: 'MALE',
        birthDate: new Date(new Date().getFullYear() - 55, 0, 1),
      })!;
      // 30 years * 0.4 = 12 lower
      expect(young - old).toBeCloseTo(12, 0);
    });
  });

  describe('RESTING_HR (unhealthy threshold, not best-achievable floor)', () => {
    it('returns 70 — the far-band upper bound, not the elite floor', () => {
      // Old formula returned 45 (the "best achievable" floor) which
      // made the basic Gauge read "11% OVER" for a typical user
      // with a logged RHR of 50. The IdealGauge (which RHR now
      // routes through on the dashboard) handles the elite / healthy
      // / warn / fan-out semantics directly — this genetic-max is
      // just the "max acceptable" anchor used by GeneticMax tables
      // and dashboard fallback.
      expect(computeGeneticMax('RESTING_HR', baseline)).toBe(70);
    });

    it('does not depend on age or sex (RHR threshold is universal)', () => {
      const male = computeGeneticMax('RESTING_HR', { ...baseline, sex: 'MALE' });
      const female = computeGeneticMax('RESTING_HR', { ...baseline, sex: 'FEMALE' });
      const old = computeGeneticMax('RESTING_HR', {
        ...baseline,
        birthDate: new Date(new Date().getFullYear() - 70, 0, 1),
      });
      expect(male).toBe(70);
      expect(female).toBe(70);
      expect(old).toBe(70);
    });
  });
});

describe('computeAllGeneticMaxes', () => {
  it('returns an entry for every metric', () => {
    const all = computeAllGeneticMaxes(baseline);
    // Should have keys for every MetricType
    expect(Object.keys(all).length).toBeGreaterThan(20);
  });

  it('returns nulls for excluded metrics', () => {
    const all = computeAllGeneticMaxes(baseline);
    expect(all.BODY_FAT_PCT).toBeNull();
    expect(all.WAIST).toBeNull();
    expect(all.WEIGHT).toBeNull();
    expect(all.PLANK_HOLD).toBeNull();
    expect(all.L_SIT_HOLD).toBeNull();
    expect(all.FFMI).toBeNull();
  });
});
