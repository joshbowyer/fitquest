/**
 * Tests for the Casual/Hardcore mode lib. Heart regen timing is
 * pure logic (no DB) so we can test it without spinning up Prisma.
 *
 * The full DB-backed functions (tickHearts, loseHeart) are
 * integration-tested via the running app's /users/me endpoint.
 */
import { describe, it, expect } from 'vitest';
import {
  HEART_REGEN_MS,
  HARDCORE_SUBSTANCE_CAPS,
  heartMultiplier,
  hardcoreSubstanceCapReason,
} from '../lib/mode';

describe('HEART_REGEN_MS', () => {
  it('is 1 week in ms (Sunday-anchored regeneration per mode.ts)', () => {
    expect(HEART_REGEN_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('HARDCORE_SUBSTANCE_CAPS', () => {
  it('has caffeine and alcohol thresholds', () => {
    expect(HARDCORE_SUBSTANCE_CAPS.caffeinePerDay).toBe(3);
    expect(HARDCORE_SUBSTANCE_CAPS.alcoholPerWeek).toBe(5);
  });
});

describe('heartMultiplier', () => {
  // Graduated Hardcore curve introduced in 021082d (hearts 5→10).
  // The old tests asserted the pre-graduated binary system
  // (>=1 → 1.0, 0 → 0.5) and were never updated with the redesign.
  it('applies the graduated Hardcore curve from the mode.ts table', () => {
    expect(heartMultiplier(10)).toBe(1.0);
    expect(heartMultiplier(9)).toBe(0.95);
    expect(heartMultiplier(8)).toBe(0.9);
    expect(heartMultiplier(7)).toBe(0.85);
    expect(heartMultiplier(6)).toBe(0.8);
    expect(heartMultiplier(5)).toBe(0.7);
    expect(heartMultiplier(4)).toBe(0.6);
    expect(heartMultiplier(3)).toBe(0.5);
    expect(heartMultiplier(2)).toBe(0.4);
    expect(heartMultiplier(1)).toBe(0.25);
  });

  it('returns 0 at 0 hearts — no progress at all', () => {
    expect(heartMultiplier(0)).toBe(0);
  });

  it('handles out-of-range counts gracefully', () => {
    expect(heartMultiplier(-1)).toBe(0); // below 0 → treated as 0
    expect(heartMultiplier(11)).toBe(1.0); // above max → full credit
  });

  it('CASUAL mode never applies a penalty', () => {
    expect(heartMultiplier(0, 'CASUAL')).toBe(1.0);
    expect(heartMultiplier(5, 'CASUAL')).toBe(1.0);
    expect(heartMultiplier(10, 'CASUAL')).toBe(1.0);
  });
});

describe('hardcoreSubstanceCapReason', () => {
  it('returns null when under all caps', () => {
    const reason = hardcoreSubstanceCapReason({
      caffeineLast24h: 2,
      alcoholLast7d: 3,
    });
    expect(reason).toBeNull();
  });

  it('flags caffeine when over daily cap', () => {
    const reason = hardcoreSubstanceCapReason({
      caffeineLast24h: 5,
      alcoholLast7d: 1,
    });
    expect(reason).toContain('espressos');
  });

  it('flags alcohol when over weekly cap', () => {
    const reason = hardcoreSubstanceCapReason({
      caffeineLast24h: 1,
      alcoholLast7d: 8,
    });
    expect(reason).toContain('drinks');
  });

  it('combines both caps when both exceeded', () => {
    const reason = hardcoreSubstanceCapReason({
      caffeineLast24h: 6,
      alcoholLast7d: 9,
    });
    expect(reason).toContain('espressos');
    expect(reason).toContain('drinks');
  });

  it('returns null at exactly the cap (boundary)', () => {
    // At exactly 3 espressos and 5 drinks, no cap triggered.
    // The check uses strict >, so the boundary value passes.
    const reason = hardcoreSubstanceCapReason({
      caffeineLast24h: 3,
      alcoholLast7d: 5,
    });
    expect(reason).toBeNull();
  });
});