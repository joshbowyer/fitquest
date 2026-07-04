/**
 * Macro / timing nudges.
 *
 * Each rule reads a slice of the user's recent data and returns
 * either a Nudge (positive observation or warning) or null. Rules
 * are pure functions so they're easy to test + cheap to add.
 *
 * Pattern mirrors plateau.ts: gather pulls DB, rules are pure.
 * Output is two arrays:
 *   - warnings: shown in the morning report's ⚠ Watch section
 *   - positive: shown in a subtle "✓ Good calls" line below
 *
 * All rule thresholds are exported as constants so tests can pin
 * them — accidental tweaks to "warn at 14:00 vs 15:00" must be
 * intentional.
 */

import { prisma } from './prisma.js';
import { localDayKey } from './timezone.js';

// ---- Sleep-overlap nudge thresholds ----

/** Pre-sleep window (hours) for caffeine / nicotine / alcohol that
 *  we treat as "may have affected tonight's sleep". Tuned to
 *  caffeine half-life (~5-6h) and the practical effect of nicotine
 *  on latency. Alcohol falls off faster but the sleep-quality hit
 *  lasts longer; keeping one window keeps the rule simple. */
const SLEEP_OVERLAP_WINDOW_HOURS = 8;

/** Trigger the warning when this many of the last N nights had a
 *  category log in the pre-sleep window. Keeps the rule from
 *  firing on one isolated night out. */
const SLEEP_OVERLAP_MIN_NIGHTS = 3;
const SLEEP_OVERLAP_LOOKBACK_NIGHTS = 7;

// ---- Types ----

export type NudgeKind =
  | 'CAFFEINE_PRE_WORKOUT'
  | 'CAFFEINE_LATE'
  | 'CAFFEINE_CLUSTER'
  | 'CREATINE_GAP'
  | 'HYDRATION_LOW'
  | 'SUBSTANCE_SLEEP_OVERLAP';

export type NudgeSeverity = 'positive' | 'warn';

export type Nudge = {
  kind: NudgeKind;
  /** Short tag for chip rendering. */
  label: string;
  /** positive = green/cyan note; warn = amber caution. */
  severity: NudgeSeverity;
  /** Human-readable note (≤ 220 chars). */
  note: string;
  /** Numeric facts behind the nudge (tooltips, dashboards). */
  context?: Record<string, number | string>;
};

// ---- Thresholds ----

/** "Good caffeine timing" = log between 15 and 90 min before workout. */
export const CAFFEINE_PRE_WORKOUT_MIN_MIN = 15;
export const CAFFEINE_PRE_WORKOUT_MAX_MIN = 90;

/** Cutoff (local hour) for the late-caffeine warning. */
export const CAFFEINE_LATE_CUTOFF_HOUR = 14;

/** Caffeine entries in 24h that count as a cluster. */
export const CAFFEINE_CLUSTER_THRESHOLD = 4;

/** Creatine logs/week below which we nudge. */
export const CREATINE_GAP_THRESHOLD = 3;

/** Hydration shortfall (ml/day) that triggers the warn. */
export const HYDRATION_SHORTFALL_ML = 500;

// ---- Pure rule helpers ----

function inLastDays(d: Date, days: number, now: Date): boolean {
  return now.getTime() - d.getTime() < days * 24 * 60 * 60 * 1000;
}

function localHour(d: Date, tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const hour = parts.find((p) => p.type === 'hour')?.value;
    return hour ? Number(hour) : d.getUTCHours();
  } catch {
    return d.getUTCHours();
  }
}

// ---- Pure rule functions ----

/**
 * Fires when a caffeine entry landed in the 15-90min window before
 * a workout that same day. Positive observation — caffeine peak
 * overlaps training.
 */
