/**
 * Test the spiritual + recovery penance entries. Just verifies
 * the new keys are registered in PENANCE_DELTAS / PENANCE_LABELS
 * / PENANCE_FLAVORS and have non-trivial values.
 */
import { describe, it, expect } from 'vitest';
import {
  PENANCE_DELTAS,
  PENANCE_LABELS,
  PENANCE_FLAVORS,
  type PenanceKey,
} from '../lib/penance.js';

const NEW_KEYS: PenanceKey[] = [
  'missed_spiritual_week',
  'missed_examen',
  'completed_spiritual_day',
  'logged_recovery_week',
  'missed_recovery_week',
  'logged_sleep_8h',
  'missed_hrv',
];

describe('spiritual + recovery penance entries', () => {
  it.each(NEW_KEYS)('has a delta for %s', (key) => {
    expect(PENANCE_DELTAS).toHaveProperty(key);
    expect(typeof PENANCE_DELTAS[key]).toBe('number');
    expect(PENANCE_DELTAS[key]).not.toBe(0);
  });

  it.each(NEW_KEYS)('has a label for %s', (key) => {
    expect(PENANCE_LABELS).toHaveProperty(key);
    expect(typeof PENANCE_LABELS[key]).toBe('string');
    expect(PENANCE_LABELS[key]!.length).toBeGreaterThan(0);
  });

  it.each(NEW_KEYS)('has a flavor for %s', (key) => {
    expect(PENANCE_FLAVORS).toHaveProperty(key);
    expect(typeof PENANCE_FLAVORS[key]).toBe('string');
    expect(PENANCE_FLAVORS[key]!.length).toBeGreaterThan(20);
  });

  it('missed_spiritual_week is a real penalty (-14)', () => {
    expect(PENANCE_DELTAS.missed_spiritual_week).toBe(-14);
  });

  it('completed_spiritual_day is a positive (+5)', () => {
    expect(PENANCE_DELTAS.completed_spiritual_day).toBe(5);
  });

  it('logged_sleep_8h is a positive recovery event (+5)', () => {
    expect(PENANCE_DELTAS.logged_sleep_8h).toBe(5);
  });

  it('missed_recovery_week is a real penalty (-12)', () => {
    expect(PENANCE_DELTAS.missed_recovery_week).toBe(-12);
  });
});
