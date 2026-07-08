import { prisma } from './prisma.js';
import { localMidnightUtc, localDayKey } from './timezone.js';

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

// History row consumed by computeRequirementProgress:
// {date, score} entries across the window — drives the
// RECOVERY_STREAK scan in worlds.ts.
export type RecoveryHistoryEntry = { date: string; score: number };

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

function startOfDay(d: Date, tz: string | null): Date {
  // Local midnight in the user's tz — was previously
  // `new Date(d); setHours(0,0,0,0)` which snapped to server-local
  // (UTC in Docker) and excluded late-evening previous-day logs.
  return localMidnightUtc(localDayKey(d, tz), tz ?? 'UTC');
}

/**
 * Subscore for one metric, given its raw `value` for the day +
 * the (window-wide) baselines. Pure — no DB access; safe to call
 * from the batched `computeRecoveryHistory` for each day's value
 * of each metric. Returns null when the metric wasn't logged.
 *
 * EXTRACTED from `computeRecoveryForDate` (was inline there) so
 * the same scoring rules drive both the single-date path and the
 * batched history path. Centralizing the rules means a future
 * tuning edit only lands in one place.
 */
function subscoreForMetric(
  metric: string,
  v: number,
  hrvBaseline: number | null,
  rhrBaseline: number | null,
): { subscore: number; reason: string } {
  switch (metric) {
    case 'HRV':
      if (hrvBaseline) {
        return {
          subscore: ratioSubscore(v, hrvBaseline, 0.7, 1.3),
          reason: `${v.toFixed(0)}ms vs ${hrvBaseline.toFixed(0)}ms baseline`,
        };
      }
      return {
        subscore: clamp(Math.round(((v - 20) / 60) * 100), 0, 100),
        reason: `${v.toFixed(0)}ms (no baseline yet — needs 5+ logs)`,
      };
    case 'RESTING_HR':
      if (rhrBaseline) {
        return {
          subscore: ratioSubscore(v, rhrBaseline, 0.7, 1.3, true),
          reason: `${v.toFixed(0)}bpm vs ${rhrBaseline.toFixed(0)} baseline`,
        };
      }
      return {
        subscore: clamp(Math.round(((80 - v) / 30) * 100), 0, 100),
        reason: `${v.toFixed(0)}bpm (no baseline yet)`,
      };
    case 'SLEEP_HOURS':
      return { subscore: sleepHoursSubscore(v), reason: `${v.toFixed(1)} hrs` };
    case 'SLEEP_QUALITY':
      return { subscore: scaleSubscore(v), reason: `${v.toFixed(0)}/10` };
    case 'SORENESS':
      return { subscore: scaleSubscore(v, true), reason: `${v.toFixed(0)}/10` };
    case 'STRESS':
      return { subscore: scaleSubscore(v, true), reason: `${v.toFixed(0)}/10` };
    case 'ENERGY':
      return { subscore: scaleSubscore(v), reason: `${v.toFixed(0)}/10` };
    case 'MOOD':
      return { subscore: scaleSubscore(v), reason: `${v.toFixed(0)}/10` };
  }
  // Unreachable — TRACKED_METRICS enumerates the keys above. The
  // compiler narrows with `noImplicitAny` off; we keep a defensive
  // default so a future WEIGHTS addition without a case update
  // surfaces as a null subscore rather than a thrown ReferenceError.
  return { subscore: 0, reason: 'unhandled metric' };
}

/**
 * Take the latest value of each TRACKED_METRIC for the day and
 * compute the weighted recovery score. Pure — takes inputs and
 * returns the score row (mirrors the body of the original
 * computeRecoveryForDate that ran after the per-day I/O).
 */