export function caffeinePreWorkoutRule(
  workouts: Array<{ performedAt: Date }>,
  caffeine: Array<{ loggedAt: Date }>,
  now: Date,
): Nudge | null {
  // Only consider the most recent workout.
  const recent = workouts
    .filter((w) => inLastDays(w.performedAt, 2, now))
    .sort((a, b) => b.performedAt.getTime() - a.performedAt.getTime())[0];
  if (!recent) return null;

  // Did the user log caffeine in the pre-workout window?
  const before = caffeine
    .filter((c) => c.loggedAt.getTime() < recent.performedAt.getTime())
    .filter((c) => recent.performedAt.getTime() - c.loggedAt.getTime() < 4 * 60 * 60 * 1000); // within 4h before
  const window = before.find(
    (c) => {
      const mins = (recent.performedAt.getTime() - c.loggedAt.getTime()) / (60 * 1000);
      return mins >= CAFFEINE_PRE_WORKOUT_MIN_MIN && mins <= CAFFEINE_PRE_WORKOUT_MAX_MIN;
    },
  );
  if (!window) return null;
  const mins = Math.round((recent.performedAt.getTime() - window.loggedAt.getTime()) / (60 * 1000));
  return {
    kind: 'CAFFEINE_PRE_WORKOUT',
    label: 'Caffeine',
    severity: 'positive',
    note: `Caffeine logged ${mins}m before today's workout — timing lined up with the effect peak.`,
    context: { minutesBefore: mins },
  };
}

/**
 * Warns when caffeine was logged after 14:00 on a day that also
 * showed HRV below the user's recent baseline. Sleep-relevant.
 */
export function caffeineLateRule(
  caffeine: Array<{ loggedAt: Date }>,
  hrv: Array<{ value: number; recordedAt: Date }>,
  now: Date,
  tz: string,
): Nudge | null {
  const yesterdayCutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const lateEntries = caffeine.filter(
    (c) =>
      c.loggedAt.getTime() >= yesterdayCutoff.getTime() &&
      c.loggedAt.getTime() <= now.getTime() &&
      localHour(c.loggedAt, tz) >= CAFFEINE_LATE_CUTOFF_HOUR,
  );
  if (lateEntries.length === 0) return null;

  // Need an HRV dip in the last 24h to bother warning. Otherwise
  // the late caffeine isn't visibly hurting anything yet.
  const recentHrv = hrv.filter((h) => inLastDays(h.recordedAt, 1, now));
  if (recentHrv.length === 0) return null;
  const baselineHrv = hrv.filter((h) => inLastDays(h.recordedAt, 14, now));
  if (baselineHrv.length < 5) return null;
  const recentAvg = recentHrv.reduce((s, h) => s + h.value, 0) / recentHrv.length;
  const baselineAvg = baselineHrv.reduce((s, h) => s + h.value, 0) / baselineHrv.length;
  if (baselineAvg === 0) return null;
  const dipPct = ((baselineAvg - recentAvg) / baselineAvg) * 100;
  if (dipPct < 5) return null;

  return {
    kind: 'CAFFEINE_LATE',
    label: 'Late Caffeine',
    severity: 'warn',
    note: `Caffeine after ${CAFFEINE_LATE_CUTOFF_HOUR}:00 on a day HRV dipped ${dipPct.toFixed(0)}% — try cutting off earlier for 3 days.`,
    context: {
      lateCaffeineCount: lateEntries.length,
      hrvDipPct: Number(dipPct.toFixed(1)),
    },
  };
}

/**
 * Warns when 4+ caffeine entries landed in the last 24h. Could be
 * a high-training day (legit) or building tolerance (not).
 */
export function caffeineClusterRule(
  caffeine: Array<{ loggedAt: Date }>,
  now: Date,
): Nudge | null {
  const recent = caffeine.filter((c) => inLastDays(c.loggedAt, 1, now));
  if (recent.length < CAFFEINE_CLUSTER_THRESHOLD) return null;
  return {
    kind: 'CAFFEINE_CLUSTER',
    label: 'Caffeine',
    severity: 'warn',
    note: `${recent.length} caffeine entries in the last 24h — if this is the new normal, your tolerance is climbing and the effect is fading.`,
    context: { count24h: recent.length },
  };
}

/**
 * Warns when the user has User.creatine=true but < 3 logs in the
 * last 7 days. Skipped silently when the user isn't on creatine.
 */
export function creatineGapRule(
  userHasCreatineFlag: boolean,
  creatineLogs: Array<{ takenAt: Date }>,
  now: Date,
): Nudge | null {
  if (!userHasCreatineFlag) return null;
  const last7 = creatineLogs.filter((l) => inLastDays(l.takenAt, 7, now));
  // Only fire if there's at least some recent activity — don't nag
  // users who are still in their first week or who quit entirely.
  if (last7.length === 0) return null;
  if (last7.length >= CREATINE_GAP_THRESHOLD) return null;
  return {
    kind: 'CREATINE_GAP',
    label: 'Creatine',
    severity: 'warn',
    note: `Creatine on ${last7.length} of the last 7 days — the intracellular-water benefit takes ~1 week of daily dosing to restore after a gap.`,
    context: { logsLast7d: last7.length },
  };
}

