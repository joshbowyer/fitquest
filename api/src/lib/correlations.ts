import { prisma } from './prisma.js';
import { setVolumeKg } from './exerciseVolume.js';
import { localDayKey, localMidnightUtc } from './timezone.js';

export type Correlation = {
  habit: string;
  outcome: string;
  r: number; // Pearson r
  n: number; // sample size
  habitLabel: string;
  outcomeLabel: string;
  /// Days the habit leads the outcome. 0 = same-day. The UI uses
  /// this to render a "lag" badge so the user can tell apart
  /// "today's sleep predicts today's PR" from "yesterday's sleep
  /// predicts today's PR".
  lagDays: number;
  /// Lookback window in days (30 / 60 / 90). Surfaced so the UI
  /// can render a tooltip ("computed over the last 60 days").
  lookbackDays: number;
};

/// Habit metrics that come directly from the Measurement table.
const HABIT_METRICS = [
  'SLEEP_HOURS', 'SLEEP_QUALITY', 'HRV', 'RESTING_HR',
  'ENERGY', 'MOOD', 'SORENESS', 'STRESS',
  'CALORIES', 'PROTEIN_G', 'WATER_ML',
  'STEPS', 'RESPIRATION_RATE',
] as const;

/// Synthetic habits that are computed inside the engine from
/// other measurements rather than read from a single row. Each
/// entry has a label + a builder function that takes the user's
/// full measurement history and returns a date -> value map.
/// `tz` is threaded through so day-bucketing matches the user's
/// frame of reference rather than the server's UTC clock.
type SyntheticHabitBuilder = (userId: string, from: Date, to: Date, tz: string | null) => Promise<DailyMap>;
const SYNTHETIC_HABITS: Record<string, SyntheticHabitBuilder> = {
  WORKOUT_FREQUENCY_7D: async (userId, from, to, tz) => {
    // Rolling 7-day workout count for each day in the window.
    // A day with no workouts scores 0; we only emit days in the
    // window so the correlator can align with outcomes.
    const workouts = await prisma.workout.findMany({
      where: { userId, performedAt: { gte: from, lt: to } },
      select: { performedAt: true },
    });
    const byDate: DailyMap = new Map();
    for (const w of workouts) {
      const k = dayKey(new Date(w.performedAt), tz);
      byDate.set(k, (byDate.get(k) ?? 0) + 1);
    }
    // Roll up: for every day in window, sum workouts in last 7 days.
    const out: DailyMap = new Map();
    const sortedKeys = [...byDate.keys()].sort();
    const startMs = from.getTime();
    const endMs = to.getTime();
    for (let t = startMs; t < endMs; t += 24 * 60 * 60 * 1000) {
      const d = new Date(t);
      const k = dayKey(d, tz);
      let count = 0;
      for (let back = 0; back < 7; back++) {
        const dk = dayKey(new Date(t - back * 24 * 60 * 60 * 1000), tz);
        count += byDate.get(dk) ?? 0;
      }
      // Only emit the day if there was at least one workout in
      // the trailing window — keeps the correlator from pairing
      // against a sea of zeros.
      if (count > 0) out.set(k, count);
    }
    return out;
  },
  SLEEP_DEBT_3D: async (userId, from, to, tz) => {
    // Cumulative hours under 7.5/day over the prior 3 days.
    // Positive = sleep debt, 0 = caught up, negative = surplus.
    // The daily Measurement row stores nightly sleep; we want
    // each calendar day's value to reflect the prior 3 days'
    // aggregate debt so "today" is the most-recent 3-day window.
    const map = await habitDaily(userId, 'SLEEP_HOURS', from, to, tz);
    const out: DailyMap = new Map();
    const startMs = from.getTime();
    const endMs = to.getTime();
    for (let t = startMs; t < endMs; t += 24 * 60 * 60 * 1000) {
      let debt = 0;
      for (let back = 1; back <= 3; back++) {
        const k = dayKey(new Date(t - back * 24 * 60 * 60 * 1000), tz);
        const h = map.get(k) ?? 0;
        debt += 7.5 - h;
      }
      out.set(dayKey(new Date(t), tz), debt);
    }
    return out;
  },
};

