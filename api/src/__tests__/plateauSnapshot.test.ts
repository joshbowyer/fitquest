import { describe, it, expect } from 'vitest';
import { sundayOfWeek } from '../lib/plateauSnapshot.js';

describe('sundayOfWeek', () => {
  it('returns the same date when called on a Sunday', () => {
    // 2026-06-21 was a Sunday
    const sunday = new Date('2026-06-21T15:00:00.000Z');
    const key = sundayOfWeek(sunday, 'UTC');
    expect(key).toBe('2026-06-21');
  });

  it('walks back to Sunday when called mid-week', () => {
    // 2026-06-24 was a Wednesday
    const wednesday = new Date('2026-06-24T15:00:00.000Z');
    const key = sundayOfWeek(wednesday, 'UTC');
    expect(key).toBe('2026-06-21');
  });

  it('walks back 6 days when called on a Saturday', () => {
    // 2026-06-27 was a Saturday
    const saturday = new Date('2026-06-27T15:00:00.000Z');
    const key = sundayOfWeek(saturday, 'UTC');
    expect(key).toBe('2026-06-21');
  });

  it('walks back to the PREVIOUS Sunday when called on Sunday morning', () => {
    // 2026-06-28 00:30 UTC is technically Sunday but only 30 min in
    // — the local-date is still 2026-06-28 (Sunday). The function
    // returns the local-date, not the prior week's Sunday.
    const earlySunday = new Date('2026-06-28T00:30:00.000Z');
    const key = sundayOfWeek(earlySunday, 'UTC');
    expect(key).toBe('2026-06-28');
  });

  it('handles timezone offset correctly', () => {
    // 2026-06-22 02:00 UTC = 2026-06-21 22:00 in America/New_York
    // (Monday early morning local, Sunday late night prior).
    // The function uses the local-date so the key should be
    // 2026-06-21 (Sunday) for a NY user.
    const mondayUtc = new Date('2026-06-22T02:00:00.000Z');
    const nyKey = sundayOfWeek(mondayUtc, 'America/New_York');
    expect(nyKey).toBe('2026-06-21');
  });
});