/**
 * Warns when average daily water intake over the last 7 days is
 * more than 500ml below the user's water goal. Requires ≥3 days
 * of data to avoid nagging on one-off logging.
 */
export function hydrationLowRule(
  waterRows: Array<{ value: number; recordedAt: Date }>,
  targetMl: number,
  now: Date,
  tz: string | null = null,
): Nudge | null {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recent = waterRows.filter((w) => w.recordedAt.getTime() >= since.getTime());
  if (recent.length === 0) return null;
  // Bucket per user-tz day — was previously UTC-date bucketing
  // (the comment said "coarse aggregate, dashboard handles tz") but
  // a coarse aggregate that drifts by a day at midnight is still
  // wrong for non-UTC users.
  const perDay = new Map<string, number>();
  for (const w of recent) {
    const day = localDayKey(new Date(w.recordedAt), tz);
    perDay.set(day, (perDay.get(day) ?? 0) + w.value);
  }
  if (perDay.size < 3) return null;
  const avg = [...perDay.values()].reduce((s, v) => s + v, 0) / perDay.size;
  const shortfall = targetMl - avg;
  if (shortfall < HYDRATION_SHORTFALL_ML) return null;
  return {
    kind: 'HYDRATION_LOW',
    label: 'Hydration',
    severity: 'warn',
    note: `Avg ${Math.round(avg)}ml/day vs target ${targetMl}ml — ${Math.round(shortfall)}ml short. Affects HRV and cognitive performance.`,
    context: {
      avgMlPerDay: Math.round(avg),
      targetMl,
      shortfallMl: Math.round(shortfall),
      daysLogged: perDay.size,
    },
  };
}

// ---- Substance-sleep overlap rule ----

/**
 * Warns when the user has logged a category (caffeine / nicotine /
 * alcohol) within 8h before sleep onset on ≥3 of the last 7 nights.
 * Pure function — orchestrator below passes in pre-fetched data.
 *
 * The aggregate "behind the curtains" summary (median delta in
 * hours/quality between nights-with vs nights-without the category)
 * is computed by sleepCorrelation.ts and exposed to the LLM, not
 * surfaced as a UI nudge. This rule is the simple "you keep doing
 * X before bed" callout — visible, actionable.
 */
export function substanceSleepOverlapRule(
  sleepOnsets: Array<{ value: number; recordedAt: Date }>,
  substances: Array<{ category: string; loggedAt: Date }>,
  category: 'CAFFEINE' | 'ALCOHOL' | 'NICOTINE',
  tz: string,
): { nightsWith: number; nightsTotal: number; lastHoursBefore: number | null } | null {
  if (sleepOnsets.length === 0) return null;

  // Order onsets newest-first so the lookback window is the user's
  // most recent nights.
  const sorted = [...sleepOnsets].sort(
    (a, b) => b.recordedAt.getTime() - a.recordedAt.getTime(),
  );
  const window = sorted.slice(0, SLEEP_OVERLAP_LOOKBACK_NIGHTS);
  if (window.length < SLEEP_OVERLAP_MIN_NIGHTS) return null;

  // Helper: is any log of `category` within the window of this onset?
  const hasLogInWindow = (onset: { value: number; recordedAt: Date }): boolean => {
    for (const s of substances) {
      if (s.category !== category) continue;
      const hrs = hoursBeforeOnset(onset.value, onset.recordedAt, s.loggedAt, tz);
      if (hrs != null && hrs >= 0 && hrs <= SLEEP_OVERLAP_WINDOW_HOURS) return true;
    }
    return false;
  };

  const nightsWith = window.filter(hasLogInWindow).length;
  if (nightsWith < SLEEP_OVERLAP_MIN_NIGHTS) return null;

  // Find the closest pre-sleep log for the most recent night (for
  // the context number — useful for the LLM/UI hover).
  const last = window[0];
  let lastHoursBefore: number | null = null;
  for (const s of substances) {
    if (s.category !== category) continue;
    const hrs = hoursBeforeOnset(last.value, last.recordedAt, s.loggedAt, tz);
    if (hrs == null) continue;
    if (lastHoursBefore == null || (hrs >= 0 && hrs < lastHoursBefore)) {
      lastHoursBefore = hrs;
    }
  }

  return { nightsWith, nightsTotal: window.length, lastHoursBefore };
}

// ---- Pure helper (copied locally to avoid a circular import) ----

