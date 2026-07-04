import { prisma } from './prisma.js';
import { localMidnightUtc, localDayKey } from './timezone.js';

// =============================================================================
// Streak counters + today-status helpers.
// =============================================================================
//
// All bucket keys + day boundaries used to be computed in the server's
// local time (= UTC in Docker) via `new Date().setHours(0,0,0,0)` and
// `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`. For non-UTC
// users (e.g. America/New_York), that misbucketed measurements
// across the UTC/local boundary — a 11pm-EDT weigh-in counted as
// "tomorrow", and a late-evening previous-day log fell off the
// today-streak count.
//
// The fixes below thread the user's tz through every helper. The
// public exports still take only `userId` to avoid breaking callers;
// each function looks up the user's tz from the DB once and uses it
// for every bucket key + day boundary in its computation.

// Day key in the user's tz — the canonical bucket key for streak
// counters. Distinct from `localDayKey` in lib/timezone.ts (which
// returns the same string but is shared with other modules).
function dayKey(d: Date, tz: string | null): string {
  return localDayKey(d, tz);
}

// Local-midnight UTC instant for the given instant in the user's tz.
function startOfDay(d: Date, tz: string | null): Date {
  return localMidnightUtc(localDayKey(d, tz), tz ?? 'UTC');
}

// Convert a dayKey string (YYYY-MM-DD) back to a local-midnight UTC
// instant in the user's tz.
function dayKeyToInstant(k: string, tz: string | null): Date {
  return localMidnightUtc(k, tz ?? 'UTC');
}

// Look up the user's tz once. Returns null if the user is missing
// (callers fall back to UTC).
async function userTz(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  return u?.timezone ?? null;
}

export type WeighInStreak = {
  current: number;
  longest: number;
  lastDate: string | null;
};

export async function getWeighInStreak(userId: string): Promise<WeighInStreak> {
  const tz = await userTz(userId);
  const measurements = await prisma.measurement.findMany({
    where: { userId, metric: 'WEIGHT' },
    orderBy: { recordedAt: 'desc' },
    select: { recordedAt: true },
  });
  if (measurements.length === 0) {
    return { current: 0, longest: 0, lastDate: null };
  }

  // Collect unique local-time day keys
  const days = new Set<string>();
  for (const m of measurements) {
    days.add(dayKey(new Date(m.recordedAt), tz));
  }
  const sortedDesc = Array.from(days)
    .map((k) => dayKeyToInstant(k, tz))
    .sort((a, b) => b.getTime() - a.getTime());

  // Current streak: start from today or yesterday, count consecutive days
  const today = startOfDay(new Date(), tz);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  let current = 0;
  if (sortedDesc[0]!.getTime() === today.getTime() || sortedDesc[0]!.getTime() === yesterday.getTime()) {
    current = 1;
    for (let i = 1; i < sortedDesc.length; i++) {
      const prev = sortedDesc[i - 1]!;
      const cur = sortedDesc[i]!;
      const diff = Math.round((prev.getTime() - cur.getTime()) / (24 * 60 * 60 * 1000));
      if (diff === 1) current++;
      else break;
    }
  }

  // Longest streak: walk the whole list
  let longest = 1;
  let running = 1;
  for (let i = 1; i < sortedDesc.length; i++) {
    const prev = sortedDesc[i - 1]!;
    const cur = sortedDesc[i]!;
    const diff = Math.round((prev.getTime() - cur.getTime()) / (24 * 60 * 60 * 1000));
    if (diff === 1) {
      running++;
      if (running > longest) longest = running;
    } else {
      running = 1;
    }
  }

  return {
    current,
    longest,
    lastDate: sortedDesc[0]!.toISOString(),
  };
}

export type WeighInToday = {
  logged: boolean;
  value: number | null;
  recordedAt: string | null;
  unit: string;
};

export async function getWeighInToday(userId: string): Promise<WeighInToday> {
  const tz = await userTz(userId);
  const start = startOfDay(new Date(), tz);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const today = await prisma.measurement.findFirst({
    where: {
      userId,
      metric: 'WEIGHT',
      recordedAt: { gte: start, lt: end },
    },
    orderBy: { recordedAt: 'desc' },
  });
  return {
    logged: !!today,
    value: today?.value ?? null,
    recordedAt: today?.recordedAt.toISOString() ?? null,
    unit: today?.unit ?? 'kg',
  };
}

export type WeightTrendPoint = {
  date: string;
  value: number | null;
};

export async function getWeightTrend(userId: string, days: number = 7): Promise<WeightTrendPoint[]> {
  const tz = await userTz(userId);
  const start = startOfDay(new Date(), tz);
  start.setTime(start.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

  const measurements = await prisma.measurement.findMany({
    where: {
      userId,
      metric: 'WEIGHT',
      recordedAt: { gte: start, lt: end },
    },
    orderBy: { recordedAt: 'asc' },
  });

  // Pick the first measurement (by timestamp) for each day for consistency
  const firstOfDay = new Map<string, { value: number; ts: number }>();
  for (const m of measurements) {
    const d = new Date(m.recordedAt);
    const k = dayKey(d, tz);
    const existing = firstOfDay.get(k);
    if (!existing || m.recordedAt.getTime() < existing.ts) {
      firstOfDay.set(k, { value: m.value, ts: m.recordedAt.getTime() });
    }
  }

  const series: WeightTrendPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    const k = dayKey(d, tz);
    const entry = firstOfDay.get(k);
    series.push({
      date: d.toISOString(),
      value: entry ? entry.value : null,
    });
  }
  return series;
}

