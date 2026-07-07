/**
 * Tests for lastSundayMidnightUtc — the Hardcore heart-regen
 * anchor. Regression coverage for the UTC-positive-zone bug where
 * the weekday was read off the local-midnight UTC *instant*
 * (getUTCDay of e.g. Saturday 22:00Z for a Berlin Sunday), which
 * anchored "last Sunday" to Monday of the previous week for every
 * user east of UTC.
 *
 * Pure date math — no DB, no mocking.
 */
import { describe, it, expect } from 'vitest';
import { lastSundayMidnightUtc, localDayKey } from '../lib/timezone';

/// Helper: the local calendar day of the returned instant, in tz —
/// must always be a Sunday at local midnight.
function localDayAndWeekday(d: Date, tz: string) {
  const day = localDayKey(d, tz);
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return { day, dow };
}

describe('lastSundayMidnightUtc', () => {
  it('UTC: Sunday anchor is the same day at 00:00Z', () => {
    // Wed 2026-07-01 12:00Z → Sunday 2026-06-28 00:00Z
    const at = new Date('2026-07-01T12:00:00Z');
    const r = lastSundayMidnightUtc('UTC', at);
    expect(r.toISOString()).toBe('2026-06-28T00:00:00.000Z');
  });

  it('UTC+ zone (Berlin): returns local Sunday midnight, not the prior Monday', () => {
    // Sunday 2026-06-28 10:00 CEST (= 08:00Z). Most recent local
    // Sunday midnight is 2026-06-28 00:00 CEST = 2026-06-27T22:00Z.
    // The pre-fix code returned 2026-06-21T22:00Z (Monday June 22
    // local — almost a full week early).
    const at = new Date('2026-06-28T08:00:00Z');
    const r = lastSundayMidnightUtc('Europe/Berlin', at);
    expect(r.toISOString()).toBe('2026-06-27T22:00:00.000Z');
    expect(localDayAndWeekday(r, 'Europe/Berlin')).toEqual({ day: '2026-06-28', dow: 0 });
  });

  it('UTC+ zone (Tokyo): Monday morning resolves to the day-before Sunday', () => {
    // Monday 2026-06-29 08:00 JST (= Sunday 23:00Z). Local Sunday
    // midnight is 2026-06-28 00:00 JST = 2026-06-27T15:00Z.
    const at = new Date('2026-06-28T23:00:00Z');
    const r = lastSundayMidnightUtc('Asia/Tokyo', at);
    expect(r.toISOString()).toBe('2026-06-27T15:00:00.000Z');
    expect(localDayAndWeekday(r, 'Asia/Tokyo')).toEqual({ day: '2026-06-28', dow: 0 });
  });

  it('UTC- zone (Chicago): late Sunday evening stays on that Sunday', () => {
    // Sunday 2026-06-28 20:00 CDT (= Monday 01:00Z). Local Sunday
    // midnight is 2026-06-28 00:00 CDT = 2026-06-28T05:00Z.
    const at = new Date('2026-06-29T01:00:00Z');
    const r = lastSundayMidnightUtc('America/Chicago', at);
    expect(r.toISOString()).toBe('2026-06-28T05:00:00.000Z');
    expect(localDayAndWeekday(r, 'America/Chicago')).toEqual({ day: '2026-06-28', dow: 0 });
  });

  it('DST boundary (Berlin, day after spring-forward): anchor is the transition Sunday at its pre-transition offset', () => {
    // Europe spring-forward: Sunday 2026-03-29. On Monday 2026-03-30
    // (CEST, +2) the most recent local Sunday midnight is
    // 2026-03-29 00:00 — still CET (+1) — = 2026-03-28T23:00Z.
    // Fixed-24h instant arithmetic lands an hour off here.
    const at = new Date('2026-03-30T10:00:00Z');
    const r = lastSundayMidnightUtc('Europe/Berlin', at);
    expect(r.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(localDayAndWeekday(r, 'Europe/Berlin')).toEqual({ day: '2026-03-29', dow: 0 });
  });

  it('never returns a future instant and is idempotent on its own output', () => {
    const zones = ['UTC', 'Europe/Berlin', 'Asia/Tokyo', 'America/Chicago', 'Pacific/Auckland'];
    const at = new Date('2026-07-07T12:00:00Z');
    for (const tz of zones) {
      const r = lastSundayMidnightUtc(tz, at);
      expect(r.getTime()).toBeLessThanOrEqual(at.getTime());
      // Anchoring from the anchor itself must be a fixed point —
      // this is what keeps repeated tickHearts() calls stable.
      expect(lastSundayMidnightUtc(tz, r).getTime()).toBe(r.getTime());
    }
  });
});