const HABIT_LABELS: Record<string, string> = {
  SLEEP_HOURS: 'Sleep hours',
  SLEEP_QUALITY: 'Sleep quality',
  HRV: 'HRV',
  RESTING_HR: 'Resting HR',
  ENERGY: 'Energy',
  MOOD: 'Mood',
  SORENESS: 'Soreness',
  STRESS: 'Stress',
  CALORIES: 'Calories',
  PROTEIN_G: 'Protein',
  WATER_ML: 'Water',
  STEPS: 'Steps',
  RESPIRATION_RATE: 'Resting respiration',
  WORKOUT_FREQUENCY_7D: 'Workouts in last 7d',
  SLEEP_DEBT_3D: 'Sleep debt (3d)',
};

/// Outcome maps: workout-derived metrics (volume/RPE/PR), wellness
/// lags (next-day energy/mood), and weight-trend derived from
/// the Measurement table.
const OUTCOME_LABELS: Record<string, string> = {
  WORKOUT_VOLUME: 'Workout volume',
  AVG_RPE: 'Workout intensity (RPE)',
  PR_COUNT: 'PR count',
  NEXT_DAY_ENERGY: 'Next-day energy',
  NEXT_DAY_MOOD: 'Next-day mood',
  WEIGHT_TREND_7D: 'Weight trend (7d, kg)',
  WORKOUT_DURATION: 'Workout duration (min)',
  SET_VOLUME: 'Set count (completed)',
};

/// Outcome builders. All return a DailyMap of date -> value so
/// they can flow through the same alignPair() machinery as
/// habit maps.
type OutcomeBuilder = (userId: string, from: Date, to: Date) => Promise<DailyMap>;
const OUTCOME_BUILDERS: Record<string, OutcomeBuilder> = {
  WORKOUT_VOLUME: async (userId, from, to) => {
    const { volume } = await workoutDaily(userId, from, to, tz);
    return volume;
  },
  AVG_RPE: async (userId, from, to) => {
    const { rpe } = await workoutDaily(userId, from, to, tz);
    return rpe;
  },
  PR_COUNT: async (userId, from, to) => {
    const { pr } = await workoutDaily(userId, from, to, tz);
    return pr;
  },
  NEXT_DAY_ENERGY: async (userId, from, to) => {
    const m = await habitDaily(userId, 'ENERGY', from, to, tz);
    return shiftKeysByOneDay(m, tz);
  },
  NEXT_DAY_MOOD: async (userId, from, to) => {
    const m = await habitDaily(userId, 'MOOD', from, to, tz);
    return shiftKeysByOneDay(m, tz);
  },
  WEIGHT_TREND_7D: async (userId, from, to) => {
    // Per-day weight, then convert to 7-day rolling slope.
    // We use a simple difference (today - 7 days ago) so the
    // resulting number is interpretable: negative = losing,
    // positive = gaining. Stored in kg.
    const weights = await prisma.measurement.findMany({
      where: { userId, metric: 'WEIGHT' as any, recordedAt: { gte: from, lt: to } },
      orderBy: { recordedAt: 'asc' },
    });
    const byDate: DailyMap = new Map();
    for (const m of weights) {
      byDate.set(dayKey(new Date(m.recordedAt), tz), m.value);
    }
    const out: DailyMap = new Map();
    const startMs = from.getTime();
    const endMs = to.getTime();
    for (let t = startMs; t < endMs; t += 24 * 60 * 60 * 1000) {
      const k = dayKey(new Date(t), tz);
      const today = byDate.get(k);
      if (today == null) continue;
      const weekAgo = byDate.get(dayKey(new Date(t - 7 * 24 * 60 * 60 * 1000), tz));
      if (weekAgo == null) continue;
      out.set(k, today - weekAgo);
    }
    return out;
  },
  WORKOUT_DURATION: async (userId, from, to) => {
    const workouts = await prisma.workout.findMany({
      where: { userId, performedAt: { gte: from, lt: to } },
      select: { performedAt: true, duration: true },
    });
    const out: DailyMap = new Map();
    for (const w of workouts) {
      if (w.duration == null) continue;
      const k = dayKey(new Date(w.performedAt), tz);
      out.set(k, (out.get(k) ?? 0) + w.duration);
    }
    return out;
  },
  SET_VOLUME: async (userId, from, to) => {
    const { sets } = await workoutDaily(userId, from, to, tz);
    return sets;
  },
};

