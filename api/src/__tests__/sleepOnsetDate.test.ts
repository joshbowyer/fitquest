/**
 * Tests for the FIT sleep parser's night-of-sleep date assignment.
 *
 * `SLEEP_ONSET` Measurement rows store the local fractional hour of
 * the start event (22.5 = 10:30 PM) and bucket the `recordedAt` to
 * local midnight of the calendar day that "owns" this sleep. Post-
 * midnight starts (e.g. 12:30 AM Monday) are bucketed to the previous
 * calendar day (Sunday) so the chart's X-axis renders the sleep on
 * the row the user thinks of ("Monday's sleep started Sunday night").
 *
 * Pure-logic helpers (`localNightStartInTz`, `hoursSinceLocalMidnightInTz`)
 * are tested directly with synthetic UTC instants so the assertions
 * are deterministic and don't depend on the local clock.
 */
import { describe, it, expect } from 'vitest';
import {
  hoursSinceLocalMidnightInTz,
  localNightStartInTz,
} from '../lib/timezone';

describe('hoursSinceLocalMidnightInTz', () => {
  it('returns the fractional hour of a UTC instant in the given tz', () => {
    // 2026-06-22 02:30:00 UTC == 22:30 previous day in America/New_York (EDT, UTC-4)
    const at = new Date('2026-06-22T02:30:00Z');
    expect(hoursSinceLocalMidnightInTz(at, 'America/New_York')).toBeCloseTo(22.5, 1);
  });

  it('handles UTC tz as a passthrough', () => {
    const at = new Date('2026-06-22T15:45:00Z');
    expect(hoursSinceLocalMidnightInTz(at, 'UTC')).toBeCloseTo(15.75, 2);
  });

  it('handles half-hour offsets (Asia/Kolkata UTC+5:30)', () => {
    // 2026-06-22 00:30 UTC == 06:00 IST
    const at = new Date('2026-06-22T00:30:00Z');
    expect(hoursSinceLocalMidnightInTz(at, 'Asia/Kolkata')).toBeCloseTo(6.0, 1);
  });

  it('falls back to UTC offset on invalid tz', () => {
    const at = new Date('2026-06-22T15:45:00Z');
    expect(hoursSinceLocalMidnightInTz(at, 'Not/A/Zone')).toBeCloseTo(15.75, 2);
  });
});

describe('localNightStartInTz', () => {
  // Reference: 2026-06-22 (Monday) in America/New_York
  const mondayLocalMidnightUtc = new Date('2026-06-22T04:00:00Z'); // == 2026-06-22 00:00 EDT
  const sundayLocalMidnightUtc = new Date('2026-06-22T04:00:00Z').getTime() - 24 * 3600_000;

  it('buckets 10pm Mon (22:00) → same calendar day (Mon)', () => {
    // 2026-06-22 22:00 EDT == 2026-06-23 02:00 UTC
    const at = new Date('2026-06-23T02:00:00Z');
    expect(localNightStartInTz(at, 'America/New_York').toISOString()).toBe(
      mondayLocalMidnightUtc.toISOString(),
    );
  });

  it('buckets 1am Mon (01:00) → previous calendar day (Sun)', () => {
    // 2026-06-22 01:00 EDT == 2026-06-22 05:00 UTC
    const at = new Date('2026-06-22T05:00:00Z');
    expect(localNightStartInTz(at, 'America/New_York').toISOString()).toBe(
      new Date(sundayLocalMidnightUtc).toISOString(),
    );
  });

  it('buckets 3pm Mon (afternoon nap) → same day', () => {
    // 2026-06-22 15:00 EDT == 2026-06-22 19:00 UTC
    const at = new Date('2026-06-22T19:00:00Z');
    expect(localNightStartInTz(at, 'America/New_York').toISOString()).toBe(
      mondayLocalMidnightUtc.toISOString(),
    );
  });

  it('buckets 11:59pm Mon → same day', () => {
    // 2026-06-22 23:59 EDT == 2026-06-23 03:59 UTC
    const at = new Date('2026-06-23T03:59:00Z');
    expect(localNightStartInTz(at, 'America/New_York').toISOString()).toBe(
      mondayLocalMidnightUtc.toISOString(),
    );
  });

  it('buckets 12:00am exactly → previous day (the boundary is 12:00 not 00:00)', () => {
    // 2026-06-22 00:00 EDT == 2026-06-22 04:00 UTC
    const at = new Date('2026-06-22T04:00:00Z');
    expect(localNightStartInTz(at, 'America/New_York').toISOString()).toBe(
      new Date(sundayLocalMidnightUtc).toISOString(),
    );
  });

  it('DST spring-forward: onset at 00:30 CDT (after the 02:00 transition) buckets to the PREVIOUS day in date-space', () => {
    // 2026-03-09 (Mon) is the US spring-forward day (DST starts at
    // 02:00 local). An onset at 00:30 on this date is ambiguous —
    // it happens twice in the US timezones that fall forward at
    // 02:00 local:
    //   1. 00:30 CST (before transition) = 06:30 UTC on Mar 9.
    //   2. 00:30 CDT (after transition)  = 05:30 UTC on Mar 9.
    //
    // Both should bucket to Sunday March 8 (a "post-midnight sleep
    // onset"). The OLD −24h-on-instant code landed the second one
    // on Saturday March 7 because local-midnight UTC for Mar 9 in
    // Chicago is at 06:00 UTC (CST), subtract 24h → 06:00 UTC Mar
    // 8, and Mar 8 00:00 CST is Mar 8 06:00 UTC — but the
    // arithmetic falls apart once the day itself is the transition
    // day. The new code walks the date string by one calendar
    // day, then asks localMidnightUtc for the previous date —
    // always correct regardless of offset shifts.
    const at = new Date('2026-03-09T05:30:00Z'); // 00:30 CDT (post-DST)
    const result = localNightStartInTz(at, 'America/Chicago');
    // The returned Date is the UTC instant of Sunday Mar 8's local
    // midnight in Chicago. Mar 8 is BEFORE spring-forward, so the
    // offset is still CST (UTC-6) and local midnight = 06:00 UTC.
    expect(result.toISOString()).toBe('2026-03-08T06:00:00.000Z');
  });
});