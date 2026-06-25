/**
 * Check-in cadence system. Splits the ~30 measurement types into
 * time-of-day buckets so the dashboard can prompt the user to log
 * the right things at the right time, instead of hoping they
 * remember.
 *
 * Cadence buckets:
 *   - AM:    surfaced 05:00–11:59 local, "logged today" required
 *   - PM:    surfaced 17:00–23:59 local, "logged today" required
 *   - WEEKLY: surfaced anytime; "logged in last 7 days" required
 *
 * Rationale:
 *   - Weight, mood, energy, soreness, sleep quality, resting HR, HRV
 *     are all post-wakeup signals. They need AM.
 *   - Stress, end-of-day mood delta, alcohol/caffeine units are PM.
 *   - Body comp (waist, neck, chest, etc.) and 1RMs change slowly —
 *     weekly is the right cadence.
 *
 * Future: a MONTHLY bucket will exist when we add photo + bloodwork
 * metric types. For now nothing fits monthly that doesn't fit weekly.
 *
 * The dashboard's <CheckInsPanel /> only shows cadence groups that
 * have at least one overdue metric, max 3 cards. PM only renders
 * after 17:00 local to avoid double-prompting in the morning.
 *
 * NOTE: All measurement timestamps are stored in UTC. We compare in
 * the user's local timezone via `User.timezone` (IANA name). If the
 * user has no timezone set, we fall back to UTC and the AM/PM
 * windows become meaningless — that's a logged-out / fresh-account
 * edge case that resolves itself once they set a timezone.
 */
import type { MetricType } from './prisma.js';

export type Cadence = 'AM' | 'PM' | 'WEEKLY';

export const CADENCES: Cadence[] = ['AM', 'PM', 'WEEKLY'];

export const CADENCE_LABEL: Record<Cadence, string> = {
  AM: 'Morning check-in',
  PM: 'Evening check-in',
  WEEKLY: 'Weekly check-in',
};

export const CADENCE_GLYPH: Record<Cadence, string> = {
  AM: '☀',
  PM: '☾',
  WEEKLY: '◷',
};

/// Time windows in 24h local time. The minute-of-day boundaries are
/// inclusive start, exclusive end.
export const CADENCE_WINDOWS: Record<Cadence, { startHour: number; endHour: number }> = {
  AM:    { startHour: 5,  endHour: 12 },
  PM:    { startHour: 17, endHour: 24 },
  WEEKLY: { startHour: 0,  endHour: 24 },
};

/**
 * Default cadence for each metric. This is the canonical mapping —
 * the only source of truth for "which bucket does X belong to".
 *
 * The frontend's /check-ins page renders this same map (mirrored to
 * web/src/lib/checkIns.ts so we don't need a round-trip) so the
 * dashboard and the settings panel always agree.
 */
