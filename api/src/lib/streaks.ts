import { prisma } from './prisma.js';

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export type WeighInStreak = {
  current: number;
  longest: number;
  lastDate: string | null;
};

export async function getWeighInStreak(userId: string): Promise<WeighInStreak> {
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
    days.add(dayKey(new Date(m.recordedAt)));
  }
  const sortedDesc = Array.from(days)
    .map((k) => {
      const parts = k.split('-').map(Number);
      const y = parts[0] ?? 1970;
      const m = parts[1] ?? 0;
      const d = parts[2] ?? 1;
      return startOfDay(new Date(y, m, d));
    })
    .sort((a, b) => b.getTime() - a.getTime());

  // Current streak: start from today or yesterday, count consecutive days
  const today = startOfDay(new Date());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
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
  const start = startOfDay(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
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
  const start = startOfDay(new Date());
  start.setDate(start.getDate() - (days - 1));
  const end = new Date(start);
  end.setDate(end.getDate() + days);

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
    const k = dayKey(d);
    const existing = firstOfDay.get(k);
    if (!existing || m.recordedAt.getTime() < existing.ts) {
      firstOfDay.set(k, { value: m.value, ts: m.recordedAt.getTime() });
    }
  }

  const series: WeightTrendPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const k = dayKey(d);
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
