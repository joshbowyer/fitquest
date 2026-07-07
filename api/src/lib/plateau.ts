/**
 * Anti-staleness plateau detector.
 *
 * Surfaces signals that the user's training is coasting, regressing,
 * or stuck. Each heuristic returns 0 or 1 Plateau entry; we never
 * spam the user with overlapping flags on the same axis.
 *
 * Heuristics (each can produce one entry):
 *  - NO_PR_RECENT          — No PR recorded in N days (warn 21, scold 45)
 *  - ONE_RM_REGRESSION     — Best set in last 14d ≥5% below 28d peak (scold)
 *  - VOLUME_REGRESSION     — Weekly volume dropped ≥20% vs 28d baseline (warn)
 *  - WEIGHT_FLATLINE       — Body weight <0.3 kg drift over 14d on CUT/MAINTAIN
 *  - METRIC_FLATLINE       — HRV + sleep both <3% delta over 14d with high training load
 *
 * Pause support: the user can mute individual kinds (or ALL) via
 * the PlateauPause model. While a pause is active (resumeAt > now),
 * the matching heuristic is skipped. Pauses are pulled automatically
 * inside detectPlateaus; callers don't need to pass them in.
 *
 * Returns `[]` for users with no training history (new accounts) or
 * when there isn't enough data to confidently call something stale —
 * false positives are worse than misses here.
 *
 * Same shape as Penalty (label + severity + note) so the UI can
 * reuse the LedgerRow component.
 */

import { prisma } from './prisma.js';
import { setVolumeKg } from './exerciseVolume.js';

// ---- Thresholds (tune here; tests pin these) ----

/** Days since last PR — at this point we warn. */
export const NO_PR_WARN_DAYS = 21;
/** Days since last PR — at this point we scold. */
export const NO_PR_SCOLD_DAYS = 45;
/** Minimum number of lifetime PRs before NO_PR_RECENT can fire. */
export const NO_PR_MIN_LIFETIME_PRS = 3;

/** % drop from 28d peak to best set in last 14d that triggers a scold. */
export const ONE_RM_REGRESSION_PCT = 5;
/** Days to compare peak against. */
export const ONE_RM_PEAK_WINDOW_DAYS = 28;
/** Days to look for the recent best set. */
export const ONE_RM_RECENT_WINDOW_DAYS = 14;
/** Main lifts we track for 1RM regression. */
export const TRACKED_MAIN_LIFTS = ['Bench Press', 'Squat', 'Deadlift'] as const;

/** Canonical list of plateau kinds + the special `ALL` pause kind.
 *  Order matters — the UI uses it to render the picker consistently. */
export const PLATEAU_KINDS = [
  'NO_PR_RECENT',
  'ONE_RM_REGRESSION',
  'VOLUME_REGRESSION',
  'WEIGHT_FLATLINE',
  'METRIC_FLATLINE',
  'ALL',
] as const;

/** % drop in weekly volume that triggers a warn. */
export const VOLUME_REGRESSION_PCT = 20;
/** Days for the recent volume window. */
export const VOLUME_RECENT_DAYS = 7;
/** Days for the baseline volume window. */
export const VOLUME_BASELINE_DAYS = 28;
/** Minimum historical workouts per week before we trust a volume comparison. */
export const VOLUME_MIN_HISTORICAL_WORKOUTS_PER_WEEK = 1.5;

/** kg drift over N days that counts as "flatline" on CUT or MAINTAIN. */
export const WEIGHT_FLATLINE_KG = 0.3;
/** Days for weight flatline window. */
export const WEIGHT_FLATLINE_DAYS = 14;
/** Goals that care about weight flatline (BULK users are intentionally gaining). */
export const WEIGHT_FLATLINE_GOALS = ['CUT', 'MAINTAIN'] as const;
/** Minimum weigh-ins required in the window. */
export const WEIGHT_FLATLINE_MIN_READINGS = 6;

/** % delta under which HRV + sleep both count as flatlined. */
export const METRIC_FLATLINE_PCT = 3;
/** Days for metric flatline window. */
export const METRIC_FLATLINE_DAYS = 14;
/** Minimum training load (workouts/week) required before flagging metric flatline
 *  — under-stimulus users have legitimately flat metrics. */
export const METRIC_FLATLINE_MIN_WK = 3;

// ---- Types ----