export async function getWeighInDelta7d(userId: string): Promise<number | null> {
  const trend = await getWeightTrend(userId, 8);
  const recent = trend.filter((p) => p.value != null).slice(-2);
  if (recent.length < 2) return null;
  return Number((recent[1]!.value! - recent[0]!.value!).toFixed(2));
}

// Generic per-metric streak: consecutive days with at least one measurement
export async function getMetricStreak(
  userId: string,
  metric: 'WEIGHT' | string
): Promise<{ current: number; longest: number }> {
  const tz = await userTz(userId);
  const measurements = await prisma.measurement.findMany({
    where: { userId, metric: metric as any },
    orderBy: { recordedAt: 'desc' },
    select: { recordedAt: true },
  });
  if (measurements.length === 0) return { current: 0, longest: 0 };

  const days = new Set<string>();
  for (const m of measurements) {
    days.add(dayKey(new Date(m.recordedAt), tz));
  }
  const sortedDesc = Array.from(days)
    .map((k) => dayKeyToInstant(k, tz))
    .sort((a, b) => b.getTime() - a.getTime());

  const today = startOfDay(new Date(), tz);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  let current = 0;
  if (
    sortedDesc[0]!.getTime() === today.getTime() ||
    sortedDesc[0]!.getTime() === yesterday.getTime()
  ) {
    current = 1;
    for (let i = 1; i < sortedDesc.length; i++) {
      const prev = sortedDesc[i - 1]!;
      const cur = sortedDesc[i]!;
      const diff = Math.round((prev.getTime() - cur.getTime()) / (24 * 60 * 60 * 1000));
      if (diff === 1) current++;
      else break;
    }
  }

  let longest = 1;
  let running = 1;
  for (let i = 1; i < sortedDesc.length; i++) {
    const diff = Math.round(
      (sortedDesc[i - 1]!.getTime() - sortedDesc[i]!.getTime()) / (24 * 60 * 60 * 1000)
    );
    if (diff === 1) {
      running++;
      if (running > longest) longest = running;
    } else {
      running = 1;
    }
  }

  return { current, longest };
}

// Category streak: each day must include at least one measurement of a metric
// belonging to the given category.
export async function getCategoryStreak(
  userId: string,
  category: string
): Promise<{ current: number; longest: number }> {
  const tz = await userTz(userId);
  const measurements = await prisma.measurement.findMany({
    where: { userId },
    orderBy: { recordedAt: 'desc' },
    select: { recordedAt: true, metric: true },
  });
  if (measurements.length === 0) return { current: 0, longest: 0 };

  // Group by day -> set of metrics that day
  const byDay = new Map<string, Set<string>>();
  for (const m of measurements) {
    const k = dayKey(new Date(m.recordedAt), tz);
    if (!byDay.has(k)) byDay.set(k, new Set());
    byDay.get(k)!.add(m.metric);
  }

  // Filter to days that have at least one metric in the given category
  const { METRICS_BY_CATEGORY } = await import('./metrics.js');
  const catMetrics = (METRICS_BY_CATEGORY as Record<string, string[]>)[category] || [];
  if (catMetrics.length === 0) return { current: 0, longest: 0 };

  const days = Array.from(byDay.entries())
    .filter(([_, metrics]) => {
      for (const m of metrics) {
        if (catMetrics.includes(m)) return true;
      }
      return false;
    })
    .map(([k]) => dayKeyToInstant(k, tz))
    .sort((a, b) => b.getTime() - a.getTime());

  if (days.length === 0) return { current: 0, longest: 0 };

  const today = startOfDay(new Date(), tz);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  let current = 0;
  if (days[0]!.getTime() === today.getTime() || days[0]!.getTime() === yesterday.getTime()) {
    current = 1;
    for (let i = 1; i < days.length; i++) {
      const diff = Math.round((days[i - 1]!.getTime() - days[i]!.getTime()) / (24 * 60 * 60 * 1000));
      if (diff === 1) current++;
      else break;
    }
  }

  let longest = 1;
  let running = 1;
  for (let i = 1; i < days.length; i++) {
    const diff = Math.round((days[i - 1]!.getTime() - days[i]!.getTime()) / (24 * 60 * 60 * 1000));
    if (diff === 1) {
      running++;
      if (running > longest) longest = running;
    } else {
      running = 1;
    }
  }

  return { current, longest };
}

// Today's habit status: for a set of metrics, return which are logged today
export async function getTodayHabitStatus(
  userId: string,
  metrics: string[]
): Promise<Record<string, { logged: boolean; value: number | null; recordedAt: string | null }>> {
  if (metrics.length === 0) return {};
  const tz = await userTz(userId);
  const start = startOfDay(new Date(), tz);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const measurements = await prisma.measurement.findMany({
    where: {
      userId,
      metric: { in: metrics as any },
      recordedAt: { gte: start, lt: end },
    },
    orderBy: { recordedAt: 'desc' },
  });
  const result: Record<string, { logged: boolean; value: number | null; recordedAt: string | null }> = {};
  for (const m of metrics) {
    result[m] = { logged: false, value: null, recordedAt: null };
  }
  for (const m of measurements) {
    const slot = result[m.metric];
    if (slot && !slot.logged) {
      result[m.metric] = {
        logged: true,
        value: m.value,
        recordedAt: m.recordedAt.toISOString(),
      };
    }
  }
  return result;
}