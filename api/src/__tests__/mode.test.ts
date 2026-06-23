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
  it('is 8 hours in ms', () => {
    expect(HEART_REGEN_MS).toBe(8 * 60 * 60 * 1000);
  });
});

describe('HARDCORE_SUBSTANCE_CAPS', () => {
  it('has caffeine and alcohol thresholds', () => {
    expect(HARDCORE_SUBSTANCE_CAPS.caffeinePerDay).toBe(3);
    expect(HARDCORE_SUBSTANCE_CAPS.alcoholPerWeek).toBe(5);
  });
});

describe('heartMultiplier', () => {
  it('returns 1.0 for any heart count >= 1', () => {
    expect(heartMultiplier(5)).toBe(1.0);
    expect(heartMultiplier(3)).toBe(1.0);
    expect(heartMultiplier(1)).toBe(1.0);
  });

  it('returns 0.5 for 0 hearts', () => {
    expect(heartMultiplier(0)).toBe(0.5);
  });

  it('handles edge cases gracefully', () => {
    expect(heartMultiplier(-1)).toBe(0.5); // clamped to 0
    expect(heartMultiplier(10)).toBe(1.0); // over max, still full
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