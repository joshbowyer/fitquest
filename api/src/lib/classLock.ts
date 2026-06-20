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

export const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
export const CLASS_LOCK_MS = ONE_YEAR_MS;

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


/**
 * Find the first birthday (same month/day as birthDate) that occurs
 * after the given classChangedAt. Walks year by year from the change
 * date forward.
 */
function firstBirthdayAfter(
  classChangedAt: Date,
  birthDate: Date,
  _now: Date = new Date(),
): Date {
  // Start with the birthday in the year of the change
  const candidate = new Date(
    classChangedAt.getFullYear(),
    birthDate.getMonth(),
    birthDate.getDate(),
    birthDate.getHours(),
    birthDate.getMinutes(),
    birthDate.getSeconds(),
    birthDate.getMilliseconds(),
  );
  // If the change happened after the birthday in that year, the
  // next unlock is the following year's birthday.
  if (candidate.getTime() <= classChangedAt.getTime()) {
    return new Date(
      classChangedAt.getFullYear() + 1,
      birthDate.getMonth(),
      birthDate.getDate(),
      birthDate.getHours(),
      birthDate.getMinutes(),
      birthDate.getSeconds(),
      birthDate.getMilliseconds(),
    );
  }
  return candidate;
}

// Class Evolution Tree — mirrors the web side.
// Each line has 3 stages; stage is derived from user level.
const CLASS_EVOLUTION: Record<string, [string, string, string]> = {
  JUGGERNAUT: ['Bruiser', 'Strongman', 'Juggernaut'],
  PHANTOM:    ['Striker', 'Acrobat', 'Phantom'],
  SCOUT:      ['Hiker', 'Trailblazer', 'Scout'],
  BERSERKER:  ['Brawler', 'Marazer', 'Berserker'],
  ORACLE:     ['Initiate', 'Acolyte', 'Oracle'],
};

function getStage(level: number): 1 | 2 | 3 {
  if (level >= 25) return 3;
  if (level >= 10) return 2;
  return 1;
}

export function getClassDisplayName(line: string | null, level: number): string {
  if (!line) return 'Unclassed';
  const evo = CLASS_EVOLUTION[line as keyof typeof CLASS_EVOLUTION];
  if (!evo) return line;
  const stage = getStage(level);
  return stage >= 1 && stage <= 3 ? evo[stage - 1]! : evo[0]!;
}

export function getNextPromotion(line: string | null, level: number): { nextStage: number; threshold: number } | null {
  if (!line) return null;
  const stage = getStage(level);
  if (stage >= 3) return null;
  const ths: [number, number] = [10, 25];
  const idx = stage - 1;
  return { nextStage: stage + 1, threshold: ths[idx]! };
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

  // Birthday-based unlock if we have a birthDate. The user can change
  // their class on/after the first birthday that occurs AFTER
  // classChangedAt. So if they changed on June 1, 2025 and their
  // birthday is Jan 19, the next unlock is Jan 19, 2026.
  if (birthDate) {
    const nextUnlock = firstBirthdayAfter(classChangedAt, birthDate, now);
    if (nextUnlock.getTime() <= now.getTime()) {
      return {
        locked: false,
        remainingMs: 0,
        unlockAt: null,
        remainingLabel: '',
        canUseSoulstone: false,
        birthdayUnlock: true,
        nextBirthdayAt: nextUnlock.toISOString(),
      };
    }
    const remaining = nextUnlock.getTime() - now.getTime();
    return {
      locked: true,
      remainingMs: remaining,
      unlockAt: nextUnlock.toISOString(),
      remainingLabel: daysLabel(remaining),
      canUseSoulstone: soulstones > 0,
      birthdayUnlock: true,
      nextBirthdayAt: nextUnlock.toISOString(),
    };
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
