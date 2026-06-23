import { describe, it, expect } from 'vitest';
import {
  BODYWEIGHT_COEFFICIENTS,
  bodyweightCoefficient,
  isBodyweightSet,
  setVolumeKg,
} from '../lib/exerciseVolume.js';

const USER_WT = 60; // kg

describe('exerciseVolume — bodyweight coefficients', () => {
  it('pushup = 0.64 × bodyweight × reps', () => {
    expect(setVolumeKg({ weight: 0, reps: 10 }, 'Pushup', USER_WT)).toBeCloseTo(60 * 0.64 * 10, 6);
    expect(setVolumeKg({ weight: 0, reps: 20 }, 'Pushups', USER_WT)).toBeCloseTo(60 * 0.64 * 20, 6);
    expect(setVolumeKg({ weight: 0, reps: 1 }, 'Push-Up', USER_WT)).toBeCloseTo(60 * 0.64, 6);
  });

  it('dip = 0.85 × bodyweight × reps', () => {
    expect(setVolumeKg({ weight: 0, reps: 10 }, 'Dip', USER_WT)).toBeCloseTo(60 * 0.85 * 10, 6);
    expect(setVolumeKg({ weight: 0, reps: 8 }, 'Dips', USER_WT)).toBeCloseTo(60 * 0.85 * 8, 6);
  });

  it('pullup = 1.0 × bodyweight × reps', () => {
    expect(setVolumeKg({ weight: 0, reps: 5 }, 'Pullup', USER_WT)).toBeCloseTo(60 * 5, 6);
    expect(setVolumeKg({ weight: 0, reps: 10 }, 'Pull-Up', USER_WT)).toBeCloseTo(60 * 10, 6);
    expect(setVolumeKg({ weight: 0, reps: 5 }, 'Chinup', USER_WT)).toBeCloseTo(60 * 5, 6);
  });

  it('squat = 0.7 × bodyweight × reps', () => {
    expect(setVolumeKg({ weight: 0, reps: 10 }, 'Squat', USER_WT)).toBeCloseTo(60 * 0.7 * 10, 6);
    expect(setVolumeKg({ weight: 0, reps: 5 }, 'Bodyweight Squat', USER_WT)).toBeCloseTo(60 * 0.7 * 5, 6);
  });

  it('pistol squat = 0.9 × bodyweight × reps', () => {
    expect(setVolumeKg({ weight: 0, reps: 5 }, 'Pistol Squat', USER_WT)).toBeCloseTo(60 * 0.9 * 5, 6);
  });

  it('unknown bodyweight exercise defaults to 0.65', () => {
    expect(setVolumeKg({ weight: 0, reps: 10 }, 'Cryptic Calisthenic Move', USER_WT)).toBeCloseTo(
      60 * 0.65 * 10,
      6,
    );
    expect(bodyweightCoefficient('Cryptic Calisthenic Move')).toBe(0.65);
  });

  it('coefficient lookup is case-insensitive', () => {
    expect(bodyweightCoefficient('PUSHUP')).toBe(0.64);
    expect(bodyweightCoefficient('pushup')).toBe(0.64);
    expect(bodyweightCoefficient('PushUp')).toBe(0.64);
  });

  it('coefficient map has expected keys', () => {
    expect(BODYWEIGHT_COEFFICIENTS['pushup']).toBe(0.64);
    expect(BODYWEIGHT_COEFFICIENTS['dip']).toBe(0.85);
    expect(BODYWEIGHT_COEFFICIENTS['pullup']).toBe(1.0);
    expect(BODYWEIGHT_COEFFICIENTS['pistol squat']).toBe(0.9);
    expect(BODYWEIGHT_COEFFICIENTS['nordic curl']).toBe(0.85);
    expect(BODYWEIGHT_COEFFICIENTS['inverted row']).toBe(0.6);
  });

  it('nordic curl + inverted row use specific coefficients', () => {
    expect(setVolumeKg({ weight: 0, reps: 5 }, 'Nordic Curl', USER_WT)).toBeCloseTo(60 * 0.85 * 5, 6);
    expect(setVolumeKg({ weight: 0, reps: 5 }, 'Inverted Row', USER_WT)).toBeCloseTo(60 * 0.6 * 5, 6);
  });
});