export type PlateauKind =
  | 'NO_PR_RECENT'
  | 'ONE_RM_REGRESSION'
  | 'VOLUME_REGRESSION'
  | 'WEIGHT_FLATLINE'
  | 'METRIC_FLATLINE'
  // Special pause-only kind: mutes every heuristic. Present in
  // PLATEAU_KINDS and the route schema; detectors never emit it.
  | 'ALL';

export type Plateau = {
  /** Stable identifier for grouping + analytics. */
  kind: PlateauKind;
  /** Short tag for chip rendering (e.g. "PR", "Volume"). */
  label: string;
  /** 'warn' = advisory; 'scold' = actively stale. */
  severity: 'warn' | 'scold';
  /** Human-readable note (≤ 220 chars). */
  note: string;
  /** Numeric facts behind the flag. Frontend may use for tooltips. */
  context?: Record<string, number | string>;
};

// ---- Helpers ----

/** Days elapsed between `date` and `now`, floored. Negative when `date`
 *  is in the future (returns 0 in that case to avoid surprising callers). */
export function daysSince(date: Date, now: Date = new Date()): number {
  const ms = now.getTime() - date.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/** Epley estimate of 1RM from a single set. Mirrors the formula in
 *  api/src/lib/pr.ts so the dashboard and the plateau detector agree
 *  on what "best set" means. Returns 0 for invalid input. */
export function estimatedOneRm(weight: number, reps: number): number {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return weight * (1 + reps / 30);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---- Heuristic: NO_PR_RECENT ----

async function detectNoPrRecent(userId: string, now: Date): Promise<Plateau | null> {
  const [last, lifetimeCount] = await Promise.all([
    prisma.pr.findFirst({
      where: { userId },
      orderBy: { achievedAt: 'desc' },
      select: { achievedAt: true },
    }),
    prisma.pr.count({ where: { userId } }),
  ]);
  if (!last || lifetimeCount < NO_PR_MIN_LIFETIME_PRS) return null;

  const days = daysSince(last.achievedAt, now);
  if (days < NO_PR_WARN_DAYS) return null;

  const severity = days >= NO_PR_SCOLD_DAYS ? 'scold' : 'warn';
  return {
    kind: 'NO_PR_RECENT',
    label: 'PR',
    severity,
    note:
      severity === 'scold'
        ? `No PR in ${days} days. Time to push a top set harder.`
        : `No PR in ${days} days. Try adding a single @8 rep set to break the stall.`,
    context: { daysSinceLastPr: days, lifetimePrs: lifetimeCount },
  };
}

// ---- Heuristic: ONE_RM_REGRESSION ----

async function bestEstimatedOneRmForExercise(
  userId: string,
  exerciseName: string,
  sinceDays: number,
  now: Date,
): Promise<{ value: number; when: Date } | null> {
  const since = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000);
  const workouts = await prisma.workout.findMany({
    where: { userId, performedAt: { gte: since } },
    select: {
      performedAt: true,
      exercises: {
        where: { name: exerciseName },
        select: { sets: { select: { weight: true, reps: true, completed: true, skipped: true } } },
      },
    },
  });
  let best: { value: number; when: Date } | null = null;
  for (const w of workouts) {
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        if (!s.completed || s.skipped) continue;
        const v = estimatedOneRm(s.weight ?? 0, s.reps ?? 0);
        if (v <= 0) continue;
        if (best == null || v > best.value) best = { value: v, when: w.performedAt };
      }
    }
  }
  return best;
}

async function detectOneRmRegression(userId: string, now: Date): Promise<Plateau[]> {
  const out: Plateau[] = [];
  for (const lift of TRACKED_MAIN_LIFTS) {
    const [peak, recent] = await Promise.all([
      bestEstimatedOneRmForExercise(userId, lift, ONE_RM_PEAK_WINDOW_DAYS, now),
      bestEstimatedOneRmForExercise(userId, lift, ONE_RM_RECENT_WINDOW_DAYS, now),
    ]);
    if (!peak || !recent) continue;
    if (peak.value <= 0) continue;
    const dropPct = ((peak.value - recent.value) / peak.value) * 100;
    if (dropPct < ONE_RM_REGRESSION_PCT) continue;
    out.push({
      kind: 'ONE_RM_REGRESSION',
      label: lift,
      severity: 'scold',
      note: `${lift} estimated 1RM dropped ${dropPct.toFixed(0)}% in the last ${ONE_RM_RECENT_WINDOW_DAYS}d (peak ${peak.value.toFixed(1)} → recent ${recent.value.toFixed(1)}).`,
      context: {
        lift,
        peakKg: Number(peak.value.toFixed(1)),
        recentKg: Number(recent.value.toFixed(1)),
        dropPct: Number(dropPct.toFixed(1)),
      },
    });
  }
  return out;
}

