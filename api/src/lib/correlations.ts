import { prisma } from './prisma.js';

export type Correlation = {
  habit: string;
  outcome: string;
  r: number; // Pearson r
  n: number; // sample size
  habitLabel: string;
  outcomeLabel: string;
};

const HABIT_METRICS = [
  'SLEEP_HOURS', 'SLEEP_QUALITY', 'HRV', 'RESTING_HR',
  'ENERGY', 'MOOD', 'SORENESS', 'STRESS',
  'CALORIES', 'PROTEIN_G', 'WATER_ML',
] as const;

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
};

const OUTCOME_LABELS: Record<string, string> = {
  WORKOUT_VOLUME: 'Workout volume',
  AVG_RPE: 'Workout intensity (RPE)',
  PR_COUNT: 'PR count',
  NEXT_DAY_ENERGY: 'Next-day energy',
  NEXT_DAY_MOOD: 'Next-day mood',
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
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
async function habitDaily(userId: string, metric: string, from: Date, to: Date): Promise<DailyMap> {
  const measurements = await prisma.measurement.findMany({
    where: { userId, metric: metric as any, recordedAt: { gte: from, lt: to } },
    orderBy: { recordedAt: 'asc' },
  });
  const map: DailyMap = new Map();
  for (const m of measurements) {
    const k = dayKey(new Date(m.recordedAt));
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
  to: Date
): Promise<{ volume: DailyMap; rpe: DailyMap; pr: DailyMap }> {
  const workouts = await prisma.workout.findMany({
    where: { userId, performedAt: { gte: from, lt: to } },
    include: { exercises: { include: { sets: true } } },
  });
  const volume: DailyMap = new Map();
  const rpeSum = new Map<string, { sum: number; count: number }>();
  const prCount = new Map<string, number>();

  for (const w of workouts) {
    const k = dayKey(new Date(w.performedAt));
    let dayVolume = volume.get(k) ?? 0;
    let rpe = rpeSum.get(k);
    if (!rpe) { rpe = { sum: 0, count: 0 }; rpeSum.set(k, rpe); }
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        if (!s.completed) continue;
        if (s.weight != null && s.reps > 0) dayVolume += s.weight * s.reps;
        if (s.rpe != null) { rpe.sum += s.rpe; rpe.count += 1; }
      }
    }
    volume.set(k, dayVolume);
  }

  // PRs come from the Pr table
  const prs = await prisma.pr.findMany({
    where: { userId, achievedAt: { gte: from, lt: to } },
  });
  for (const p of prs) {
    const k = dayKey(new Date(p.achievedAt));
    prCount.set(k, (prCount.get(k) ?? 0) + 1);
  }

  const rpeMap: DailyMap = new Map();
  for (const [k, v] of rpeSum) {
    rpeMap.set(k, v.count > 0 ? v.sum / v.count : null);
  }
  return { volume, rpe: rpeMap, pr: prCount };
}

function shiftKeysByOneDay(map: DailyMap): DailyMap {
  // Returns a new map where key for date D contains the value for date D-1.
  // Used to correlate habit (today) with next-day outcome.
  const out: DailyMap = new Map();
  for (const [k, v] of map) {
    const parts = k.split('-').map(Number);
    const y = parts[0] ?? 1970;
    const mo = parts[1] ?? 0;
    const d = parts[2] ?? 1;
    const dt = new Date(y, mo, d);
    dt.setDate(dt.getDate() + 1);
    out.set(dayKey(dt), v);
  }
  return out;
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

export async function computeCorrelations(
  userId: string,
  options: { lookbackDays?: number; minN?: number; topN?: number } = {}
): Promise<Correlation[]> {
  const lookbackDays = options.lookbackDays ?? 60;
  const minN = options.minN ?? 7;
  const topN = options.topN ?? 10;

  const to = new Date();
  to.setDate(to.getDate() + 1); // include today
  const from = new Date();
  from.setDate(from.getDate() - lookbackDays);

  // Build habit maps
  const habitMaps: Record<string, DailyMap> = {};
  for (const h of HABIT_METRICS) {
    habitMaps[h] = await habitDaily(userId, h, from, to);
  }

  // Build outcome maps
  const { volume, rpe, pr } = await workoutDaily(userId, from, to);

  // Next-day shifts for ENERGY/MOOD outcomes (we correlate today's habit with tomorrow's wellness)
  const nextEnergy = shiftKeysByOneDay(habitMaps.ENERGY ?? new Map());
  const nextMood = shiftKeysByOneDay(habitMaps.MOOD ?? new Map());

  const outcomeMaps: Record<string, DailyMap> = {
    WORKOUT_VOLUME: volume,
    AVG_RPE: rpe,
    PR_COUNT: pr,
    NEXT_DAY_ENERGY: nextEnergy,
    NEXT_DAY_MOOD: nextMood,
  };

  // Skip self-correlations
  const skipHabit: Record<string, true> = {
    ENERGY: true, // don't correlate ENERGY with NEXT_DAY_ENERGY (it's just shifted)
    MOOD: true,
  };

  const results: Correlation[] = [];
  for (const habit of HABIT_METRICS) {
    if (skipHabit[habit]) {
      // Only correlate these habits with workout outcomes, not next-day versions
      for (const out of ['WORKOUT_VOLUME', 'AVG_RPE', 'PR_COUNT'] as const) {
        const { xs, ys } = alignPair(habitMaps[habit]!, outcomeMaps[out]!);
        const n = xs.length;
        if (n < minN) continue;
        const r = pearson(xs, ys);
        results.push({
          habit,
          outcome: out,
          r: Math.round(r * 100) / 100,
          n,
          habitLabel: HABIT_LABELS[habit]!,
          outcomeLabel: OUTCOME_LABELS[out]!,
        });
      }
      continue;
    }
    for (const [outName, outMap] of Object.entries(outcomeMaps)) {
      const { xs, ys } = alignPair(habitMaps[habit]!, outMap);
      const n = xs.length;
      if (n < minN) continue;
      const r = pearson(xs, ys);
      results.push({
        habit,
        outcome: outName,
        r: Math.round(r * 100) / 100,
        n,
        habitLabel: HABIT_LABELS[habit]!,
        outcomeLabel: OUTCOME_LABELS[outName]!,
      });
    }
  }

  results.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  return results.slice(0, topN);
}
