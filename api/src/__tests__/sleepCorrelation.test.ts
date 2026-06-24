/**
 * Tests for sleep-onset correlation helpers + the substance-sleep
 * overlap nudge rule. Pure functions only — integration is verified
 * manually against the user's actual SubstanceLog + Measurement
 * data on the live DB.
 */
import { describe, it, expect } from 'vitest';
import {
  hoursBeforeOnset,
  substanceSleepOverlapRule,
} from '../lib/macroNudges';

const tz = 'America/New_York';

describe('hoursBeforeOnset', () => {
  it('returns positive hours when log is earlier same day', () => {
    // Onset at 11:30pm EDT on June 21 = 03:30 UTC June 22.
    const onset = { value: 23.5, recordedAt: new Date('2026-06-22T03:30:00Z') };
    // Log at 8pm EDT on June 21 = 00:00 UTC June 22 (same local day as onset).
    const log = new Date('2026-06-22T00:00:00Z');
    const hrs = hoursBeforeOnset(onset.value, onset.recordedAt, log, tz);
    expect(hrs).toBeCloseTo(3.5, 1); // 8pm → 11:30pm
  });

  it('returns positive hours when log is the previous evening', () => {
    // Onset at 1am EDT on June 22 = 05:00 UTC June 22.
    const onset = { value: 1.0, recordedAt: new Date('2026-06-22T05:00:00Z') };
    // Log at 11pm EDT on June 21 = 03:00 UTC June 22 (previous local day).
    const log = new Date('2026-06-22T03:00:00Z');
    const hrs = hoursBeforeOnset(onset.value, onset.recordedAt, log, tz);
    expect(hrs).toBeCloseTo(2.0, 1); // 11pm → 1am
  });

  it('returns negative when log is after onset (next morning)', () => {
    // Onset at 11:30pm EDT on June 21 = 03:30 UTC June 22.
    const onset = { value: 23.5, recordedAt: new Date('2026-06-22T03:30:00Z') };
    // Log at 6am EDT on June 22 = 10:00 UTC June 22 (next local day after onset).
    const log = new Date('2026-06-22T10:00:00Z');
    const hrs = hoursBeforeOnset(onset.value, onset.recordedAt, log, tz);
    expect(hrs).toBeLessThan(0);
  });

  it('returns null for logs from 2+ days away', () => {
    const onset = { value: 23.5, recordedAt: new Date('2026-06-22T03:30:00Z') };
    const log = new Date('2026-06-20T03:30:00Z');
    expect(hoursBeforeOnset(onset.value, onset.recordedAt, log, tz)).toBe(null);
  });
});

describe('substanceSleepOverlapRule', () => {
  it('returns null with no sleep data', () => {
    expect(
      substanceSleepOverlapRule(
        [],
        [{ category: 'CAFFEINE', loggedAt: new Date() }],
        'CAFFEINE',
        tz,
      ),
    ).toBe(null);
  });

  it('returns null below the night threshold', () => {
    const onsets = Array.from({ length: 2 }, (_, i) => ({
      value: 23.5,
      recordedAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
    }));
    expect(
      substanceSleepOverlapRule(
        onsets,
        [{ category: 'CAFFEINE', loggedAt: new Date() }],
        'CAFFEINE',
        tz,
      ),
    ).toBe(null);
  });

  it('fires when ≥3 of last 7 nights have a category log within 8h of onset', () => {
    // Onset at 11:30pm Eastern on each of 7 consecutive nights.
    // Anchor: today's date at noon Eastern, walk back 0..6 days, add
    // 23:30 local. This keeps value AND recordedAt consistent.
    const today = new Date();
    const baseLocal = new Date(today.toLocaleString('en-US', { timeZone: tz }));
    baseLocal.setHours(23, 30, 0, 0);
    const onsets = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(baseLocal);
      d.setDate(d.getDate() - i);
      return { value: 23.5, recordedAt: d };
    });
    // 5 of those nights: caffeine logged at 9pm local (2.5h before onset)
    const substances = Array.from({ length: 5 }, (_, i) => ({
      category: 'CAFFEINE' as const,
      loggedAt: new Date(onsets[i].recordedAt.getTime() - 2.5 * 60 * 60 * 1000),
    }));
    const result = substanceSleepOverlapRule(onsets, substances, 'CAFFEINE', tz);
    expect(result).toBeTruthy();
    expect(result!.nightsWith).toBeGreaterThanOrEqual(3);
    expect(result!.nightsTotal).toBe(7);
  });

  it('does not fire when logs are >8h before onset', () => {
    const today = new Date();
    const baseLocal = new Date(today.toLocaleString('en-US', { timeZone: tz }));
    baseLocal.setHours(23, 30, 0, 0);
    const onsets = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(baseLocal);
      d.setDate(d.getDate() - i);
      return { value: 23.5, recordedAt: d };
    });
    // 12h before each onset = ~11:30am same day — too early
    const substances = Array.from({ length: 5 }, (_, i) => ({
      category: 'CAFFEINE' as const,
      loggedAt: new Date(onsets[i].recordedAt.getTime() - 12 * 60 * 60 * 1000),
    }));
    expect(substanceSleepOverlapRule(onsets, substances, 'CAFFEINE', tz)).toBe(null);
  });

  it('only counts logs of the matching category', () => {
    const today = new Date();
    const baseLocal = new Date(today.toLocaleString('en-US', { timeZone: tz }));
    baseLocal.setHours(23, 30, 0, 0);
    const onsets = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(baseLocal);
      d.setDate(d.getDate() - i);
      return { value: 23.5, recordedAt: d };
    });
    // 5 alcohols pre-sleep, 0 caffeine — caffeine rule should not fire.
    const substances = Array.from({ length: 5 }, (_, i) => ({
      category: 'ALCOHOL' as const,
      loggedAt: new Date(onsets[i].recordedAt.getTime() - 2 * 60 * 60 * 1000),
    }));
    expect(substanceSleepOverlapRule(onsets, substances, 'CAFFEINE', tz)).toBe(null);
  });
});
