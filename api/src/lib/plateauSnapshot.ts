import { prisma } from './prisma.js';
import { detectPlateaus } from './plateau.js';

/**
 * Compute the Sunday-of-week (YYYY-MM-DD) for `now` in the user's
 * local timezone. Sunday is day 0 of the week; the returned key is
 * the local-date string for that Sunday at 00:00.
 *
 * Used to key PlateauSnapshot + ExamenResponse rows so we get one
 * row per user per week (UPSERT-friendly) regardless of when
 * during the week the cron / save fires.
 */
export function sundayOfWeek(now: Date, timezone: string | null): string {
  const tz = timezone || 'UTC';
  // Pull YYYY-MM-DD for the user's local "now".
  const localKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  // Get day-of-week for that local date.
  const [y, m, d] = localKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 = Sun
  // Walk back to the most recent Sunday.
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

/**
 * Run detectPlateaus for a single user and persist the result to
 * PlateauSnapshot (UPSERT on userId + weekStart). Returns the
 * snapshot row so the cron can log the flag count.
 *
 * Called by the weekly cron in api/src/index.ts (Sunday 22:00
 * local) AND by /plateaus/snapshot POST for an immediate refresh.
 */
export async function refreshPlateauSnapshot(
  userId: string,
  timezone: string | null,
  now: Date = new Date(),
): Promise<{ weekStart: string; flagCount: number }> {
  const weekStart = sundayOfWeek(now, timezone);
  const plateaus = await detectPlateaus(userId, now);
  const row = await prisma.plateauSnapshot.upsert({
    where: { userId_weekStart: { userId, weekStart } },
    create: {
      userId,
      weekStart,
      plateaus: JSON.stringify(plateaus),
      flagCount: plateaus.length,
      generatedAt: now,
    },
    update: {
      plateaus: JSON.stringify(plateaus),
      flagCount: plateaus.length,
      generatedAt: now,
    },
  });
  return { weekStart, flagCount: row.flagCount };
}

/**
 * Run refreshPlateauSnapshot for every active user. Called once a
 * week by the cron. Returns aggregate counts so the cron can log
 * "scanned 3 users, 2 flagged, 1 clean".
 *
 * Iterates all users in a single query + N small queries (one
 * detectPlateaus per user). For ~1 user this is trivial; if the
 * user base ever grows into thousands we'd want to batch or
 * priority-queue by last-active date.
 */
export async function refreshAllPlateauSnapshots(
  now: Date = new Date(),
): Promise<{ usersScanned: number; usersFlagged: number; totalFlags: number }> {
  const users = await prisma.user.findMany({
    select: { id: true, timezone: true },
  });
  let flagged = 0;
  let totalFlags = 0;
  for (const u of users) {
    try {
      const r = await refreshPlateauSnapshot(u.id, u.timezone, now);
      totalFlags += r.flagCount;
      if (r.flagCount > 0) flagged++;
    } catch (err) {
      // One user's detector failure shouldn't poison the batch.
      // Log and continue; the next weekly cron will retry.
      console.warn(`[plateau-cron] user ${u.id} failed:`, err);
    }
  }
  return { usersScanned: users.length, usersFlagged: flagged, totalFlags };
}