// ---- Heuristic: VOLUME_REGRESSION ----

async function weeklyVolumeAvg(
  userId: string,
  windowDays: number,
  now: Date,
): Promise<{ workouts: number; volume: number } | null> {
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { weightKg: true } });
  const userWeightKg = me?.weightKg ?? 0;
  const workouts = await prisma.workout.findMany({
    where: { userId, performedAt: { gte: since } },
    select: {
      exercises: {
        select: {
          name: true,
          sets: { select: { weight: true, reps: true, completed: true, skipped: true } },
        },
      },
    },
  });
  if (workouts.length === 0) return null;
  let volume = 0;
  for (const w of workouts) {
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        if (!s.completed || s.skipped) continue;
        volume += setVolumeKg(s, ex.name, userWeightKg);
      }
    }
  }
  const weeks = windowDays / 7;
  return {
    workouts: workouts.length,
    volume: volume / weeks,
  };
}

async function detectVolumeRegression(userId: string, now: Date): Promise<Plateau | null> {
  const [recent, baseline] = await Promise.all([
    weeklyVolumeAvg(userId, VOLUME_RECENT_DAYS, now),
    weeklyVolumeAvg(userId, VOLUME_BASELINE_DAYS, now),
  ]);
  if (!recent || !baseline) return null;

  // Don't trust the comparison unless the user has actually been
  // training regularly in the baseline window.
  const baselineWk = baseline.workouts / (VOLUME_BASELINE_DAYS / 7);
  if (baselineWk < VOLUME_MIN_HISTORICAL_WORKOUTS_PER_WEEK) return null;

  if (baseline.volume <= 0) return null;
  const dropPct = ((baseline.volume - recent.volume) / baseline.volume) * 100;
  if (dropPct < VOLUME_REGRESSION_PCT) return null;

  return {
    kind: 'VOLUME_REGRESSION',
    label: 'Volume',
    severity: 'warn',
    note: `Weekly volume dropped ${dropPct.toFixed(0)}% vs your last 4 weeks (${Math.round(baseline.volume)} → ${Math.round(recent.volume)} kg·reps/wk).`,
    context: {
      recentVolumePerWk: Math.round(recent.volume),
      baselineVolumePerWk: Math.round(baseline.volume),
      dropPct: Number(dropPct.toFixed(1)),
    },
  };
}

// ---- Heuristic: WEIGHT_FLATLINE ----

async function detectWeightFlatline(userId: string, now: Date): Promise<Plateau | null> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { goal: true },
  });
  if (!me?.goal) return null;
  if (!WEIGHT_FLATLINE_GOALS.includes(me.goal as any)) return null;

  const since = new Date(now.getTime() - WEIGHT_FLATLINE_DAYS * 24 * 60 * 60 * 1000);
  const readings = await prisma.measurement.findMany({
    where: { userId, metric: 'WEIGHT' as any, recordedAt: { gte: since } },
    select: { value: true, recordedAt: true },
    orderBy: { recordedAt: 'asc' },
  });
  if (readings.length < WEIGHT_FLATLINE_MIN_READINGS) return null;

  const first = readings[0];
  const last = readings[readings.length - 1];
  // Unreachable: length >= WEIGHT_FLATLINE_MIN_READINGS above.
  if (!first || !last) return null;
  const drift = Math.abs(last.value - first.value);
  if (drift >= WEIGHT_FLATLINE_KG) return null;

  return {
    kind: 'WEIGHT_FLATLINE',
    label: 'Weight',
    severity: 'warn',
    note: `Body weight moved only ${drift.toFixed(2)} kg in the last ${WEIGHT_FLATLINE_DAYS} days (goal: ${me.goal.toLowerCase()}). If that's intentional, ignore — otherwise check calorie adherence.`,
    context: {
      driftKg: Number(drift.toFixed(2)),
      goal: me.goal,
      readings: readings.length,
    },
  };
}

// ---- Heuristic: METRIC_FLATLINE ----

