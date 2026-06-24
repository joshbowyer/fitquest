/**
 * Sleep-onset correlation helpers.
 *
 * Pulls the user's substance + supplement timing relative to recent
 * sleep onset, quality, and duration. Computes:
 *   - hoursBeforeOnset per category (caffeine, alcohol, nicotine)
 *   - simple median split: compare median onset/quality/duration on
 *     nights WITH a category log in the 8h before onset vs WITHOUT
 *
 * Exposed to the morning report payload so the LLM can fold "your
 * nights after alcohol averaged 1.5h less sleep" into the recovery
 * section without us having to do anything fancier. Surfaces a
 * small "behind the curtains" aggregation — never to the UI
 * directly (the user wants this for the LLM, not a chart).
 *
 * Pure: takes data in, returns data out. Persistence + DB queries
 * happen in the orchestrator below.
 */

import { prisma } from './prisma.js';

// ---- Thresholds ----

/** Anything logged within this many hours before sleep onset is
 *  considered "pre-sleep" timing. Caffeine has a longer half-life
 *  but for correlation purposes we keep one window. */
export const PRE_SLEEP_WINDOW_HOURS = 8;

// ---- Types ----

export type Category = 'CAFFEINE' | 'ALCOHOL' | 'NICOTINE';

export type CategoryOverlap = {
  category: Category;
  /** Number of nights with at least one log of this category
   *  in the 8h before sleep onset, in the analysis window. */
  nightsWith: number;
  /** Total nights with onset data in the window. */
  nightsTotal: number;
  /** Median sleep duration (hours) on nights WITH this category. */
  medianHoursWith: number | null;
  /** Median sleep duration (hours) on nights WITHOUT this category. */
  medianHoursWithout: number | null;
  /** Median sleep quality (1-10) on nights WITH. */
  medianQualityWith: number | null;
  /** Median sleep quality (1-10) on nights WITHOUT. */
  medianQualityWithout: number | null;
  /** Median onset (hours since midnight) on nights WITH. */
  medianOnsetWith: number | null;
  /** Median onset (hours since midnight) on nights WITHOUT. */
  medianOnsetWithout: number | null;
};

export type SupplementOverlap = {
  name: string;
  nightsWith: number;
  nightsTotal: number;
  medianHoursWith: number | null;
  medianHoursWithout: number | null;
};

export type SleepOverlapReport = {
  windowDays: number;
  nightsTotal: number;
  /** Last night's hours-before-onset per category (newest first). */
  lastNight: Array<{
    category: Category;
    hoursBefore: number | null;
  }>;
  categories: CategoryOverlap[];
  supplements: SupplementOverlap[];
};

// ---- Pure helpers ----

/** Wrap a fractional hours-since-midnight into the 0..24 range.
 *  Defensive — callers should already be in range. */
function wrapHours(h: number): number {
  return ((h % 24) + 24) % 24;
}

/** Compute hours-before-onset given:
 *  - sleepOnsetHours: fractional hours since local midnight (e.g. 23.5)
 *  - loggedAt: a Date for the substance log
 *  - tz: IANA timezone used to read the local hour of the substance log
 *  Returns null if loggedAt is on a different calendar day from the
 *  sleep (we only count same-day or next-day-before-onset timing). */
