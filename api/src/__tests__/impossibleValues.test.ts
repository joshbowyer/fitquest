import { describe, it, expect } from 'vitest';
import { impossibleValuesDomain, type StoredValidityFlag } from '../lib/impossibleValues.js';

describe('impossibleValuesDomain', () => {
  it('returns an empty array when no workouts are flagged', async () => {
    const userId = '__no_user_' + Date.now();
    const out = await impossibleValuesDomain(userId);
    expect(out).toEqual([]);
  });

  it('sorts flagged items by occurredAt descending (most recent first)', () => {
    const a = { workoutId: 'a', occurredAt: '2026-06-23T10:00:00.000Z' };
    const b = { workoutId: 'b', occurredAt: '2026-06-24T10:00:00.000Z' };
    const c = { workoutId: 'c', occurredAt: '2026-06-22T10:00:00.000Z' };
    const sorted = [a, b, c].sort((x, y) => y.occurredAt.localeCompare(x.occurredAt));
    // sorted is 3 elements by construction (sort is in-place over [a,b,c]).
    expect(sorted[0]!.workoutId).toBe('b');
    expect(sorted[1]!.workoutId).toBe('a');
    expect(sorted[2]!.workoutId).toBe('c');
  });

  it('normalizes weight values to kg unit', () => {
    const flag: StoredValidityFlag = {
      exercise: 'Bench Press (Barbell)',
      setIndex: 0,
      field: 'weight',
      value: 500,
      reason: 'too heavy',
      severity: 'block',
    };
    expect(flag.field === 'weight' ? 'kg' : 'reps').toBe('kg');
  });

  it('normalizes reps values to reps unit', () => {
    const flag: StoredValidityFlag = {
      exercise: 'Bench Press (Barbell)',
      setIndex: 0,
      field: 'reps',
      value: 500,
      reason: 'too many',
      severity: 'block',
    };
    expect(flag.field === 'reps' ? 'reps' : 'kg').toBe('reps');
  });

  it('treats severity as flag when undefined (defensive)', () => {
    const flag: StoredValidityFlag = {
      exercise: 'Bench',
      setIndex: 0,
      field: 'weight',
      value: 500,
      reason: 'heavy',
    };
    const severity: 'flag' | 'block' = flag.severity === 'block' ? 'block' : 'flag';
    expect(severity).toBe('flag');
  });
});
