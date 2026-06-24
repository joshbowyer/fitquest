/**
 * Body Battery correlation engine.
 *
 * Same shape as sleepCorrelation.ts: pulls the user's recent body
 * battery readings, joins them with sleep onset/quality/duration
 * and substance logs, and computes "behind the curtains"
 * correlations the morning report LLM can quote.
 *
 * Body Battery is Garmin's 0-100 readiness score. Higher = more
 * recovered. The interesting questions:
 *   - How does sleep onset / duration / quality predict next-day BB?
 *   - How does caffeine/alcohol/nicotine in the 8h before bed affect
 *     morning BB?
 *   - How does training load (volume, sessions, intensity) affect
 *     next-day BB?
 *
 * Returns a bodyBatteryReport + a summary string for the LLM.
 */

import { prisma } from './prisma.js';

// ---- Thresholds ----

/** Pre-sleep window (hours) for substance→BB correlation. Matches
 *  the sleep-correlation rule for consistency. */
const PRE_SLEEP_WINDOW_HOURS = 8;

/** Minimum sample size to include a comparison in the LLM summary. */
const MIN_NIGHTS_FOR_SUMMARY = 4;

// ---- Types ----

export type BodyBatteryOverlap = {
  /** What we're comparing against (e.g. "sleep onset before 11pm"). */
  label: string;
  /** Sample size on each side. */
  withCount: number;
  withoutCount: number;
  /** Median next-day BB on mornings with this condition. */
  medianBbWith: number | null;
  /** Median next-day BB on mornings without this condition. */
  medianBbWithout: number | null;
};

export type BodyBatteryReport = {
  windowDays: number;
  morningsTotal: number;
  /** Most recent morning's BB + what preceded it. */
  lastMorning: {
    bb: number | null;
    recordedAt: string | null;
    sleepHours: number | null;
    sleepOnset: number | null;
    sleepQuality: number | null;
    caffeineInWindow: boolean;
    alcoholInWindow: boolean;
    nicotineInWindow: boolean;
    workoutsInLast24h: number;
  } | null;
  overlaps: BodyBatteryOverlap[];
};

// ---- Pure helpers ----

function localDayKey(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function hoursSinceLocalMidnight(d: Date, tz: string): number | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 'NaN');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 'NaN');
    const second = Number(parts.find((p) => p.type === 'second')?.value ?? 'NaN');
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour + minute / 60 + second / 3600;
  } catch {
    return null;
  }
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[m - 1] + sorted[m]) / 2) * 100) / 100
    : sorted[m];
}

// ---- Orchestrator ----

/**
 * Pull the user's recent body battery + sleep + substance + workout
 * data and compute a correlation report. Pure: takes data in,
 * returns data out. The morning report's LLM fold this in via
 * summarizeForLlm().
 */