/** Mirror of hoursBeforeOnset in sleepCorrelation.ts — kept local
 *  so macroNudges.ts has zero DB-coupled imports. */
export function hoursBeforeOnset(
  sleepOnsetHours: number,
  sleepOnsetDate: Date,
  loggedAt: Date,
  tz: string,
): number | null {
  const logHour = hoursSinceLocalMidnight(loggedAt, tz);
  if (logHour == null) return null;
  const onsetDay = localDayKey(sleepOnsetDate, tz);
  const logDay = localDayKey(loggedAt, tz);
  const dayDelta = dayKeyDiff(onsetDay, logDay);
  if (dayDelta === 0) {
    return wrapHours(sleepOnsetHours - logHour);
  } else if (dayDelta === 1) {
    // Log was the previous calendar day (dayDelta = onsetDay - logDay = 1).
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
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

function wrapHours(h: number): number {
  return ((h % 24) + 24) % 24;
}

// ---- Orchestrator ----

export type MacroNudgesResult = {
  warnings: Nudge[];
  positive: Nudge[];
};

/**
 * Pull the user's recent substance + supplement + workout + water
 * data and run every nudge rule. Pure functions; no side effects.
 */
export async function buildMacroNudges(
  userId: string,
  now: Date = new Date(),
  tz: string = 'UTC',
  waterTargetMl: number = 0,
): Promise<MacroNudgesResult> {
  void waterTargetMl; // used downstream
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [caffeine, alcohol, nicotine, hrv, creatineLogs, water, workouts, sleepOnset, user] = await Promise.all([
    prisma.substanceLog.findMany({
      where: { userId, category: 'CAFFEINE', loggedAt: { gte: since7d } },
      select: { loggedAt: true, form: true, category: true },
    }),
    prisma.substanceLog.findMany({
      where: { userId, category: 'ALCOHOL', loggedAt: { gte: since7d } },
      select: { loggedAt: true, category: true },
    }),
    prisma.substanceLog.findMany({
      where: { userId, category: 'NICOTINE', loggedAt: { gte: since7d } },
      select: { loggedAt: true, category: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'HRV' as any, recordedAt: { gte: since14d } },
      select: { value: true, recordedAt: true },
    }),
    prisma.supplementLog.findMany({
      where: { userId, takenAt: { gte: since7d }, name: { contains: 'creatine', mode: 'insensitive' } },
      select: { takenAt: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'WATER_ML' as any, recordedAt: { gte: since7d } },
      select: { value: true, recordedAt: true },
    }),
    prisma.workout.findMany({
      where: { userId, performedAt: { gte: since7d } },
      select: { performedAt: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'SLEEP_ONSET' as any, recordedAt: { gte: since7d } },
      select: { value: true, recordedAt: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { creatine: true } }),
  ]);

  // Substance overlap rules: same shape, different categories.
  const allSubstances = [...caffeine, ...alcohol, ...nicotine];
  const overlaps: Nudge[] = [];
  for (const category of ['CAFFEINE', 'ALCOHOL', 'NICOTINE'] as const) {
    const r = substanceSleepOverlapRule(sleepOnset, allSubstances, category, tz);
    if (!r) continue;
    overlaps.push({
      kind: 'SUBSTANCE_SLEEP_OVERLAP',
      label: category === 'ALCOHOL' ? 'Alcohol' : category === 'NICOTINE' ? 'Nicotine' : 'Caffeine',
      severity: 'warn',
      note: `${category.toLowerCase()} within 8h of sleep on ${r.nightsWith} of last ${r.nightsTotal} nights — check the recovery panel for the duration/quality impact.`,
      context: {
        nightsWith: r.nightsWith,
        nightsTotal: r.nightsTotal,
        lastHoursBefore: r.lastHoursBefore ?? undefined,
      },
    });
  }

  const rules: Array<Nudge | null> = [
    caffeinePreWorkoutRule(workouts, caffeine, now),
    caffeineLateRule(caffeine, hrv, now, tz),
    caffeineClusterRule(caffeine, now),
    creatineGapRule(!!user?.creatine, creatineLogs, now),
    hydrationLowRule(water, waterTargetMl, now, tz),
    ...overlaps,
  ];

  const nudges = rules.filter((n): n is Nudge => n != null);
  return {
    warnings: nudges.filter((n) => n.severity === 'warn'),
    positive: nudges.filter((n) => n.severity === 'positive'),
  };
}
