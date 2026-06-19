import type { User } from '@prisma/client';

/**
 * Class lock rules. The user can change their class once a year, on (or
 * after) their birthday. If their birthday isn't on file, fall back to
 * 365 days from the last class change.
 *
 * Soulstones are the early-unlock item. Each stone lets the user bypass
 * the cooldown once. Soulstones are awarded rarely from raid victories.
 */
export type ClassLockStatus = {
  locked: boolean;
  /** ms until unlock; 0 if not locked. */
  remainingMs: number;
  /** ISO timestamp when the lock expires; null if not locked. */
  unlockAt: string | null;
  /** Human-friendly "wait N days" string. */
  remainingLabel: string;
  /** True if the user can spend a Soulstone to change early. */
  canUseSoulstone: boolean;
  /** True if the cooldown is tied to the next birthday. */
  birthdayUnlock: boolean;
  /** ISO of the user's next birthday (this year or next). */
  nextBirthdayAt: string | null;
};

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Compute the next birthday (this year if still upcoming, next year
 * otherwise). Returns null if no birthDate provided.
 */
export function nextBirthday(birthDate: Date | null | undefined, now: Date = new Date()): Date | null {
  if (!birthDate) return null;
  const bday = new Date(birthDate);
  // Set the birthday to this year, time-of-day preserved
  const thisYear = new Date(now.getFullYear(), bday.getMonth(), bday.getDate(), bday.getHours(), bday.getMinutes(), bday.getSeconds(), bday.getMilliseconds());
  if (thisYear.getTime() > now.getTime()) return thisYear;
  // Already passed this year — next year's
  return new Date(now.getFullYear() + 1, bday.getMonth(), bday.getDate(), bday.getHours(), bday.getMinutes(), bday.getSeconds(), bday.getMilliseconds());
}

export function getClassLockStatus(
  userClass: string | null,
  classChangedAt: Date | null | undefined,
  birthDate?: Date | null,
  soulstones: number = 0,
  now: Date = new Date(),
): ClassLockStatus {
  // No class picked yet, or no change recorded: free to pick.
  if (!userClass || !classChangedAt) {
    return {
      locked: false,
      remainingMs: 0,
      unlockAt: null,
      remainingLabel: '',
      canUseSoulstone: false,
      birthdayUnlock: false,
      nextBirthdayAt: null,
    };
  }

  // Birthday-based unlock if we have a birthDate
  if (birthDate) {
    const bday = nextBirthday(birthDate, now);
    if (bday && bday.getTime() <= classChangedAt.getTime() + 1000) {
      // Birthday is the same day or after the change — use the next one
      // (i.e. the next anniversary).
    }
    // The user can change freely on their birthday (the annual class
    // change window). Compare: is the next birthday <= now?
    // If yes, unlocked. If no, locked until that birthday.
    if (bday && bday.getTime() <= now.getTime()) {
      return {
        locked: false,
        remainingMs: 0,
        unlockAt: null,
        remainingLabel: '',
        canUseSoulstone: false,
        birthdayUnlock: true,
        nextBirthdayAt: bday.toISOString(),
      };
    }
    if (bday) {
      const remaining = bday.getTime() - now.getTime();
      return {
        locked: true,
        remainingMs: remaining,
        unlockAt: bday.toISOString(),
        remainingLabel: daysLabel(remaining),
        canUseSoulstone: soulstones > 0,
        birthdayUnlock: true,
        nextBirthdayAt: bday.toISOString(),
      };
    }
  }

  // Fallback: 365 days from classChangedAt
  const unlockAt = new Date(classChangedAt.getTime() + ONE_YEAR_MS);
  if (unlockAt.getTime() <= now.getTime()) {
    return {
      locked: false,
      remainingMs: 0,
      unlockAt: null,
      remainingLabel: '',
      canUseSoulstone: false,
      birthdayUnlock: false,
      nextBirthdayAt: null,
    };
  }
  const remaining = unlockAt.getTime() - now.getTime();
  return {
    locked: true,
    remainingMs: remaining,
    unlockAt: unlockAt.toISOString(),
    remainingLabel: daysLabel(remaining),
    canUseSoulstone: soulstones > 0,
    birthdayUnlock: false,
    nextBirthdayAt: null,
  };
}

function daysLabel(ms: number): string {
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days >= 30) {
    const months = Math.floor(days / 30);
    const rem = days % 30;
    return rem > 0 ? `${months}mo ${rem}d` : `${months}mo`;
  }
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Throws if the user is currently class-locked and has no Soulstone to
 * bypass. Returns null otherwise. The error includes the lock status so
 * the UI can show "wait N days" or "use a Soulstone".
 */
export function assertCanChangeClass(
  user: Pick<User, 'class' | 'classChangedAt' | 'birthDate' | 'soulstones'>,
  newClass: string | null,
): { useSoulstone: boolean } {
  if (!newClass) return { useSoulstone: false };
  if (user.class === newClass) return { useSoulstone: false };
  const status = getClassLockStatus(user.class, user.classChangedAt, user.birthDate, user.soulstones);
  if (!status.locked) return { useSoulstone: false };
  if (status.canUseSoulstone) return { useSoulstone: true };
  const err: any = new Error(
    `Class is locked. You can change again on your birthday${status.birthdayUnlock ? '' : ' (annually)'}, or spend a Soulstone.`,
  );
  err.statusCode = 423;
  err.classLock = status;
  throw err;
}
