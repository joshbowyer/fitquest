/**
 * Tests for the skill-test validators. The unlock endpoint uses
 * these to confirm the user's submitted result meets the skill's
 * `test.threshold`. Each metric type has its own validation
 * logic — make sure all paths are covered.
 */
import { describe, it, expect } from 'vitest';
import {
  validateSkillTest,
  type SkillTestSpec,
} from '../lib/skillTest.js';

const baseSpec: SkillTestSpec = {
  description: 'Test',
  safety: 'Test safely',
  metric: 'reps',
  threshold: { reps: 5 },
};

function makeResult(fields: Record<string, number>) {
  return fields;
}

describe('validateSkillTest — reps', () => {
  const spec: SkillTestSpec = { ...baseSpec, metric: 'reps', threshold: { reps: 5 } };

  it('passes when reps >= threshold', () => {
    expect(validateSkillTest(spec, makeResult({ reps: 5 }), 0).ok).toBe(true);
    expect(validateSkillTest(spec, makeResult({ reps: 10 }), 0).ok).toBe(true);
  });

  it('fails when reps < threshold', () => {
    const r = validateSkillTest(spec, makeResult({ reps: 4 }), 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Need ≥5 reps/);
  });

  it('fails when reps is missing', () => {
    expect(validateSkillTest(spec, makeResult({}), 0).ok).toBe(false);
  });
});

describe('validateSkillTest — reps:each (per-side)', () => {
  const spec: SkillTestSpec = { ...baseSpec, metric: 'reps:each', threshold: { reps: 5 } };

  it('reports the "each side" hint in the failure message', () => {
    const r = validateSkillTest(spec, makeResult({ reps: 3 }), 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/each side/);
  });
});

describe('validateSkillTest — weight:reps (barbell + bodyweight)', () => {
  const spec: SkillTestSpec = {
    ...baseSpec,
    metric: 'weight:reps',
    threshold: { reps: 5, weight_kg_mult_of_bw: 1.0 },
  };

  it('passes when both reps and weight multiple of BW are met', () => {
    expect(validateSkillTest(spec, makeResult({ reps: 5, weight_kg: 100 }), 100).ok).toBe(true);
    // 100kg / 100kg BW = 1.0× ✓
    expect(validateSkillTest(spec, makeResult({ reps: 5, weight_kg: 150 }), 100).ok).toBe(true);
    // 150kg / 100kg BW = 1.5× ✓
  });

  it('fails when reps is short even if weight is heavy', () => {
    const r = validateSkillTest(spec, makeResult({ reps: 3, weight_kg: 200 }), 100);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Need ≥5 reps/);
  });

  it('fails when weight multiple of BW is short', () => {
    const r = validateSkillTest(spec, makeResult({ reps: 5, weight_kg: 50 }), 100);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Need ≥1×BW.*0\.50/);
  });

  it('requires bodyweight to be set', () => {
    const r = validateSkillTest(spec, makeResult({ reps: 5, weight_kg: 200 }), 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/bodyweight/);
  });
});

describe('validateSkillTest — weighted:reps:each (weighted calisthenics)', () => {
  const spec: SkillTestSpec = {
    ...baseSpec,
    metric: 'weighted:reps:each',
    threshold: { reps: 5, weight_kg_mult_of_bw: 0.25 },
  };

  it('passes when reps and weight-multiple are met', () => {
    expect(validateSkillTest(spec, makeResult({ reps: 5, weight_kg: 50 }), 200).ok).toBe(true);
    // 50kg / 200kg BW = 0.25× ✓
  });

  it('fails when weighted reps are too low', () => {
    const r = validateSkillTest(spec, makeResult({ reps: 3, weight_kg: 100 }), 200);
    expect(r.ok).toBe(false);
  });
});

describe('validateSkillTest — duration', () => {
  const spec: SkillTestSpec = { ...baseSpec, metric: 'duration', threshold: { duration_sec: 30 } };

  it('passes when duration >= threshold', () => {
    expect(validateSkillTest(spec, makeResult({ duration_sec: 30 }), 0).ok).toBe(true);
    expect(validateSkillTest(spec, makeResult({ duration_sec: 60 }), 0).ok).toBe(true);
  });

  it('fails when duration < threshold', () => {
    const r = validateSkillTest(spec, makeResult({ duration_sec: 20 }), 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Need ≥30s/);
  });
});

describe('validateSkillTest — distance', () => {
  const spec: SkillTestSpec = { ...baseSpec, metric: 'distance', threshold: { distance_m: 5000 } };

  it('passes when distance >= threshold', () => {
    expect(validateSkillTest(spec, makeResult({ distance_m: 5000 }), 0).ok).toBe(true);
  });

  it('fails when distance < threshold', () => {
    const r = validateSkillTest(spec, makeResult({ distance_m: 4000 }), 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Need ≥5000m/);
  });
});

describe('validateSkillTest — rounds', () => {
  const spec: SkillTestSpec = { ...baseSpec, metric: 'rounds', threshold: { rounds: 15 } };

  it('passes when rounds >= threshold', () => {
    expect(validateSkillTest(spec, makeResult({ rounds: 15 }), 0).ok).toBe(true);
    expect(validateSkillTest(spec, makeResult({ rounds: 20 }), 0).ok).toBe(true);
  });

  it('fails when rounds < threshold', () => {
    const r = validateSkillTest(spec, makeResult({ rounds: 12 }), 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Need ≥15 rounds/);
  });
});

describe('validateSkillTest — unknown metric', () => {
  it('fails safely with a server-error reason', () => {
    const spec = { ...baseSpec, metric: 'unknown' as any, threshold: {} };
    const r = validateSkillTest(spec, makeResult({ reps: 5 }), 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Unknown test metric/);
  });
});

describe('validateSkillTest — result echo for UI feedback', () => {
  const spec: SkillTestSpec = {
    ...baseSpec,
    metric: 'weight:reps',
    threshold: { reps: 5, weight_kg_mult_of_bw: 1.0 },
  };

  it('echoes the user’s submitted values for the UI to display', () => {
    const r = validateSkillTest(spec, makeResult({ reps: 5, weight_kg: 100 }), 100);
    expect(r.submitted).toEqual({ reps: 5, weight_kg: 100 });
  });
});