export function hoursBeforeOnset(
  sleepOnsetHours: number,
  sleepOnsetDate: Date,
  loggedAt: Date,
  tz: string,
): number | null {
  const logHour = hoursSinceLocalMidnight(loggedAt, tz);
  if (logHour == null) return null;

  // Determine which calendar date the substance log belongs to
  // relative to the sleep onset date. We use the local calendar
  // day of the onset as anchor: logs on the same local date are
  // pre-sleep (counted positive); logs on the previous date with
  // logHour > onsetHours are also pre-sleep.
  const onsetDay = localDayKey(sleepOnsetDate, tz);
  const logDay = localDayKey(loggedAt, tz);
  const dayDelta = dayKeyDiff(onsetDay, logDay);

  if (dayDelta === 0) {
    // Same day: hours before = onset - logHour (positive if log was earlier).
    return wrapHours(sleepOnsetHours - logHour);
  } else if (dayDelta === 1) {
    // Log was the previous calendar day (dayDelta = onsetDay - logDay = 1).
    // Distance to onset = (24 - logHour) + sleepOnsetHours.
    return wrapHours(24 - logHour + sleepOnsetHours);
  } else if (dayDelta === -1) {
    // Log is the next calendar day after onset (e.g. caffeine at 3am
    // after waking) — negative distance, hours AFTER sleep.
    return -wrapHours(logHour - sleepOnsetHours);
  }
  return null;
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

function dayKeyDiff(a: string, b: string): number {
  // Returns a - b in days.
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const aMs = Date.UTC(ay, am - 1, ad);
  const bMs = Date.UTC(by, bm - 1, bd);
  return Math.round((aMs - bMs) / (24 * 60 * 60 * 1000));
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
 * Pull the user's recent sleep + substance + supplement data and
 * compute a behind-the-curtains overlap report. Pure function
 * shaped so the morning report can fold any notable delta into
 * its recovery section ("nights after alcohol: 5.2h vs 7.1h on
 * alcohol-free nights").
 */
export async function buildSleepOverlapReport(
  userId: string,
  tz: string,
  windowDays = 14,
  now: Date = new Date(),
): Promise<SleepOverlapReport> {
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const [sleepOnset, sleepHours, sleepQuality, substance, supplements] = await Promise.all([
    prisma.measurement.findMany({
      where: { userId, metric: 'SLEEP_ONSET' as any, recordedAt: { gte: since } },
      select: { value: true, recordedAt: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'SLEEP_HOURS' as any, recordedAt: { gte: since } },
      select: { value: true, recordedAt: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'SLEEP_QUALITY' as any, recordedAt: { gte: since } },
      select: { value: true, recordedAt: true },
    }),
    prisma.substanceLog.findMany({
      where: { userId, loggedAt: { gte: since } },
      select: { category: true, loggedAt: true, form: true },
    }),
    prisma.supplementLog.findMany({
      where: { userId, takenAt: { gte: since } },
      select: { name: true, takenAt: true },
    }),
  ]);

  // Index sleep metrics by local calendar day of recordedAt.
  // We key by the recordedAt day so joining with hoursBeforeOnset
  // works on the same anchor.
  const hoursByDay = new Map<string, number>();
  const qualityByDay = new Map<string, number>();
  const onsetByDay = new Map<string, { hours: number; date: Date }>();
  for (const r of sleepOnset) {
    const k = localDayKey(r.recordedAt, tz);
    onsetByDay.set(k, { hours: r.value, date: r.recordedAt });
  }
  for (const r of sleepHours) hoursByDay.set(localDayKey(r.recordedAt, tz), r.value);
  for (const r of sleepQuality) qualityByDay.set(localDayKey(r.recordedAt, tz), r.value);

  const nightsTotal = onsetByDay.size;

  // Helper: did a category log happen within 8h before this night's onset?
  const hasCategoryBeforeOnset = (
    onsetDay: string,
    onsetInfo: { hours: number; date: Date },
    category: Category,
  ): boolean => {
    for (const s of substance) {
      if (s.category !== category) continue;
      const hrs = hoursBeforeOnset(onsetInfo.hours, onsetInfo.date, s.loggedAt, tz);
      if (hrs != null && hrs >= 0 && hrs <= PRE_SLEEP_WINDOW_HOURS) return true;
    }
    return false;
  };

  const categoryOverlaps: CategoryOverlap[] = (
    ['CAFFEINE', 'ALCOHOL', 'NICOTINE'] as Category[]
  ).map((category) => {
    let nightsWith = 0;
    const hoursWith: number[] = [];
    const hoursWithout: number[] = [];
    const qualityWith: number[] = [];
    const qualityWithout: number[] = [];
    const onsetWith: number[] = [];
    const onsetWithout: number[] = [];
    for (const [day, info] of onsetByDay) {
      const flag = hasCategoryBeforeOnset(day, info, category);
      if (flag) {
        nightsWith++;
        const h = hoursByDay.get(day);
        const q = qualityByDay.get(day);
        if (h != null) hoursWith.push(h);
        if (q != null) qualityWith.push(q);
        onsetWith.push(info.hours);
      } else {
        const h = hoursByDay.get(day);
        const q = qualityByDay.get(day);
        if (h != null) hoursWithout.push(h);
        if (q != null) qualityWithout.push(q);
        onsetWithout.push(info.hours);
      }
    }
    return {
      category,
      nightsWith,
      nightsTotal,
      medianHoursWith: median(hoursWith),
      medianHoursWithout: median(hoursWithout),
      medianQualityWith: median(qualityWith),
      medianQualityWithout: median(qualityWithout),
      medianOnsetWith: median(onsetWith),
      medianOnsetWithout: median(onsetWithout),
    };
  });

  // Supplement-level analysis: any supplement logged ≥3 nights with
  // pre-sleep timing. Filters out occasional supps so the LLM
  // doesn't get a wall of irrelevant comparisons.
  const supplementNightsByName = new Map<string, { with: number; hoursWith: number[]; hoursWithout: number[] }>();
  for (const [day, info] of onsetByDay) {
    for (const sup of supplements) {
      const hrs = hoursBeforeOnset(info.hours, info.date, sup.takenAt, tz);
      if (hrs == null || hrs < 0 || hrs > PRE_SLEEP_WINDOW_HOURS) continue;
      const key = sup.name.toLowerCase().trim();
      if (!supplementNightsByName.has(key)) {
        supplementNightsByName.set(key, { with: 0, hoursWith: [], hoursWithout: [] });
      }
      const acc = supplementNightsByName.get(key)!;
      acc.with++;
      const h = hoursByDay.get(day);
      if (h != null) acc.hoursWith.push(h);
    }
  }
  // Now compute "without" hours for each supplement.
  const supplementOverlaps: SupplementOverlap[] = [];
  for (const [key, acc] of supplementNightsByName) {
    if (acc.with < 3) continue; // not enough data to bother
    const hoursWithout: number[] = [];
    for (const [day, info] of onsetByDay) {
      const wasTaken = supplements.some((s) => {
        if (s.name.toLowerCase().trim() !== key) return false;
        const hrs = hoursBeforeOnset(info.hours, info.date, s.takenAt, tz);
        return hrs != null && hrs >= 0 && hrs <= PRE_SLEEP_WINDOW_HOURS;
      });
      if (!wasTaken) {
        const h = hoursByDay.get(day);
        if (h != null) hoursWithout.push(h);
      }
    }
    supplementOverlaps.push({
      name: key,
      nightsWith: acc.with,
      nightsTotal,
      medianHoursWith: median(acc.hoursWith),
      medianHoursWithout: median(hoursWithout),
    });
  }

  // Last-night "what did you have before bed" summary (last 7 days).
  const lastNight: SleepOverlapReport['lastNight'] = [];
  const sortedOnsets = [...onsetByDay.entries()]
    .sort((a, b) => b[1].date.getTime() - a[1].date.getTime())
    .slice(0, 7);
  if (sortedOnsets.length > 0) {
    const [_, lastInfo] = sortedOnsets[0];
    for (const category of ['CAFFEINE', 'ALCOHOL', 'NICOTINE'] as Category[]) {
      let lastHrs: number | null = null;
      for (const s of substance) {
        if (s.category !== category) continue;
        const hrs = hoursBeforeOnset(lastInfo.hours, lastInfo.date, s.loggedAt, tz);
        if (hrs == null) continue;
        // Keep the closest pre-sleep match.
        if (lastHrs == null || (hrs >= 0 && hrs < lastHrs)) lastHrs = hrs;
      }
      lastNight.push({ category, hoursBefore: lastHrs });
    }
  }

  return {
    windowDays,
    nightsTotal,
    lastNight,
    categories: categoryOverlaps,
    supplements: supplementOverlaps,
  };
}

/**
 * Compress a SleepOverlapReport into a short string the morning
 * report's LLM can quote verbatim when relevant. Returns "" when
 * there's nothing notable (no data, or all medians within 30min).
 */
export function summarizeForLlm(report: SleepOverlapReport): string {
  if (report.nightsTotal < 3) return '';
  const lines: string[] = [];
  for (const c of report.categories) {
    if (c.nightsWith < 2) continue;
    if (
      c.medianHoursWith == null ||
      c.medianHoursWithout == null
    ) continue;
    const delta = c.medianHoursWith - c.medianHoursWithout;
    if (Math.abs(delta) < 0.5) continue;
    const direction = delta < 0 ? 'less' : 'more';
    lines.push(
      `${c.category.toLowerCase()} before sleep: ${c.medianHoursWith.toFixed(1)}h vs ${c.medianHoursWithout.toFixed(1)}h (${Math.abs(delta).toFixed(1)}h ${direction} on ${c.nightsWith}/${report.nightsTotal} nights)`,
    );
  }
  for (const s of report.supplements) {
    if (s.medianHoursWith == null || s.medianHoursWithout == null) continue;
    const delta = s.medianHoursWith - s.medianHoursWithout;
    if (Math.abs(delta) < 0.5) continue;
    const direction = delta < 0 ? 'less' : 'more';
    lines.push(
      `${s.name} pre-sleep: ${s.medianHoursWith.toFixed(1)}h vs ${s.medianHoursWithout.toFixed(1)}h (${Math.abs(delta).toFixed(1)}h ${direction} on ${s.nightsWith}/${report.nightsTotal} nights)`,
    );
  }
  return lines.join('\n');
}