export async function buildBodyBatteryReport(
  userId: string,
  tz: string,
  windowDays = 14,
  now: Date = new Date(),
): Promise<BodyBatteryReport> {
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const [bb, sleepHours, sleepOnset, sleepQuality, substance, workouts] = await Promise.all([
    prisma.measurement.findMany({
      where: { userId, metric: 'BODY_BATTERY' as any, recordedAt: { gte: since } },
      select: { value: true, recordedAt: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'SLEEP_HOURS' as any, recordedAt: { gte: since } },
      select: { value: true, recordedAt: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'SLEEP_ONSET' as any, recordedAt: { gte: since } },
      select: { value: true, recordedAt: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'SLEEP_QUALITY' as any, recordedAt: { gte: since } },
      select: { value: true, recordedAt: true },
    }),
    prisma.substanceLog.findMany({
      where: { userId, loggedAt: { gte: since } },
      select: { category: true, loggedAt: true },
    }),
    prisma.workout.findMany({
      where: { userId, performedAt: { gte: since } },
      select: { performedAt: true },
    }),
  ]);

  // Bucket per local day. BB on day X reflects "morning of day X",
  // which is set by the sleep that ended in the morning of day X.
  // Sleep onset on day X is the onset that produced that BB (might
  // be the previous calendar day's late-night onset).
  const bbByDay = new Map<string, { value: number; recordedAt: Date }>();
  for (const r of bb) {
    const k = localDayKey(r.recordedAt, tz);
    const existing = bbByDay.get(k);
    if (!existing || existing.value < r.value) bbByDay.set(k, { value: r.value, recordedAt: r.recordedAt });
  }
  const hoursByDay = new Map<string, number>();
  for (const r of sleepHours) hoursByDay.set(localDayKey(r.recordedAt, tz), r.value);
  const onsetByDay = new Map<string, number>();
  for (const r of sleepOnset) onsetByDay.set(localDayKey(r.recordedAt, tz), r.value);
  const qualityByDay = new Map<string, number>();
  for (const r of sleepQuality) qualityByDay.set(localDayKey(r.recordedAt, tz), r.value);

  // For overlap analysis, look back at the sleep that ended in the
  // morning of day X: that's the SLEEP that started at onsetByDay[X-1]
  // (or onsetByDay[X] for sleep that crossed midnight forward).
  // For substance analysis, look at logs in the 8h before that onset.
  const days = [...bbByDay.keys()].sort();
  const morningsTotal = days.length;

  // Helper: any substance log within 8h before the sleep onset that
  // ended the morning of `day`?
  const hadCategoryBeforeOnset = (
    day: string,
    category: 'CAFFEINE' | 'ALCOHOL' | 'NICOTINE',
  ): boolean => {
    const onsetHours = onsetByDay.get(day);
    if (onsetHours == null) return false;
    const onsetDayStart = new Date(`${day}T00:00:00`);
    const dayKey = localDayKey(onsetDayStart, tz);
    // Walk back: 8h before onset can land on the same day or previous day.
    for (const s of substance) {
      if (s.category !== category) continue;
      const logHour = hoursSinceLocalMidnight(s.loggedAt, tz);
      if (logHour == null) continue;
      const logDayKey = localDayKey(s.loggedAt, tz);
      const dayDelta = dayDiff(dayKey, logDayKey);
      let hrsBefore: number;
      if (dayDelta === 0) hrsBefore = ((onsetHours - logHour) % 24 + 24) % 24;
      else if (dayDelta === 1) hrsBefore = ((24 - logHour + onsetHours) % 24 + 24) % 24;
      else continue;
      if (hrsBefore > 0 && hrsBefore <= PRE_SLEEP_WINDOW_HOURS) return true;
    }
    return false;
  };

  function dayDiff(a: string, b: string): number {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
  }

  const overlaps: BodyBatteryOverlap[] = [];

  // Overlap 1: Late sleep onset (≥ 23:00 = 11pm)
  {
    const withArr: number[] = [];
    const withoutArr: number[] = [];
    for (const day of days) {
      const bb = bbByDay.get(day);
      if (!bb) continue;
      const onset = onsetByDay.get(day);
      if (onset == null) continue;
      // onset 23+ means ≥ 11pm local
      if (onset >= 23) withArr.push(bb.value);
      else withoutArr.push(bb.value);
    }
    overlaps.push({
      label: 'sleep onset ≥ 11pm',
      withCount: withArr.length,
      withoutCount: withoutArr.length,
      medianBbWith: median(withArr),
      medianBbWithout: median(withoutArr),
    });
  }

  // Overlap 2: Short sleep (< 7h)
  {
    const withArr: number[] = [];
    const withoutArr: number[] = [];
    for (const day of days) {
      const bb = bbByDay.get(day);
      if (!bb) continue;
      const hours = hoursByDay.get(day);
      if (hours == null) continue;
      if (hours < 7) withArr.push(bb.value);
      else withoutArr.push(bb.value);
    }
    overlaps.push({
      label: 'sleep < 7h',
      withCount: withArr.length,
      withoutCount: withoutArr.length,
      medianBbWith: median(withArr),
      medianBbWithout: median(withoutArr),
    });
  }

  // Overlap 3: Low sleep quality (< 7/10)
  {
    const withArr: number[] = [];
    const withoutArr: number[] = [];
    for (const day of days) {
      const bb = bbByDay.get(day);
      if (!bb) continue;
      const q = qualityByDay.get(day);
      if (q == null) continue;
      if (q < 7) withArr.push(bb.value);
      else withoutArr.push(bb.value);
    }
    overlaps.push({
      label: 'sleep quality < 7/10',
      withCount: withArr.length,
      withoutCount: withoutArr.length,
      medianBbWith: median(withArr),
      medianBbWithout: median(withoutArr),
    });
  }

  // Overlap 4: Caffeine in 8h before sleep
  {
    const withArr: number[] = [];
    const withoutArr: number[] = [];
    for (const day of days) {
      const bb = bbByDay.get(day);
      if (!bb) continue;
      if (hadCategoryBeforeOnset(day, 'CAFFEINE')) withArr.push(bb.value);
      else withoutArr.push(bb.value);
    }
    overlaps.push({
      label: 'caffeine < 8h before sleep',
      withCount: withArr.length,
      withoutCount: withoutArr.length,
      medianBbWith: median(withArr),
      medianBbWithout: median(withoutArr),
    });
  }

  // Overlap 5: Alcohol in 8h before sleep
  {
    const withArr: number[] = [];
    const withoutArr: number[] = [];
    for (const day of days) {
      const bb = bbByDay.get(day);
      if (!bb) continue;
      if (hadCategoryBeforeOnset(day, 'ALCOHOL')) withArr.push(bb.value);
      else withoutArr.push(bb.value);
    }
    overlaps.push({
      label: 'alcohol < 8h before sleep',
      withCount: withArr.length,
      withoutCount: withoutArr.length,
      medianBbWith: median(withArr),
      medianBbWithout: median(withoutArr),
    });
  }

  // Overlap 6: Trained yesterday (≥ 1 workout in 24h before BB)
  {
    const withArr: number[] = [];
    const withoutArr: number[] = [];
    for (const day of days) {
      const bb = bbByDay.get(day);
      if (!bb) continue;
      const dayStart = new Date(`${day}T00:00:00`);
      const yesterday = dayStart.getTime() - 24 * 60 * 60 * 1000;
      const trainedYesterday = workouts.some(
        (w) => w.performedAt.getTime() >= yesterday && w.performedAt.getTime() <= dayStart.getTime(),
      );
      if (trainedYesterday) withArr.push(bb.value);
      else withoutArr.push(bb.value);
    }
    overlaps.push({
      label: 'trained yesterday',
      withCount: withArr.length,
      withoutCount: withoutArr.length,
      medianBbWith: median(withArr),
      medianBbWithout: median(withoutArr),
    });
  }

  // Last morning: most recent BB + the conditions that preceded it
  const lastDay = days[days.length - 1];
  let lastMorning: BodyBatteryReport['lastMorning'] = null;
  if (lastDay) {
    const bb = bbByDay.get(lastDay);
    const dayStart = new Date(`${lastDay}T00:00:00`);
    const yesterday = dayStart.getTime() - 24 * 60 * 60 * 1000;
    const workoutsInLast24h = workouts.filter(
      (w) => w.performedAt.getTime() >= yesterday && w.performedAt.getTime() <= dayStart.getTime(),
    ).length;
    lastMorning = {
      bb: bb?.value ?? null,
      recordedAt: bb?.recordedAt.toISOString() ?? null,
      sleepHours: hoursByDay.get(lastDay) ?? null,
      sleepOnset: onsetByDay.get(lastDay) ?? null,
      sleepQuality: qualityByDay.get(lastDay) ?? null,
      caffeineInWindow: hadCategoryBeforeOnset(lastDay, 'CAFFEINE'),
      alcoholInWindow: hadCategoryBeforeOnset(lastDay, 'ALCOHOL'),
      nicotineInWindow: hadCategoryBeforeOnset(lastDay, 'NICOTINE'),
      workoutsInLast24h,
    };
  }

  return { windowDays, morningsTotal, lastMorning, overlaps };
}

