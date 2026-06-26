import { describe, it, expect } from 'vitest';
import {
  tierForShield,
  clampShield,
  TIER_LABEL,
  TIER_COLOR,
  PENANCE_DELTAS,
  PENANCE_LABELS,
} from '../lib/penance.js';

describe('tierForShield', () => {
  it('classifies 100 as FORTIFIED', () => {
    expect(tierForShield(100)).toBe('FORTIFIED');
  });
  it('classifies 90 as FORTIFIED (boundary)', () => {
    expect(tierForShield(90)).toBe('FORTIFIED');
  });
  it('classifies 89 as STABLE', () => {
    expect(tierForShield(89)).toBe('STABLE');
  });
  it('classifies 60 as STABLE (boundary)', () => {
    expect(tierForShield(60)).toBe('STABLE');
  });
  it('classifies 59 as COMPROMISED', () => {
    expect(tierForShield(59)).toBe('COMPROMISED');
  });
  it('classifies 30 as COMPROMISED (boundary)', () => {
    expect(tierForShield(30)).toBe('COMPROMISED');
  });
  it('classifies 29 as BREACHED', () => {
    expect(tierForShield(29)).toBe('BREACHED');
  });
  it('classifies 0 as BREACHED', () => {
    expect(tierForShield(0)).toBe('BREACHED');
  });
});

describe('clampShield', () => {
  it('clamps below 0 to 0', () => {
    expect(clampShield(-5)).toBe(0);
  });
  it('clamps above 100 to 100', () => {
    expect(clampShield(150)).toBe(100);
  });
  it('passes through mid-range values', () => {
    expect(clampShield(50)).toBe(50);
  });
});

describe('tier label / color maps', () => {
  it('every tier has a label', () => {
    for (const t of ['FORTIFIED', 'STABLE', 'COMPROMISED', 'BREACHED'] as const) {
      expect(TIER_LABEL[t]).toBeTruthy();
    }
  });
  it('every tier has a hex color', () => {
    for (const t of ['FORTIFIED', 'STABLE', 'COMPROMISED', 'BREACHED'] as const) {
      expect(TIER_COLOR[t]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('PENANCE_DELTAS', () => {
  it('damage penances are negative', () => {
    expect(PENANCE_DELTAS.missed_workout).toBeLessThan(0);
    expect(PENANCE_DELTAS.missed_all_dailies).toBeLessThan(0);
    expect(PENANCE_DELTAS.substance_overuse).toBeLessThan(0);
  });
  it('repair penances are positive', () => {
    expect(PENANCE_DELTAS.substance_checkin).toBeGreaterThan(0);
    expect(PENANCE_DELTAS.logged_mobility).toBeGreaterThan(0);
    expect(PENANCE_DELTAS.logged_cardio_30).toBeGreaterThan(0);
    expect(PENANCE_DELTAS.substance_free_day).toBeGreaterThan(0);
    expect(PENANCE_DELTAS.hit_protein_target).toBeGreaterThan(0);
    expect(PENANCE_DELTAS.hit_water_target).toBeGreaterThan(0);
    expect(PENANCE_DELTAS.completed_prayer).toBeGreaterThan(0);
  });
  it('overuse delta is at least as large as missed-workout', () => {
    // Both are damage, but substance overuse is the bigger penalty
    // so the user feels it.
    expect(Math.abs(PENANCE_DELTAS.substance_overuse)).toBeGreaterThanOrEqual(
      Math.abs(PENANCE_DELTAS.missed_workout),
    );
  });
  it('every delta label has a matching label', () => {
    for (const key of Object.keys(PENANCE_DELTAS) as Array<keyof typeof PENANCE_DELTAS>) {
      expect(PENANCE_LABELS[key]).toBeTruthy();
    }
  });
});