export const DEFAULT_CADENCE: Record<MetricType, Cadence> = {
  // AM — post-wakeup signals
  WEIGHT:        'AM',
  MOOD:          'AM', // (also surfaced in PM as "end-of-day delta")
  ENERGY:        'AM', // (also surfaced in PM)
  SORENESS:      'AM',
  SLEEP_QUALITY: 'AM',
  RESTING_HR:    'AM',
  HRV:           'AM',

  // PM — evening / end-of-day
  STRESS: 'PM',

  // WEEKLY — body comp, strength PRs, calisthenics PRs, cardio PRs
  WAIST:        'WEEKLY',
  NECK:         'WEEKLY',
  CHEST:        'WEEKLY',
  BICEP:        'WEEKLY',
  FOREARM:      'WEEKLY',
  QUAD:         'WEEKLY',
  CALF:         'WEEKLY',
  SHOULDER:     'WEEKLY',
  BODY_FAT_PCT: 'WEEKLY',
  BENCH_1RM:    'WEEKLY',
  SQUAT_1RM:    'WEEKLY',
  DEADLIFT_1RM: 'WEEKLY',
  OHP_1RM:      'WEEKLY',
  PULLUP_1RM:   'WEEKLY',
  POWERLIFT_TOTAL: 'WEEKLY',
  VO2_MAX:      'WEEKLY',
  FIVE_K_TIME:  'WEEKLY',
  ONE_MILE_TIME:'WEEKLY',
  PLANK_HOLD:   'WEEKLY',
  L_SIT_HOLD:   'WEEKLY',
  PUSHUP_MAX:   'WEEKLY',
  PULLUP_MAX:   'WEEKLY',

  // Derived — auto-computed, never directly logged by the user.
  // Mapped to WEEKLY so they appear in the cadence list with the
  // right cadence, but the UI should hide the "log" button for
  // these. The Measurements page already does that.
  LEAN_MASS:            'WEEKLY',
  FFMI:                 'WEEKLY',
  SHOULDER_WAIST_RATIO: 'WEEKLY',

  // SLEEP_HOURS, CALORIES, PROTEIN_G, WATER_ML — daily aggregates,
  // not really "check-ins". They're logged via Recovery / Nutrition
  // pages. Don't surface in check-in panels.
  SLEEP_HOURS: 'AM',
  CALORIES:    'WEEKLY', // never surfaced (placeholder)
  PROTEIN_G:   'WEEKLY', // never surfaced (placeholder)
  WATER_ML:    'WEEKLY', // never surfaced (placeholder)
};

/**
 * Metrics that the check-in UI should NEVER surface, even though
 * they have a cadence. These are daily aggregates / derived metrics
 * that are logged elsewhere (Recovery, Nutrition, derived displays).
 */
export const NEVER_SURFACED: ReadonlySet<MetricType> = new Set([
  'CALORIES',
  'PROTEIN_G',
  'WATER_ML',
  'LEAN_MASS',
  'FFMI',
  'SHOULDER_WAIST_RATIO',
  'SLEEP_HOURS',
]);

/** True if the metric should appear on the dashboard / check-ins page. */
export function isCheckInMetric(m: MetricType): boolean {
  return !NEVER_SURFACED.has(m);
}

/**
 * Determine whether `now` (in user's local timezone) is within the
 * AM or PM window. WEEKLY is always "in window" since it has no
 * time-of-day constraint.
 */
export function isWithinWindow(cadence: Cadence, now: Date, timezone: string | null): boolean {
  if (cadence === 'WEEKLY') return true;
  const hour = getLocalHour(now, timezone);
  const w = CADENCE_WINDOWS[cadence];
  return hour >= w.startHour && hour < w.endHour;
}

/**
 * Get the local hour (0-23) for `now` in the given IANA timezone.
 * Falls back to UTC hour if the timezone is null or invalid.
 */
export function getLocalHour(now: Date, timezone: string | null): number {
  if (!timezone) return now.getUTCHours();
  try {
    // Format the date in the user's timezone and parse the hour.
    const fmt = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone,
    });
    const parts = fmt.formatToParts(now);
    const hourPart = parts.find((p) => p.type === 'hour');
    return hourPart ? Number(hourPart.value) : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

/**
 * Get the local date (YYYY-MM-DD) for `now` in the given IANA
 * timezone. Used for "logged today" checks.
 */
export function getLocalDateKey(now: Date, timezone: string | null): string {
  if (!timezone) return now.toISOString().slice(0, 10);
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: timezone,
    });
    return fmt.format(now); // en-CA gives YYYY-MM-DD
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Build a UTC Date that represents midnight (00:00:00) at the start
 * of `daysAgo` in the user's local timezone. Used to compute the
 * "logged in last N days" cutoff for weekly metrics.
 */
