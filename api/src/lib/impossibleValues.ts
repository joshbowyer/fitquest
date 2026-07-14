import { PrismaRuntime, prisma } from './prisma.js';

/**
 * Shape mirrors the ValidityFlag type in workouts.ts. Re-declared
 * here rather than imported so the morning-report lib stays
 * independent of the routes module (avoid circular deps).
 */
export type StoredValidityFlag = {
  exercise: string;
  setIndex: number;
  field: 'weight' | 'reps';
  value: number;
  reason?: string;
  severity?: 'flag' | 'block';
};

export type ImpossibleValueItem = {
  workoutId: string;
  workoutName: string | null;
  exercise: string;
  setIndex: number;
  field: 'weight' | 'reps';
  value: number;
  unit: 'kg' | 'lb' | 'reps';
  reason: string;
  severity: 'flag' | 'block';
  occurredAt: string; // ISO
};

function isStoredValidityFlag(value: unknown): value is StoredValidityFlag {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!('exercise' in value) || typeof value.exercise !== 'string') return false;
  if (!('setIndex' in value) || typeof value.setIndex !== 'number') return false;
  if (!('field' in value) || (value.field !== 'weight' && value.field !== 'reps')) return false;
  if (!('value' in value) || typeof value.value !== 'number') return false;
  if ('reason' in value && value.reason !== undefined && typeof value.reason !== 'string') return false;
  if (
    'severity' in value &&
    value.severity !== undefined &&
    value.severity !== 'flag' &&
    value.severity !== 'block'
  ) return false;
  return true;
}

/**
 * Aggregate flagged sets from the user's last N hours of workouts.
 * Used by the morning report to surface implausible values that the
 * per-exercise plausibility detector caught on commit. Without this,
 * a typo (e.g. 1350 lb typed instead of 135 lb) gets stored, used to
 * compute PRs, and then quietly skews the LLM narrative — the user
 * only sees the ⚠ chip on the activity detail page the day of, then
 * it scrolls off.
 *
 * Window: 36 hours back from `now`. Slightly wider than the standard
 * "last 24h" so the morning report on day N still catches a flag from
 * the late evening of day N-1 (a 11pm workout, morning report at 7am).
 *
 * Returns an empty array when:
 *   - the user has no workouts in the window
 *   - no workout in the window has any validityFlags
 *   - all stored flag JSON is corrupt (caught per-row)
 */
export async function impossibleValuesDomain(
  userId: string,
  now: Date = new Date(),
  windowHours: number = 36,
): Promise<ImpossibleValueItem[]> {
  const cutoff = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const workouts = await prisma.workout.findMany({
    where: {
      userId,
      performedAt: { gte: cutoff },
      // Prisma's JSONB null filter is awkward — we want only rows
      // where validityFlags is NOT NULL. The `not: null` form works
      // in Prisma 5+ for nullable JSON columns. The previous
      // `equals: undefined` was a no-op and matched everything.
      validityFlags: { not: PrismaRuntime.AnyNull },
    },
    select: {
      id: true,
      name: true,
      performedAt: true,
      validityFlags: true,
    },
    orderBy: { performedAt: 'desc' },
  });
  const out: ImpossibleValueItem[] = [];
  for (const w of workouts) {
    let flags: StoredValidityFlag[] = [];
    try {
      const parsed = w.validityFlags;
      if (Array.isArray(parsed)) {
        flags = parsed.filter(isStoredValidityFlag);
      }
    } catch {
      continue;
    }
    for (const f of flags) {
      out.push({
        workoutId: w.id,
        workoutName: w.name ?? null,
        exercise: f.exercise,
        setIndex: f.setIndex,
        field: f.field,
        value: f.value,
        unit: f.field === 'reps' ? 'reps' : 'kg',
        reason: f.reason ?? 'implausible',
        severity: f.severity === 'block' ? 'block' : 'flag',
        occurredAt: w.performedAt.toISOString(),
      });
    }
  }
  // Sort most-recent first so the report surfaces the freshest issue.
  out.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return out;
}
