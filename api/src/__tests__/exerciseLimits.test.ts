import { describe, it, expect } from 'vitest';
import {
  EXERCISE_LIMITS,
  checkSetPlausibility,
  epley1Rm,
  getExerciseLimit,
} from '../lib/exerciseLimits.js';

const USER_WT = 60.8;

describe('exerciseLimits — epley1Rm', () => {
  it('reps=1 returns the weight directly', () => {
    expect(epley1Rm(100, 1)).toBe(100);
  });

  it('reps=0 returns 0', () => {
    expect(epley1Rm(100, 0)).toBe(0);
  });

  it('Epley: 1RM = weight × (1 + reps/30)', () => {
    expect(epley1Rm(100, 5)).toBeCloseTo(116.6667, 4);
    expect(epley1Rm(100, 10)).toBeCloseTo(133.3333, 4);
    expect(epley1Rm(140, 5)).toBeCloseTo(163.3333, 4);
  });
});

describe('exerciseLimits — getExerciseLimit', () => {
  it('returns a limit for known exercises', () => {
    const bench = getExerciseLimit('Bench Press');
    expect(bench.flagOneRmKg).toBe(250);
    expect(bench.blockOneRmKg).toBe(400);
  });

  it('is case-insensitive', () => {
    expect(getExerciseLimit('bench press').blockOneRmKg).toBe(400);
    expect(getExerciseLimit('BENCH PRESS').blockOneRmKg).toBe(400);
  });

  it('plural-tolerant lookup', () => {
    expect(getExerciseLimit('Pull-Ups').flagOneRmKg).toBe(200);
    expect(getExerciseLimit('Pull-Up').flagOneRmKg).toBe(200);
    expect(getExerciseLimit('Pushup').flagOneRmKg).toBe(130);
  });

  it('falls back to DEFAULT for unknown exercises', () => {
    const unknown = getExerciseLimit('Cryptic Calisthenic Move');
    expect(unknown.flagOneRmKg).toBe(300);
    expect(unknown.blockOneRmKg).toBe(500);
  });
});

describe('exerciseLimits — checkSetPlausibility', () => {
  it('clean sets return null verdict', () => {
    expect(checkSetPlausibility('Bench Press', 100, 5, USER_WT).severity).toBe(null);
    expect(checkSetPlausibility('Squat', 200, 5, USER_WT).severity).toBe(null);
  });

  it('flag verdict for advanced-but-plausible Bench Press 1RM', () => {
    // 200kg × 5 reps = 233kg Epley 1RM, just under the 250 flag threshold.
    expect(checkSetPlausibility('Bench Press', 200, 5, USER_WT).severity).toBe(null);
    // 220kg × 5 = 257kg Epley — over the flag threshold.
    const verdict = checkSetPlausibility('Bench Press', 220, 5, USER_WT);
    expect(verdict.severity).toBe('flag');
    expect(verdict.oneRmKg).toBeCloseTo(256.667, 2);
  });

  it('block verdict for typo-level Bench Press 1RM', () => {
    // 400kg × 3 reps = 440kg Epley — over the 400kg block threshold.
    const verdict = checkSetPlausibility('Bench Press', 400, 3, USER_WT);
    expect(verdict.severity).toBe('block');
  });

  it('block verdict for reps beyond cap', () => {
    expect(checkSetPlausibility('Push-Up', 0, 250, USER_WT).severity).toBe('block');
  });

  it('flags absurd deadlift weight', () => {
    // 500kg × 1 = 500kg Epley — over the 400kg flag threshold but
    // under the 550kg block threshold (world record is 501kg raw).
    expect(checkSetPlausibility('Deadlift', 500, 1, USER_WT).severity).toBe('flag');
    // 600kg is unambiguously a typo (no human has ever pulled this).
    expect(checkSetPlausibility('Deadlift', 600, 1, USER_WT).severity).toBe('block');
  });

  it('clean deadlift at strong amateur level stays null', () => {
    // 300kg × 1 rep = 300kg Epley, just under 400 flag threshold
    expect(checkSetPlausibility('Deadlift', 300, 1, USER_WT).severity).toBe(null);
  });

  it('handles bodyweight sets with user weight', () => {
    // Nordic Curl at 60.8kg × 5 = 70.9 Epley — under flag threshold
    expect(checkSetPlausibility('Nordic Curl', 60.8, 5, USER_WT).severity).toBe(null);
  });

  it('flags weighted chin-up with ridiculous total weight', () => {
    // 200kg total (60.8 + 140kg added) × 5 = 233 Epley, over flag threshold
    const verdict = checkSetPlausibility('Weighted Chin-Up', 200, 5, USER_WT);
    expect(verdict.severity).toBe('flag');
  });

  it('static hold (plank) ignores 1RM but still flags absurd weight', () => {
    expect(checkSetPlausibility('Plank', 0, 1, USER_WT).severity).toBe(null);
    // 500kg on a plank is absurd
    const verdict = checkSetPlausibility('Plank', 500, 1, USER_WT);
    expect(verdict.severity).toBe('block');
  });
});

describe('exerciseLimits — table coverage', () => {
  it('has limits for all main lifts', () => {
    expect(EXERCISE_LIMITS['Bench Press']).toBeDefined();
    expect(EXERCISE_LIMITS['Squat']).toBeDefined();
    expect(EXERCISE_LIMITS['Deadlift']).toBeDefined();
    expect(EXERCISE_LIMITS['Overhead Press']).toBeDefined();
  });

  it('has limits for weighted calisthenics', () => {
    expect(EXERCISE_LIMITS['Weighted Pull-Up']).toBeDefined();
    expect(EXERCISE_LIMITS['Weighted Dip']).toBeDefined();
    expect(EXERCISE_LIMITS['Weighted Push-Up']).toBeDefined();
  });

  it('every limit has positive flag + block thresholds', () => {
    for (const [name, limit] of Object.entries(EXERCISE_LIMITS)) {
      expect(limit.flagOneRmKg, name).toBeGreaterThan(0);
      expect(limit.blockOneRmKg, name).toBeGreaterThan(limit.flagOneRmKg);
      expect(limit.maxReps, name).toBeGreaterThan(0);
    }
  });
});