export function localMidnightUtc(daysAgo: number, now: Date, timezone: string | null): Date {
  const key = getLocalDateKey(now, timezone);
  // Shift the local date by N days. Doing arithmetic in the user's
  // timezone avoids DST edge cases that would corrupt the cutoff.
  const shifted = shiftDateKey(key, -daysAgo);
  // Parse back to a UTC instant at local midnight. Without an
  // explicit offset we can't be exact, so we use the noon trick:
  // construct a Date from YYYY-MM-DDTHH:MM:SS in the user's TZ via
  // a two-step. Simpler: parse "YYYY-MM-DD" and treat it as UTC
  // midnight, then convert. Close enough for "is this in the last
  // 7 days" bucketing.
  return new Date(`${shifted}T00:00:00Z`);
}

function shiftDateKey(key: string, deltaDays: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

export type DueMetric = {
  metric: MetricType;
  cadence: Cadence;
  /** Last time this metric was logged (UTC). Null if never. */
  lastLoggedAt: Date | null;
  /** How stale it is, in the metric's natural unit (days for AM/PM, days for WEEKLY). */
  overdueByDays: number;
  /** True if the cadence's time window is currently open in the user's timezone. */
  inWindow: boolean;
};

/**
 * Compute the list of metrics that are due for check-in, grouped
 * by cadence.
 *
 * `lastLoggedByMetric` is a Map from metric → most recent recordedAt
 * (UTC). The caller is responsible for fetching it (typically via
 * `SELECT DISTINCT ON (metric) ... ORDER BY metric, recordedAt DESC`
 * scoped to the user).
 *
 * Returned list is unsorted. The caller (dashboard panel) groups by
 * `item.cadence` and sorts within each group by `overdueByDays DESC`.
 */
export function computeDueMetrics(args: {
  lastLoggedByMetric: Map<MetricType, Date>;
  now: Date;
  timezone: string | null;
}): DueMetric[] {
  const { lastLoggedByMetric, now, timezone } = args;
  const out: DueMetric[] = [];
  for (const [metric, cadence] of Object.entries(DEFAULT_CADENCE) as [MetricType, Cadence][]) {
    if (!isCheckInMetric(metric)) continue;
    const last = lastLoggedByMetric.get(metric) ?? null;
    const overdueByDays = last ? daysSince(last, now, timezone) : Number.POSITIVE_INFINITY;
    const inWindow = isWithinWindow(cadence, now, timezone);

    // Due logic:
    //   AM: not logged today (in local tz) → due
    //   PM: not logged today → due
    //   WEEKLY: not logged in last 7 days → due
    const due = (() => {
      if (cadence === 'WEEKLY') {
        return overdueByDays >= 7;
      }
      // AM / PM: "logged today" check
      const todayKey = getLocalDateKey(now, timezone);
      const lastKey = last ? getLocalDateKey(last, timezone) : null;
      return lastKey !== todayKey;
    })();

    if (!due) continue;
    out.push({ metric, cadence, lastLoggedAt: last, overdueByDays: finiteOrInf(overdueByDays), inWindow });
  }
  return out;
}

function daysSince(then: Date, now: Date, timezone: string | null): number {
  // Day-fraction difference using local-date keys (avoids DST off-by-1).
  const a = new Date(`${getLocalDateKey(now, timezone)}T00:00:00Z`).getTime();
  const b = new Date(`${getLocalDateKey(then, timezone)}T00:00:00Z`).getTime();
  return (a - b) / (24 * 60 * 60 * 1000);
}

function finiteOrInf(n: number): number {
  return Number.isFinite(n) ? n : 9999;
}

/**
 * Group due metrics by cadence. Returns insertion order matching
 * CADENCES (AM, PM, WEEKLY) so the dashboard renders cards in a
 * predictable sequence.
 */
export function groupByCadence(items: DueMetric[]): Record<Cadence, DueMetric[]> {
  const out: Record<Cadence, DueMetric[]> = { AM: [], PM: [], WEEKLY: [] };
  for (const item of items) out[item.cadence].push(item);
  return out;
}