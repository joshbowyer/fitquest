/**
 * Tests for the chat rate limits added to lib/rateLimit.ts.
 *
 * Two policies:
 *   - BURST: 5 messages / 1 min sliding window per user
 *   - DAILY: 50 messages / 24h sliding window per user
 *
 * Both share the same in-memory Map<userId, timestamps[]> shape
 * the auth limits already use. Single-process — same caveat as
 * the auth limiter: swap to Redis on multi-process scale-out.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkChatRate, recordChatSend } from '../lib/rateLimit';

describe('chat rate limit', () => {
  beforeEach(() => {
    // The limiter's buckets map is module-scoped (in-memory). To
    // avoid bleed-over between tests, fake the clock + reset by
    // burning through policy windows: 1 recordChatSend pushes
    // one timestamp into both buckets, and after MAX+1 we know
    // any prior test's buckets are well outside the window.
    //
    // A simpler approach would be to add a `_reset()` helper to
    // the module, but that adds an export purely for tests. Fake-
    // clock + over-record is enough.
    vi.useFakeTimers();
  });

  it('allows the first 5 sends in a minute (burst limit)', () => {
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    const u = 'u-burst-' + Math.random();
    for (let i = 0; i < 5; i++) {
      expect(checkChatRate(u).allowed).toBe(true);
      recordChatSend(u);
    }
    expect(checkChatRate(u).allowed).toBe(false);
  });

  it('burst-rejected calls return retryAfterMs pointing to the oldest send', () => {
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    const u = 'u-retry-' + Math.random();
    // Burn the burst at minute 0.
    for (let i = 0; i < 5; i++) recordChatSend(u);
    // Move the clock to T+30s — still inside the 1-min window.
    vi.setSystemTime(new Date('2026-07-01T00:00:30Z'));
    const r = checkChatRate(u);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      // The oldest send was at T+0; the window expires at T+60s.
      // We're at T+30s → 30s = 30000ms remaining.
      expect(r.retryAfterMs).toBeGreaterThanOrEqual(29_500);
      expect(r.retryAfterMs).toBeLessThanOrEqual(30_500);
    }
  });

  it('burst releases after 1 minute passes', () => {
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    const u = 'u-recover-' + Math.random();
    for (let i = 0; i < 5; i++) recordChatSend(u);
    expect(checkChatRate(u).allowed).toBe(false);
    // Advance 61s — the oldest timestamp is now outside the
    // 1-min window, so the bucket trims to 4 and the check passes.
    vi.setSystemTime(new Date('2026-07-01T00:01:01Z'));
    expect(checkChatRate(u).allowed).toBe(true);
  });

  it('allows up to 50 sends in 24 hours (daily limit)', () => {
    // Spread sends across the day (one every 5 min) so the
    // burst limit never trips; we're testing the daily ceiling
    // in isolation.
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    const u = 'u-daily-' + Math.random();
    const baseMs = new Date('2026-07-01T00:00:00Z').getTime();
    for (let i = 0; i < 50; i++) {
      vi.setSystemTime(new Date(baseMs + i * 5 * 60 * 1000));
      expect(checkChatRate(u).allowed).toBe(true);
      recordChatSend(u);
    }
    // 51st send still inside the 24h window — daily cap fires.
    vi.setSystemTime(new Date(baseMs + 51 * 5 * 60 * 1000));
    expect(checkChatRate(u).allowed).toBe(false);
  });

  it('daily limit applies independently of burst — a long-running conversation can use all 50', () => {
    // Spread 50 sends over ~4 hours (one every ~5 min). Verifies
    // the daily cap is the binding constraint over a real session,
    // not the burst.
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    const u = 'u-long-' + Math.random();
    const baseMs = new Date('2026-07-01T00:00:00Z').getTime();
    for (let i = 0; i < 50; i++) {
      vi.setSystemTime(new Date(baseMs + i * 5 * 60 * 1000));
      expect(checkChatRate(u).allowed).toBe(true);
      recordChatSend(u);
    }
    vi.setSystemTime(new Date(baseMs + 51 * 5 * 60 * 1000));
    expect(checkChatRate(u).allowed).toBe(false);
  });

  it('daily limit releases after 24 hours', () => {
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    const u = 'u-dailyrel-' + Math.random();
    for (let i = 0; i < 50; i++) recordChatSend(u);
    expect(checkChatRate(u).allowed).toBe(false);
    vi.setSystemTime(new Date('2026-07-02T00:00:01Z')); // +24h + 1s
    expect(checkChatRate(u).allowed).toBe(true);
  });

  it('per-user buckets are independent', () => {
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    const alice = 'alice-' + Math.random();
    const bob = 'bob-' + Math.random();
    // Burn alice's burst.
    for (let i = 0; i < 5; i++) recordChatSend(alice);
    expect(checkChatRate(alice).allowed).toBe(false);
    // Bob is unaffected.
    expect(checkChatRate(bob).allowed).toBe(true);
    recordChatSend(bob);
  });
});