function dayKey(d: Date, tz: string | null): string {
  // Bucket by the user's local date — was previously server-local
  // (UTC in Docker), which double-counted or skipped days at the
  // UTC/local boundary for non-UTC users.
  return localDayKey(d, tz);
}

function startOfDay(d: Date, tz: string | null): Date {
  return localMidnightUtc(localDayKey(d, tz), tz ?? 'UTC');
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]!; my += ys[i]!; }
  mx /= n; my /= n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return 0;
  return num / denom;
}

type DailyMap = Map<string, number | null>;

/**
 * Build a map of date -> value for a habit metric. Takes the latest of the day.
 */
async function habitDaily(userId: string, metric: string, from: Date, to: Date, tz: string | null): Promise<DailyMap> {
  const measurements = await prisma.measurement.findMany({
    where: { userId, metric: metric as any, recordedAt: { gte: from, lt: to } },
    orderBy: { recordedAt: 'asc' },
  });
  const map: DailyMap = new Map();
  for (const m of measurements) {
    const k = dayKey(new Date(m.recordedAt), tz);
    // Take the LAST measurement of the day for sleep/wellness (reflects "today's state")
    map.set(k, m.value);
  }
  return map;
}

/**
 * Build daily workout outcome maps.
 */
async function workoutDaily(
  userId: string,
  from: Date,
  to: Date,
  tz: string | null
): Promise<{ volume: DailyMap; rpe: DailyMap; pr: DailyMap; sets: DailyMap }> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { weightKg: true } });
  const userWeightKg = me?.weightKg ?? 0;
  const workouts = await prisma.workout.findMany({
    where: { userId, performedAt: { gte: from, lt: to } },
    include: { exercises: { include: { sets: true } } },
  });
  const volume: DailyMap = new Map();
  const rpeSum = new Map<string, { sum: number; count: number }>();
  const prCount = new Map<string, number>();
  const setCount: DailyMap = new Map();

  for (const w of workouts) {
    const k = dayKey(new Date(w.performedAt), tz);
    let dayVolume = volume.get(k) ?? 0;
    let rpe = rpeSum.get(k);
    if (!rpe) { rpe = { sum: 0, count: 0 }; rpeSum.set(k, rpe); }
    let daySets = 0;
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        if (!s.completed) continue;
        dayVolume += setVolumeKg(s, ex.name, userWeightKg);
        if (s.rpe != null) { rpe.sum += s.rpe; rpe.count += 1; }
        daySets += 1;
      }
    }
    volume.set(k, dayVolume);
    setCount.set(k, (setCount.get(k) ?? 0) + daySets);
  }

  // PRs come from the Pr table
  const prs = await prisma.pr.findMany({
    where: { userId, achievedAt: { gte: from, lt: to } },
  });
  for (const p of prs) {
    const k = dayKey(new Date(p.achievedAt), tz);
    prCount.set(k, (prCount.get(k) ?? 0) + 1);
  }

  const rpeMap: DailyMap = new Map();
  for (const [k, v] of rpeSum) {
    rpeMap.set(k, v.count > 0 ? v.sum / v.count : null);
  }
  return { volume, rpe: rpeMap, pr: prCount, sets: setCount };
}

function shiftKeysByDays(map: DailyMap, days: number, tz: string | null): DailyMap {
  // Returns a new map where key for date D contains the value for
  // date D - days. Used for lag analysis: a positive `days` shifts
  // the habit forward so day-D's value is what was recorded on
  // day-(D-days). When the correlator pairs this with an outcome
  // map unchanged, the result is "habit N days ago predicts
  // outcome today".
  if (days === 0) return map;
  const out: DailyMap = new Map();
  for (const [k, v] of map) {
    // Parse YYYY-MM-DD and shift by `days`, keeping the result in
    // the user's tz. Was `new Date(y, mo, d)` which constructs in
    // server-local time (= UTC in Docker) — off by the tz offset.
    const dt = localMidnightUtc(k, tz ?? 'UTC');
    const shifted = new Date(dt.getTime() + days * 24 * 60 * 60 * 1000);
    out.set(dayKey(shifted, tz), v);
  }
  return out;
}