function computeRecoveryRow(
  dayKey: string,
  values: Record<string, number | null>,
  hrvBaseline: number | null,
  rhrBaseline: number | null,
): RecoveryScore {
  const components: RecoveryComponent[] = [];
  for (const m of TRACKED_METRICS) {
    const v = values[m] ?? null;
    const available = v != null;
    let subscore: number | null = null;
    let reason = 'not logged today';
    if (available && v != null) {
      const r = subscoreForMetric(m, v, hrvBaseline, rhrBaseline);
      subscore = r.subscore;
      reason = r.reason;
    }
    components.push({
      metric: m,
      rawValue: v,
      subscore,
      weight: 0,
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

async function latestOfDay(userId: string, metric: string, day: Date, tz: string | null): Promise<number | null> {
  const start = startOfDay(day, tz);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
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

export async function computeRecoveryForDate(userId: string, day: Date = new Date(), tz: string | null = null): Promise<RecoveryScore> {
  // tz-aware day key. Was `day.toISOString().slice(0, 10)` (UTC).
  const dayKey = localDayKey(day, tz);

  // Get baselines (only used for HRV and RESTING_HR)
  const hrvBaseline = await baseline30d(userId, 'HRV');
  const rhrBaseline = await baseline30d(userId, 'RESTING_HR');

  // Gather raw values for today
  const values: Record<string, number | null | undefined> = {};
  for (const m of TRACKED_METRICS) {
    values[m] = await latestOfDay(userId, m, day, tz);
  }

  // Build a values row using only the keys the scorer knows about.
  const normalized: Record<string, number | null> = {};
  for (const m of TRACKED_METRICS) normalized[m] = (values[m] as number | null) ?? null;

  return computeRecoveryRow(dayKey, normalized, hrvBaseline, rhrBaseline);
}

export async function computeRecovery(userId: string): Promise<RecoveryScore> {
  // Look up the user's tz once — needed for tz-aware day boundaries.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const tz = user?.timezone ?? null;

  // Today
  const today = await computeRecoveryForDate(userId, new Date(), tz);

  // 7-day trend: compute recovery for each of the last 7 days
  const dailyScores: number[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const r = await computeRecoveryForDate(userId, d, tz);
    if (r.score != null) dailyScores.push(r.score);
  }
  today.trend =
    dailyScores.length > 0 ? Math.round(dailyScores.reduce((a, b) => a + b, 0) / dailyScores.length) : null;

  return today;
}

/**
 * Compute recovery score history for `userId` over the last
 * `days` days (default 90), in a SINGLE `measurement.findMany`
 * for the 8 TRACKED_METRICS plus a 30-day window for the HRV /
 * RESTING_HR baselines. Per-day scores are derived in memory by
 * reusing the same scoring rules as `computeRecoveryForDate`.
 *
 * The return shape `Array<{date, score}>` matches
 * `recoveryHistory` in routes/quest.ts (which feeds into
 * `computeRequirementProgress`'s RECOVERY_STREAK scan in
 * worlds.ts). Days with no data are omitted — the streak logic
 * treats gaps as end-of-streak, so synthesizing "score: null"
 * rows for empty days would re-introduce the gap problem
 * downstream.
 *
 * This replaces the `return []` stub that left sanctum-3,
 * sanctum-5, crossroads-4 (and their bosses) mathematically
 * uncleareable. Each of the first three levels requires a
 * `RECOVERY_STREAK` of ≥70×7 days or 80×30 days — both
 * unreachable while `recoveryHistory` was always empty.
 */
export async function computeRecoveryHistory(
  userId: string,
  days: number = 90,
  tz: string | null = null,
): Promise<RecoveryHistoryEntry[]> {
  // Resolve tz once — falls back to UTC when the user row is
  // missing or has no timezone set. The callers (routes/quest.ts)
  // don't pass tz in, so we look it up here. This was a previously-
  // inline read in `computeRecovery`; the history path was lazy
  // and ignored tz entirely.
  if (tz == null) {
    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    tz = userRow?.timezone ?? null;
  }

  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // SINGLE findMany across the full window for ALL tracked
  // metrics. Grouped by (metric, dayKey) in memory so per-day
  // scoring is local. The previous loop-`findFirst`-per-metric
  // pattern was O(days × metrics) queries; this is O(1) queries.
  const rows = await prisma.measurement.findMany({
    where: {
      userId,
      metric: { in: TRACKED_METRICS as any },
      recordedAt: { gte: since },
    },
    select: { metric: true, value: true, recordedAt: true },
    orderBy: { recordedAt: 'desc' },
  });

  // 30d baselines: same logic as `baseline30d`, batched into
  // ONE aggregate query (was two separate aggregates before).
  const baselineStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const baselineRows = await prisma.measurement.groupBy({
    by: ['metric'],
    where: {
      userId,
      metric: { in: ['HRV', 'RESTING_HR'] as any },
      recordedAt: { gte: baselineStart },
    },
    _avg: { value: true },
    _count: { _all: true },
  });
  const baselineByMetric = new Map<string, number | null>();
  for (const b of baselineRows) {
    const avg = b._avg.value;
    const count = b._count._all;
    baselineByMetric.set(
      b.metric,
      avg != null && count >= 5 ? avg : null,
    );
  }
  const hrvBaseline = baselineByMetric.get('HRV') ?? null;
  const rhrBaseline = baselineByMetric.get('RESTING_HR') ?? null;

  // Bucket: for each (metric, dayKey) keep the LATEST value of
  // that metric on that day. `recordedAt: desc` on the fetch
  // means first-wins, so we only overwrite when we don't yet have
  // an entry for the bucket.
  const latestByMetricDay = new Map<string, number>();
  for (const r of rows) {
    const metric = r.metric;
    const dk = localDayKey(r.recordedAt, tz);
    const key = `${metric}|${dk}`;
    if (latestByMetricDay.has(key)) continue; // already saw a newer one
    latestByMetricDay.set(key, r.value);
  }

  // Iterate the day-buckets we actually have (omit empty days
  // — gaps naturally break streaks). Each computed day's score
  // goes into the output.
  const dayKeySet = new Set<string>();
  for (const k of latestByMetricDay.keys()) {
    const idx = k.indexOf('|');
    dayKeySet.add(idx >= 0 ? k.slice(idx + 1) : k);
  }
  const sortedDays = Array.from(dayKeySet).sort();

  const out: RecoveryHistoryEntry[] = [];
  for (const dk of sortedDays) {
    const values: Record<string, number | null> = {};
    for (const m of TRACKED_METRICS) {
      const v = latestByMetricDay.get(`${m}|${dk}`);
      values[m] = v ?? null;
    }
    const row = computeRecoveryRow(dk, values, hrvBaseline, rhrBaseline);
    if (row.score != null) out.push({ date: row.date, score: row.score });
  }
  return out;
}