async function detectMetricFlatline(userId: string, now: Date): Promise<Plateau | null> {
  const since = new Date(now.getTime() - METRIC_FLATLINE_DAYS * 24 * 60 * 60 * 1000);
  const [hrv, sleep, recentWorkouts] = await Promise.all([
    prisma.measurement.findMany({
      where: { userId, metric: 'HRV' as any, recordedAt: { gte: since } },
      select: { value: true },
      orderBy: { recordedAt: 'asc' },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'SLEEP_HOURS' as any, recordedAt: { gte: since } },
      select: { value: true },
      orderBy: { recordedAt: 'asc' },
    }),
    prisma.workout.count({
      where: {
        userId,
        performedAt: { gte: since },
      },
    }),
  ]);
  if (hrv.length < 5 || sleep.length < 5) return null;

  const recentWk = recentWorkouts / (METRIC_FLATLINE_DAYS / 7);
  if (recentWk < METRIC_FLATLINE_MIN_WK) return null;

  const flatline = (xs: { value: number }[]) => {
    if (xs.length < 2) return false;
    const min = Math.min(...xs.map((x) => x.value));
    const max = Math.max(...xs.map((x) => x.value));
    if (min <= 0) return false;
    return ((max - min) / min) * 100 < METRIC_FLATLINE_PCT;
  };

  if (!flatline(hrv) || !flatline(sleep)) return null;

  return {
    kind: 'METRIC_FLATLINE',
    label: 'Recovery',
    severity: 'warn',
    note: `HRV + sleep both within ±${METRIC_FLATLINE_PCT}% over ${METRIC_FLATLINE_DAYS}d despite high training load. Could be steady adaptation — or a stalled signal. Consider a deload week.`,
    context: {
      recentWorkoutsPerWk: Number(recentWk.toFixed(1)),
      hrvReadings: hrv.length,
      sleepReadings: sleep.length,
    },
  };
}

// ---- Public API ----

/**
 * Pull the user's currently-active plateau pauses (resumeAt > now)
 * and return a Set of muted kinds. Includes `ALL` if present so
 * any-kind filtering can short-circuit.
 *
 * Pure read; past-expiry rows are inert and never returned.
 */
export async function activePauseKinds(
  userId: string,
  now: Date = new Date(),
): Promise<Set<PlateauKind>> {
  const rows = await prisma.plateauPause.findMany({
    where: { userId, resumeAt: { gt: now } },
    select: { kind: true },
  });
  const out = new Set<PlateauKind>();
  for (const r of rows) {
    // Prisma returns the enum as a string; narrow + add. If `ALL`
    // is present we still add it — callers handle the short-circuit.
    out.add(r.kind as PlateauKind);
  }
  return out;
}

/**
 * Run all plateau heuristics against the user's training history and
 * return an array of detected flags. Empty array when there's not
 * enough data to confidently call something stale, or when every
 * detected kind is currently paused.
 *
 * Each entry is independently actionable; the UI may cap how many
 * to display (recommend 3-4 max) but the full array is stored.
 */
export async function detectPlateaus(
  userId: string,
  now: Date = new Date(),
): Promise<Plateau[]> {
  // Pull active pauses first. If `ALL` is paused we can short-
  // circuit — every heuristic is muted by definition.
  const paused = await activePauseKinds(userId, now);
  if (paused.has('ALL')) return [];

  const isPaused = (k: PlateauKind) => paused.has(k);

  const [noPr, regressions, volume, weight, metric] = await Promise.all([
    isPaused('NO_PR_RECENT') ? Promise.resolve(null) : detectNoPrRecent(userId, now),
    isPaused('ONE_RM_REGRESSION') ? Promise.resolve([]) : detectOneRmRegression(userId, now),
    isPaused('VOLUME_REGRESSION') ? Promise.resolve(null) : detectVolumeRegression(userId, now),
    isPaused('WEIGHT_FLATLINE') ? Promise.resolve(null) : detectWeightFlatline(userId, now),
    isPaused('METRIC_FLATLINE') ? Promise.resolve(null) : detectMetricFlatline(userId, now),
  ]);

  const out: Plateau[] = [];
  if (noPr) out.push(noPr);
  out.push(...regressions);
  if (volume) out.push(volume);
  if (weight) out.push(weight);
  if (metric) out.push(metric);

  // Stable order for UI consistency: scolds first, then warns, then by label.
  return out.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'scold' ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}