/// Backwards-compatible alias used by insights.ts and tests.
function shiftKeysByOneDay(map: DailyMap, tz: string | null): DailyMap {
  return shiftKeysByDays(map, 1, tz);
}

function alignPair(a: DailyMap, b: DailyMap): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [k, av] of a) {
    const bv = b.get(k);
    if (av != null && bv != null) {
      xs.push(av);
      ys.push(bv);
    }
  }
  return { xs, ys };
}

/// Maximum lag (in days) we look at for habit → outcome. 0..2
/// captures "today/yesterday/two days ago". Beyond 3 days the
/// signal-to-noise ratio on a 60-day window drops too far.
export const MAX_LAG_DAYS = 2;

export async function computeCorrelations(
  userId: string,
  options: {
    lookbackDays?: number;
    minN?: number;
    topN?: number;
    /// Override the lag set. Defaults to [0, 1, 2]. Set to [0]
    /// for a fast "same-day only" pass.
    lags?: number[];
  } = {}
): Promise<Correlation[]> {
  const lookbackDays = options.lookbackDays ?? 60;
  const minN = options.minN ?? 7;
  const topN = options.topN ?? 10;
  const lags = options.lags ?? [0, 1, 2];

  // Look up the user's tz — every dayKey + startOfDay in this
  // function (and the helpers it calls) needs it.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const tz = user?.timezone ?? null;

  const to = new Date();
  to.setDate(to.getDate() + 1); // include today
  const from = new Date();
  from.setDate(from.getDate() - lookbackDays);

  // Build habit maps. Synthetic habits run alongside direct
  // measurements; the label map keys them all consistently.
  const habitMaps: Record<string, DailyMap> = {};
  for (const h of HABIT_METRICS) {
    habitMaps[h] = await habitDaily(userId, h, from, to, tz);
  }
  for (const [name, build] of Object.entries(SYNTHETIC_HABITS)) {
    habitMaps[name] = await build(userId, from, to, tz);
  }

  // Build outcome maps. These flow from the builder registry;
  // the three "next-day" outcomes that used to be special-cased
  // for ENERGY/MOOD are now just builders that internally shift
  // keys forward.
  const outcomeMaps: Record<string, DailyMap> = {};
  for (const [name, build] of Object.entries(OUTCOME_BUILDERS)) {
    outcomeMaps[name] = await build(userId, from, to);
  }

  // Skip pairs that are trivially the same data (e.g. correlating
  // ENERGY at lag 1 with NEXT_DAY_ENERGY which is just ENERGY at
  // lag 1).
  const skipPairs: Record<string, Set<string>> = {
    ENERGY: new Set(['NEXT_DAY_ENERGY']),
    MOOD: new Set(['NEXT_DAY_MOOD']),
  };

  const results: Correlation[] = [];
  const habitKeys = Object.keys(habitMaps);
  const outcomeKeys = Object.keys(outcomeMaps);

  for (const habit of habitKeys) {
    const skip = skipPairs[habit];
    for (const outcome of outcomeKeys) {
      if (skip?.has(outcome)) continue;
      for (const lag of lags) {
        const habitShifted = shiftKeysByDays(habitMaps[habit]!, lag, tz);
        const { xs, ys } = alignPair(habitShifted, outcomeMaps[outcome]!);
        const n = xs.length;
        if (n < minN) continue;
        const r = pearson(xs, ys);
        results.push({
          habit,
          outcome,
          r: Math.round(r * 100) / 100,
          n,
          habitLabel: HABIT_LABELS[habit] ?? habit,
          outcomeLabel: OUTCOME_LABELS[outcome] ?? outcome,
          lagDays: lag,
          lookbackDays,
        });
      }
    }
  }

  results.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  return results.slice(0, topN);
}

// ------------------------------------------------------------
// Snapshot persistence — runs once per user per night so the
// /insights page can show trend sparklines without re-running
// the full pipeline on every render. Each snapshot is a row in
// CorrelationSnapshot keyed by (user, date, habit, outcome, lag,
// lookbackDays), so a re-run on the same day replaces cleanly.
// ------------------------------------------------------------

