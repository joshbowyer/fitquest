import type { User } from '@prisma/client';

/**
 * Class lock cooldown. After picking (or re-picking) a class, the user
 * must wait this long before they can change again. 7 days feels short
 * enough to encourage commitment, long enough to actually test a class
 * before swapping. Eventually we can have a Soulstone item that unlocks
 * an early change, but for now it's purely time-based.
 */
export const CLASS_LOCK_DAYS = 7;
export const CLASS_LOCK_MS = CLASS_LOCK_DAYS * 24 * 60 * 60 * 1000;

export type ClassLockStatus = {
  locked: boolean;
  /** ms until unlock; 0 if not locked. */
  remainingMs: number;
  /** ISO timestamp when the lock expires; null if not locked. */
  unlockAt: string | null;
  /** Human-friendly "wait N days" string. */
  remainingLabel: string;
};

export function getClassLockStatus(
  userClass: string | null,
  classChangedAt: Date | null | undefined,
  now: Date = new Date(),
): ClassLockStatus {
  // No class picked yet, or no change recorded: free to pick.
  if (!userClass || !classChangedAt) {
    return { locked: false, remainingMs: 0, unlockAt: null, remainingLabel: '' };
  }
  const elapsed = now.getTime() - classChangedAt.getTime();
  const remaining = CLASS_LOCK_MS - elapsed;
  if (remaining <= 0) {
    return { locked: false, remainingMs: 0, unlockAt: null, remainingLabel: '' };
  }
  const unlockAt = new Date(classChangedAt.getTime() + CLASS_LOCK_MS);
  // Friendly label
  const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  const hours = Math.ceil(remaining / (60 * 60 * 1000));
  const label =
    days >= 1
      ? `${days} day${days === 1 ? '' : 's'}`
      : `${hours} hour${hours === 1 ? '' : 's'}`;
  return {
    locked: true,
    remainingMs: remaining,
    unlockAt: unlockAt.toISOString(),
    remainingLabel: label,
  };
}

/**
 * Throws if the user is currently class-locked. Returns the new class
 * (or null) otherwise. Centralized so the PATCH route is the only place
 * the rule lives.
 */
export function assertCanChangeClass(user: Pick<User, 'class' | 'classChangedAt'>, newClass: string | null): void {
  if (!newClass) return; // null/undefined means "no change"
  if (user.class === newClass) return; // no-op, free
  const status = getClassLockStatus(user.class, user.classChangedAt);
  if (status.locked) {
    const err: any = new Error(
      `Class is locked. You can change again in ${status.remainingLabel}. (Earn a Soulstone drop to unlock early.)`,
    );
    err.statusCode = 423; // Locked (WebDAV-ish, but fits)
    err.classLock = status;
    throw err;
  }
}
