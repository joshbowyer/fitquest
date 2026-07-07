import { describe, it, expect } from 'vitest';
import {
  getClassLockStatus,
  nextBirthday,
  assertCanChangeClass,
  CLASS_LOCK_MS,
} from '../lib/classLock.js';

const NOW = new Date('2026-06-19T15:00:00Z'); // Fixed for deterministic tests
const BIRTHDAY = new Date('1990-01-19T00:00:00Z'); // User's actual bday

describe('nextBirthday', () => {
  it('returns this year if birthday has not passed yet', () => {
    // Use UTC construction to dodge local-timezone off-by-one.
    const bday = new Date(Date.UTC(1990, 11, 25));
    const result = nextBirthday(bday, NOW);
    expect(result).not.toBeNull();
    expect(result!.getUTCFullYear()).toBe(2026);
    expect(result!.getUTCMonth()).toBe(11);
    expect(result!.getUTCDate()).toBe(25);
  });

  it('returns next year if birthday has already passed this year', () => {
    const bday = new Date('1990-01-19');
    const result = nextBirthday(bday, NOW);
    expect(result!.getFullYear()).toBe(2027);
  });

  it('returns null if no birthDate provided', () => {
    expect(nextBirthday(null, NOW)).toBeNull();
    expect(nextBirthday(undefined, NOW)).toBeNull();
  });
});

describe('getClassLockStatus', () => {
  it('returns unlocked when no class is set', () => {
    const status = getClassLockStatus(null, null, BIRTHDAY, 0, NOW);
    expect(status.locked).toBe(false);
    expect(status.canUseSoulstone).toBe(false);
  });

  it('returns unlocked when no classChangedAt is set', () => {
    const status = getClassLockStatus('PHANTOM', null, BIRTHDAY, 0, NOW);
    expect(status.locked).toBe(false);
  });

  it('locks when class recently changed and birthday is upcoming', () => {
    const oneWeekAgo = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
    const status = getClassLockStatus('PHANTOM', oneWeekAgo, BIRTHDAY, 0, NOW);
    expect(status.locked).toBe(true);
    // Birthday is Jan 19 — already passed this year, so unlocks next year
    expect(status.birthdayUnlock).toBe(true);
    // The next birthday is Jan 19, 2027
    expect(status.unlockAt).toBe(new Date('2027-01-19T00:00:00Z').toISOString());
  });

  it('unlocks when today is on or after the birthday (the birthday window)', () => {
    // Class was changed in 2024; by 2026-Jan-19 the user can change again
    const classChanged2024 = new Date('2024-06-01');
    const onBirthday = new Date('2026-01-19T15:00:00Z');
    const status = getClassLockStatus('PHANTOM', classChanged2024, BIRTHDAY, 0, onBirthday);
    expect(status.locked).toBe(false);
  });

  it('shows canUseSoulstone when user has at least one stone and is locked', () => {
    const oneWeekAgo = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
    const status = getClassLockStatus('PHANTOM', oneWeekAgo, BIRTHDAY, 1, NOW);
    expect(status.locked).toBe(true);
    expect(status.canUseSoulstone).toBe(true);
  });

  it('does not show canUseSoulstone when user has zero stones', () => {
    const oneWeekAgo = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
    const status = getClassLockStatus('PHANTOM', oneWeekAgo, BIRTHDAY, 0, NOW);
    expect(status.locked).toBe(true);
    expect(status.canUseSoulstone).toBe(false);
  });

  it('falls back to 365 days when no birthDate is on file', () => {
    const oneWeekAgo = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
    const status = getClassLockStatus('PHANTOM', oneWeekAgo, null, 0, NOW);
    expect(status.locked).toBe(true);
    expect(status.birthdayUnlock).toBe(false);
    // Unlock at oneWeekAgo + 365 days
    const expectedUnlock = new Date(oneWeekAgo.getTime() + CLASS_LOCK_MS);
    expect(new Date(status.unlockAt!).getTime()).toBe(expectedUnlock.getTime());
  });

  it('365-day fallback unlocks when the year has passed', () => {
    const longAgo = new Date(NOW.getTime() - 400 * 24 * 60 * 60 * 1000);
    const status = getClassLockStatus('PHANTOM', longAgo, null, 0, NOW);
    expect(status.locked).toBe(false);
  });
});

describe('assertCanChangeClass', () => {
  // Soulstone count is an explicit argument (3rd param) — it comes
  // from counting active Soulstone rows in the route (users.ts), not
  // from a field on the user. The old fixture carried a stale
  // `soulstones` field from the pre-relation design, which the
  // implementation (correctly) ignored — making the "has a
  // soulstone" test fail forever.
  // NOW is pinned (5th param) so these tests don't depend on the
  // real clock — the "locked" fixtures would otherwise start
  // passing/failing differently once the next birthday rolls by.
  const user = {
    class: 'PHANTOM' as any,
    classChangedAt: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000),
    birthDate: BIRTHDAY,
  };

  it('returns { useSoulstone: false } when no class change requested', () => {
    expect(assertCanChangeClass(user, null, 0, null, NOW)).toEqual({ useSoulstone: false });
  });

  it('returns { useSoulstone: false } when changing to same class', () => {
    expect(assertCanChangeClass(user, 'PHANTOM', 0, null, NOW)).toEqual({ useSoulstone: false });
  });

  it('returns { useSoulstone: false } when unlocked (birthday reached)', () => {
    // Class was changed last year, well before the Jan 19 2026
    // birthday. By NOW (June 19 2026) the birthday window is open.
    const unlocked = {
      ...user,
      classChangedAt: new Date('2025-06-01'),
    };
    expect(assertCanChangeClass(unlocked, 'JUGGERNAUT', 0, null, NOW)).toEqual({ useSoulstone: false });
  });

  it('returns { useSoulstone: true } when locked but user has a soulstone', () => {
    expect(assertCanChangeClass(user, 'JUGGERNAUT', 1, null, NOW)).toEqual({ useSoulstone: true });
  });

  it('throws 423 with classLock when locked and no soulstone', () => {
    try {
      assertCanChangeClass(user, 'JUGGERNAUT', 0, null, NOW);
      expect.fail('Should have thrown');
    } catch (e: any) {
      expect(e.statusCode).toBe(423);
      expect(e.classLock).toBeDefined();
      expect(e.classLock.locked).toBe(true);
      expect(e.classLock.canUseSoulstone).toBe(false);
    }
  });
});