export type SnapshotOptions = {
  /// Window lengths to capture. The UI shows three trend lines
  /// (30/60/90d) side-by-side so the user can compare short
  /// vs long-term patterns.
  windows?: number[];
  /// When true, also clear all snapshots for the date before
  /// re-inserting. Default true so a re-run replaces, not
  /// duplicates.
  replaceExisting?: boolean;
};

export const DEFAULT_SNAPSHOT_WINDOWS = [30, 60, 90];

export async function snapshotCorrelations(
  userId: string,
  when: Date = new Date(),
  options: SnapshotOptions = {}
): Promise<{ written: number; topPerWindow: Correlation[] }> {
  const windows = options.windows ?? DEFAULT_SNAPSHOT_WINDOWS;
  const replaceExisting = options.replaceExisting ?? true;
  // YYYY-MM-DD at UTC midnight — the snapshot "date" is the run
  // date, not the timestamp. Lets us key unique rows cheaply.
  const dayStart = new Date(Date.UTC(
    when.getUTCFullYear(),
    when.getUTCMonth(),
    when.getUTCDate(),
  ));

  let written = 0;
  const topPerWindow: Correlation[] = [];

  if (replaceExisting) {
    await prisma.correlationSnapshot.deleteMany({
      where: { userId, snapshotDate: dayStart },
    });
  }

  for (const window of windows) {
    // Pull a wider slice than the window so the lag shift still
    // finds matches in the trailing days.
    const corrs = await computeCorrelations(userId, {
      lookbackDays: window,
      topN: 999, // capture everything; the UI filters by |r|
    });
    topPerWindow.push(...corrs.slice(0, 5));
    if (corrs.length === 0) continue;
    await prisma.correlationSnapshot.createMany({
      data: corrs.map((c) => ({
        userId,
        snapshotDate: dayStart,
        lookbackDays: window,
        habit: c.habit,
        outcome: c.outcome,
        lagDays: c.lagDays,
        r: c.r,
        n: c.n,
      })),
    });
    written += corrs.length;
  }

  return { written, topPerWindow };
}

/// Nightly batch: snapshot every user. Called by the scheduled
/// job in index.ts (03:30 local). Skips users with no measure-
/// ments in the last 90 days to avoid burning cycles on stale
/// accounts.
export async function snapshotAllUsers(when: Date = new Date()): Promise<{ users: number; rows: number }> {
  const cutoff = new Date(when);
  cutoff.setDate(cutoff.getDate() - 90);
  const activeUsers = await prisma.user.findMany({
    where: { measurements: { some: { recordedAt: { gte: cutoff } } } },
    select: { id: true },
  });
  let totalRows = 0;
  for (const u of activeUsers) {
    try {
      const { written } = await snapshotCorrelations(u.id, when);
      totalRows += written;
    } catch {
      // swallow per-user failures so one bad row doesn't break the batch
    }
  }
  return { users: activeUsers.length, rows: totalRows };
}

/// History fetch — used by the UI to draw the 12-week sparkline
/// next to each correlation row.
export type CorrelationHistoryPoint = {
  date: string; // YYYY-MM-DD
  r: number;
  n: number;
};

export async function fetchCorrelationHistory(
  userId: string,
  habit: string,
  outcome: string,
  options: { lookbackDays?: number; lagDays?: number; weeks?: number } = {}
): Promise<CorrelationHistoryPoint[]> {
  const weeks = options.weeks ?? 12;
  const lookbackDays = options.lookbackDays ?? 60;
  const lagDays = options.lagDays ?? 0;
  const since = new Date();
  since.setDate(since.getDate() - weeks * 7);
  since.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.correlationSnapshot.findMany({
    where: {
      userId,
      habit,
      outcome,
      lookbackDays,
      lagDays,
      snapshotDate: { gte: since },
    },
    orderBy: { snapshotDate: 'asc' },
    select: { snapshotDate: true, r: true, n: true },
  });
  return rows.map((r) => ({
    date: r.snapshotDate.toISOString().slice(0, 10),
    r: r.r,
    n: r.n,
  }));
}