/**
 * Compress a BodyBatteryReport into short lines the morning report's
 * LLM can quote verbatim when relevant. Returns "" when the sample
 * is too small to draw conclusions.
 */
export function summarizeBbForLlm(report: BodyBatteryReport): string {
  if (report.morningsTotal < MIN_NIGHTS_FOR_SUMMARY) return '';
  const lines: string[] = [];
  for (const o of report.overlaps) {
    if (o.medianBbWith == null || o.medianBbWithout == null) continue;
    if (o.withCount < 2 && o.withoutCount < 2) continue;
    const delta = o.medianBbWith - o.medianBbWithout;
    if (Math.abs(delta) < 5) continue;
    const direction = delta > 0 ? 'higher' : 'lower';
    lines.push(
      `next-day body battery ${direction} on mornings after ${o.label}: ${o.medianBbWith.toFixed(0)} vs ${o.medianBbWithout.toFixed(0)} (${Math.abs(delta).toFixed(0)}-pt delta, ${o.withCount} vs ${o.withoutCount} mornings)`,
    );
  }
  if (report.lastMorning && report.lastMorning.bb != null) {
    const m = report.lastMorning;
    const parts: string[] = [];
    if (m.sleepHours != null) parts.push(`${m.sleepHours.toFixed(1)}h sleep`);
    if (m.sleepQuality != null) parts.push(`quality ${m.sleepQuality}/10`);
    if (m.caffeineInWindow) parts.push('caffeine before bed');
    if (m.alcoholInWindow) parts.push('alcohol before bed');
    if (m.workoutsInLast24h > 0) parts.push(`${m.workoutsInLast24h} workout${m.workoutsInLast24h === 1 ? '' : 's'}`);
    lines.push(
      `latest body battery ${m.bb}/100 — ${parts.length > 0 ? parts.join(', ') : 'no notable context'}`,
    );
  }
  return lines.join('\n');
}
