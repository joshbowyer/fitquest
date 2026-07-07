import type { User } from './prisma.js';
import { localDayKey, localMidnightUtc } from './timezone.js';

/**
 * Class lock rules. The user can change their class once a year, on (or
 * after) their birthday. If their birthday isn't on file, fall back to
 * 365 days from the last class change.
 *
 * Soulstones are the early-unlock item. Each Soulstone row in the
 * Soulstone table is one consumable that bypasses the cooldown once.
 * Soulstones drop from world bosses (any boss always drops one)
 * with a 24h TTL — if not used, the row "disintegrates" (queries
 * filter by expiresAt > now, so an expired row is invisible).
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
  /** Number of unconsumed + non-expired Soulstone rows the user holds. */
  soulstoneCount: number;
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
 *
 * The original implementation read month/day/hour/minute/second off
 * the DB Date with `getMonth()/getDate()/getHours()` — those return
 * SERVER-local values (UTC in Docker), not the user's tz. For a
 * user born Sep 15 12:00 EDT, the DB stores Sep 15 16:00 UTC, and
 * getDate() returns 15 only by coincidence — getHours() returns 16,
 * not 12, and the constructed anniversary is off by the tz offset.
 *
 * tz-aware version: extract month/day/hour/etc. in the user's tz via
 * Intl.DateTimeFormat, then construct the anniversary as local-midnight
 * UTC + time-of-day offset.
 */
export function nextBirthday(
  birthDate: Date | null | undefined,
  now: Date = new Date(),
  tz: string | null = null,
): Date | null {
  if (!birthDate) return null;
  const bdayLocal = localDayKey(birthDate, tz); // YYYY-MM-DD in tz
  const [bMonth, bDay] = [Number(bdayLocal.slice(5, 7)), Number(bdayLocal.slice(8, 10))];
  const tod = timeOfDayInTz(birthDate, tz);
  const thisYear = Number(localDayKey(now, tz).slice(0, 4));
  const candidate = anniversaryUtc(thisYear, bMonth, bDay, tod, tz);
  if (candidate.getTime() > now.getTime()) return candidate;
  // Already passed this year — next year's
  return anniversaryUtc(thisYear + 1, bMonth, bDay, tod, tz);
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
  tz: string | null = null,
): Date {
  const bdayLocal = localDayKey(birthDate, tz);
  const [bMonth, bDay] = [Number(bdayLocal.slice(5, 7)), Number(bdayLocal.slice(8, 10))];
  const tod = timeOfDayInTz(birthDate, tz);
  const startYear = Number(localDayKey(classChangedAt, tz).slice(0, 4));
  const candidate = anniversaryUtc(startYear, bMonth, bDay, tod, tz);
  if (candidate.getTime() > classChangedAt.getTime()) return candidate;
  return anniversaryUtc(startYear + 1, bMonth, bDay, tod, tz);
}

/// Extract just the time-of-day portion (H+M+S+ms) of `d` in `tz`.
/// Returned in ms-since-midnight local time so callers can add it
/// to a local-midnight UTC instant.
function timeOfDayInTz(d: Date, tz: string | null): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz ?? 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const h = get('hour') === 24 ? 0 : get('hour');
  return h * 3600_000 + get('minute') * 60_000 + get('second') * 1000;
}

/// Construct the UTC instant of an anniversary (year/month/day at
/// time-of-day) in the user's tz.
function anniversaryUtc(
  year: number,
  month: number,
  day: number,
  todMs: number,
  tz: string | null,
): Date {
  const midnight = localMidnightUtc(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    tz ?? 'UTC',
  );
  return new Date(midnight.getTime() + todMs);
}

// Class Evolution Tree — mirrors the web side.
// Each line has 3 stages; stage is derived from user level.
const CLASS_EVOLUTION: Record<string, [string, string, string]> = {
  JUGGERNAUT: ['Bruiser', 'Strongman', 'Juggernaut'],
  PHANTOM:    ['Striker', 'Acrobat', 'Phantom'],
  SCOUT:      ['Hiker', 'Trailblazer', 'Scout'],
  BERSERKER:  ['Brawler', 'Marauder', 'Berserker'],
  TRACER:     ['Dash', 'Blur', 'Tracer'],
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
  soulstoneCount: number = 0,
  now: Date = new Date(),
  tz: string | null = null,
): ClassLockStatus {
  // No class picked yet, or no change recorded: free to pick.
  if (!userClass || !classChangedAt) {
    return {
      locked: false,
      remainingMs: 0,
      unlockAt: null,
      remainingLabel: '',
      canUseSoulstone: false,
      soulstoneCount,
      birthdayUnlock: false,
      nextBirthdayAt: null,
    };
  }

  // Birthday-based unlock if we have a birthDate. The user can change
  // their class on/after the first birthday that occurs AFTER
  // classChangedAt. So if they changed on June 1, 2025 and their
  // birthday is Jan 19, the next unlock is Jan 19, 2026.
  if (birthDate) {
    const nextUnlock = firstBirthdayAfter(classChangedAt, birthDate, now, tz);
    if (nextUnlock.getTime() <= now.getTime()) {
      return {
        locked: false,
        remainingMs: 0,
        unlockAt: null,
        remainingLabel: '',
        canUseSoulstone: false,
        soulstoneCount,
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
      canUseSoulstone: soulstoneCount > 0,
      soulstoneCount,
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
      soulstoneCount,
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
    canUseSoulstone: soulstoneCount > 0,
    soulstoneCount,
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
 *
 * Note: the caller is responsible for consuming the Soulstone row
 * (via prisma.soulstone.update({ consumed: true, consumedAt: now }))
 * AFTER calling this with useSoulstone: true. The lib is pure — it
 * doesn't write to the DB itself.
 */
export function assertCanChangeClass(
  user: Pick<User, 'class' | 'classChangedAt' | 'birthDate'>,
  newClass: string | null,
  soulstoneCount: number = 0,
  tz: string | null = null,
  now: Date = new Date(),
): { useSoulstone: boolean } {
  if (!newClass) return { useSoulstone: false };
  if (user.class === newClass) return { useSoulstone: false };
  const status = getClassLockStatus(user.class, user.classChangedAt, user.birthDate, soulstoneCount, now, tz);
  if (!status.locked) return { useSoulstone: false };
  if (status.canUseSoulstone) return { useSoulstone: true };
  const err: any = new Error(
    `Class is locked. You can change again on your birthday${status.birthdayUnlock ? '' : ' (annually)'}, or spend a Soulstone.`,
  );
  err.statusCode = 423;
  err.classLock = status;
  throw err;
}
