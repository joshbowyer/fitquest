import { prisma } from './prisma.js';

export type RecoveryComponent = {
  metric: string;
  rawValue: number | null;
  subscore: number | null; // 0-100
  weight: number; // 0-1 (effective, after redistribution)
  contribution: number; // subscore * weight
  reason: string; // short human explanation
  available: boolean;
};

export type RecoveryScore = {
  score: number | null; // 0-100
  components: RecoveryComponent[];
  dataPoints: number; // number of metrics with data
  totalMetrics: number;
  trend: number | null; // 7-day average score
  date: string; // ISO date
};

const WEIGHTS: Record<string, number> = {
  HRV: 0.25,
  SLEEP_HOURS: 0.20,
  RESTING_HR: 0.15,
  SLEEP_QUALITY: 0.10,
  SORENESS: 0.10,
  STRESS: 0.10,
  ENERGY: 0.05,
  MOOD: 0.05,
};

const TRACKED_METRICS = Object.keys(WEIGHTS);

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function ratioSubscore(value: number, baseline: number, lowRatio: number, highRatio: number, inverted = false): number {
  const ratio = value / baseline;
  let pct = (ratio - lowRatio) / (highRatio - lowRatio);
  pct = clamp(pct, 0, 1);
  return Math.round((inverted ? 1 - pct : pct) * 100);
}

function sleepHoursSubscore(h: number): number {
  if (h < 5) return 0;
  if (h < 7) return Math.round(((h - 5) / 2) * 70);
  if (h <= 9) return Math.round(70 + ((h - 7) / 2) * 30);
  if (h <= 11) return Math.round(100 - ((h - 9) / 2) * 20);
  return 80;
}

function scaleSubscore(v: number, inverted = false): number {
  const pct = clamp((v - 1) / 9, 0, 1);
  return Math.round((inverted ? 1 - pct : pct) * 100);
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

async function latestOfDay(userId: string, metric: string, day: Date): Promise<number | null> {
  const start = startOfDay(day);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const m = await prisma.measurement.findFirst({
    where: { userId, metric: metric as any, recordedAt: { gte: start, lt: end } },
    orderBy: { recordedAt: 'desc' },
  });
  return m?.value ?? null;
}

async function baseline30d(userId: string, metric: string): Promise<number | null> {
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const result = await prisma.measurement.aggregate({
    where: { userId, metric: metric as any, recordedAt: { gte: start } },
    _avg: { value: true },
    _count: { _all: true },
  });
  if (!result._avg.value || result._count._all < 5) return null;
  return result._avg.value;
}

export async function computeRecoveryForDate(userId: string, day: Date = new Date()): Promise<RecoveryScore> {
  const dayKey = day.toISOString().slice(0, 10);

  // Get baselines (only used for HRV and RESTING_HR)
  const hrvBaseline = await baseline30d(userId, 'HRV');
  const rhrBaseline = await baseline30d(userId, 'RESTING_HR');

  // Gather raw values for today
  const values: Record<string, number | null | undefined> = {};
  for (const m of TRACKED_METRICS) {
    values[m] = await latestOfDay(userId, m, day);
  }

  // Compute subscores
  const components: RecoveryComponent[] = [];
  for (const m of TRACKED_METRICS) {
    const v: number | null = values[m] ?? null;
    const available = v != null;
    let subscore: number | null = null;
    let reason = 'not logged today';
    if (available && v != null) {
      switch (m) {
        case 'HRV':
          if (hrvBaseline) {
            subscore = ratioSubscore(v, hrvBaseline, 0.7, 1.3);
            reason = `${v.toFixed(0)}ms vs ${hrvBaseline.toFixed(0)}ms baseline`;
          } else {
            // Use absolute range until baseline is established
            subscore = clamp(Math.round(((v - 20) / 60) * 100), 0, 100);
            reason = `${v.toFixed(0)}ms (no baseline yet — needs 5+ logs)`;
          }
          break;
        case 'RESTING_HR':
          if (rhrBaseline) {
            subscore = ratioSubscore(v, rhrBaseline, 0.7, 1.3, true);
            reason = `${v.toFixed(0)}bpm vs ${rhrBaseline.toFixed(0)} baseline`;
          } else {
            // 50bpm ideal, 80bpm poor (inverted)
            subscore = clamp(Math.round(((80 - v) / 30) * 100), 0, 100);
            reason = `${v.toFixed(0)}bpm (no baseline yet)`;
          }
          break;
        case 'SLEEP_HOURS':
          subscore = sleepHoursSubscore(v);
          reason = `${v.toFixed(1)} hrs`;
          break;
        case 'SLEEP_QUALITY':
          subscore = scaleSubscore(v);
          reason = `${v.toFixed(0)}/10`;
          break;
        case 'SORENESS':
          subscore = scaleSubscore(v, true);
          reason = `${v.toFixed(0)}/10`;
          break;
        case 'STRESS':
          subscore = scaleSubscore(v, true);
          reason = `${v.toFixed(0)}/10`;
          break;
        case 'ENERGY':
          subscore = scaleSubscore(v);
          reason = `${v.toFixed(0)}/10`;
          break;
        case 'MOOD':
          subscore = scaleSubscore(v);
          reason = `${v.toFixed(0)}/10`;
          break;
      }
    }
    components.push({
      metric: m,
      rawValue: v,
      subscore,
      weight: 0, // filled in below after redistribution
      contribution: 0,
      reason,
      available,
    });
  }

  // Redistribute weights across available components
  const availableComponents = components.filter((c) => c.available);
  const totalRawWeight = availableComponents.reduce((a, c) => a + WEIGHTS[c.metric]!, 0);
  for (const c of components) {
    if (c.available && totalRawWeight > 0) {
      c.weight = WEIGHTS[c.metric]! / totalRawWeight;
      c.contribution = (c.subscore ?? 0) * c.weight;
    }
  }

  const score =
    availableComponents.length > 0
      ? Math.round(components.reduce((a, c) => a + c.contribution, 0))
      : null;

  return {
    score,
    components,
    dataPoints: availableComponents.length,
    totalMetrics: TRACKED_METRICS.length,
    trend: null, // filled in by computeRecovery
    date: dayKey,
  };
}

export async function computeRecovery(userId: string): Promise<RecoveryScore> {
  // Today
  const today = await computeRecoveryForDate(userId);

  // 7-day trend: compute recovery for each of the last 7 days
  const dailyScores: number[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const r = await computeRecoveryForDate(userId, d);
    if (r.score != null) dailyScores.push(r.score);
  }
  today.trend =
    dailyScores.length > 0 ? Math.round(dailyScores.reduce((a, b) => a + b, 0) / dailyScores.length) : null;

  return today;
}