describe('exerciseVolume — isBodyweightSet', () => {
  it('weight = 0 is bodyweight', () => {
    expect(isBodyweightSet({ weight: 0 }, USER_WT)).toBe(true);
    expect(isBodyweightSet({ weight: null }, USER_WT)).toBe(false);
  });

  it('weight within ±2kg of user weight is bodyweight', () => {
    expect(isBodyweightSet({ weight: 60 }, USER_WT)).toBe(true);
    expect(isBodyweightSet({ weight: 60.8 }, USER_WT)).toBe(true);
    expect(isBodyweightSet({ weight: 58 }, USER_WT)).toBe(true);
    expect(isBodyweightSet({ weight: 62 }, USER_WT)).toBe(true);
    expect(isBodyweightSet({ weight: 62.1 }, USER_WT)).toBe(false);
    expect(isBodyweightSet({ weight: 57.9 }, USER_WT)).toBe(false);
  });

  it('weight above tolerance is weighted', () => {
    expect(isBodyweightSet({ weight: 80 }, USER_WT)).toBe(false);
    expect(isBodyweightSet({ weight: 100 }, USER_WT)).toBe(false);
  });

  it('weight of 0 with no user weight still counts as bodyweight', () => {
    expect(isBodyweightSet({ weight: 0 }, 0)).toBe(true);
  });
});

describe('exerciseVolume — setVolumeKg edge cases', () => {
  it('zero reps returns 0 volume', () => {
    expect(setVolumeKg({ weight: 0, reps: 0 }, 'Pushup', USER_WT)).toBe(0);
    expect(setVolumeKg({ weight: 100, reps: 0 }, 'Bench Press', USER_WT)).toBe(0);
  });

  it('null weight returns 0 volume', () => {
    expect(setVolumeKg({ weight: null, reps: 10 }, 'Pushup', USER_WT)).toBe(0);
  });

  it('weighted exercise uses straight weight × reps', () => {
    expect(setVolumeKg({ weight: 100, reps: 5 }, 'Bench Press', USER_WT)).toBe(500);
    expect(setVolumeKg({ weight: 140, reps: 5 }, 'Squat', USER_WT)).toBe(700);
  });

  it('bodyweight with vest (over tolerance) uses weighted path', () => {
    expect(setVolumeKg({ weight: 80, reps: 10 }, 'Pushup', USER_WT)).toBe(800);
    expect(setVolumeKg({ weight: 75, reps: 10 }, 'Pullup', USER_WT)).toBe(750);
  });

  it('user with unknown weight (0) still handles weight=0 as bodyweight', () => {
    expect(setVolumeKg({ weight: 0, reps: 10 }, 'Pushup', 0)).toBe(0);
  });

  it('user with unknown weight (0) handles weighted as-is', () => {
    expect(setVolumeKg({ weight: 100, reps: 5 }, 'Bench Press', 0)).toBe(500);
  });

  it('large reps produce linear volume', () => {
    expect(setVolumeKg({ weight: 0, reps: 100 }, 'Pushup', USER_WT)).toBeCloseTo(60 * 0.64 * 100, 6);
  });

  it('comparison: pushup is much less than full-bodyweight squat', () => {
    const pushup = setVolumeKg({ weight: 0, reps: 10 }, 'Pushup', USER_WT);
    const squat = setVolumeKg({ weight: 0, reps: 10 }, 'Squat', USER_WT);
    const pullup = setVolumeKg({ weight: 0, reps: 10 }, 'Pullup', USER_WT);
    expect(pushup).toBeLessThan(squat);
    expect(squat).toBeLessThan(pullup);
    expect(pushup / pullup).toBeCloseTo(0.64, 2);
  });
});
