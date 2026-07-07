// Mirror of api/src/lib/checkIns.ts so the frontend can render cadence
// labels, windows, and "is this metric due" locally without a round
// trip. The source of truth is the api copy; keep these in sync.

import type { MetricType } from './types';

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

export const CADENCE_VARIANT: Record<Cadence, 'cyan' | 'violet' | 'amber'> = {
  AM: 'cyan',
  PM: 'violet',
  WEEKLY: 'amber',
};

/// Short labels for the dashboard cards. Use CADENCE_LABEL on the
/// dedicated /check-ins page; these are for tight spaces.
export const CADENCE_SHORT: Record<Cadence, string> = {
  AM: 'Morning',
  PM: 'Evening',
  WEEKLY: 'Weekly',
};

export const CADENCE_WINDOWS: Record<Cadence, { startHour: number; endHour: number }> = {
  AM:    { startHour: 5,  endHour: 12 },
  PM:    { startHour: 17, endHour: 24 },
  WEEKLY: { startHour: 0,  endHour: 24 },
};

export const DEFAULT_CADENCE: Record<MetricType, Cadence> = {
  WEIGHT:        'AM',
  MOOD:          'AM',
  ENERGY:        'AM',
  SORENESS:      'AM',
  SLEEP_QUALITY: 'AM',
  RESTING_HR:    'AM',
  HRV:           'AM',
  STRESS:        'PM',
  WAIST:         'WEEKLY',
  NECK:          'WEEKLY',
  CHEST:         'WEEKLY',
  BICEP:         'WEEKLY',
  BICEP_FLEXED:  'WEEKLY',
  BICEP_RELAXED: 'WEEKLY',
  FOREARM:       'WEEKLY',
  QUAD:          'WEEKLY',
  CALF:          'WEEKLY',
  SHOULDER:      'WEEKLY',
  BODY_FAT_PCT:  'WEEKLY',
  BENCH_1RM:     'WEEKLY',
  SQUAT_1RM:     'WEEKLY',
  DEADLIFT_1RM:  'WEEKLY',
  OHP_1RM:       'WEEKLY',
  PULLUP_1RM:    'WEEKLY',
  POWERLIFT_TOTAL: 'WEEKLY',
  VO2_MAX:       'WEEKLY',
  FIVE_K_TIME:   'WEEKLY',
  ONE_MILE_TIME: 'WEEKLY',
  PLANK_HOLD:    'WEEKLY',
  L_SIT_HOLD:    'WEEKLY',
  DEAD_HANG:     'WEEKLY',
  PUSHUP_MAX:    'WEEKLY',
  PULLUP_MAX:    'WEEKLY',
  LEAN_MASS:            'WEEKLY',
  FFMI:                 'WEEKLY',
  SHOULDER_WAIST_RATIO: 'WEEKLY',
  SLEEP_HOURS: 'AM',
  CALORIES:    'WEEKLY',
  PROTEIN_G:   'WEEKLY',
  WATER_ML:    'WEEKLY',
};

export const NEVER_SURFACED: ReadonlySet<MetricType> = new Set([
  'CALORIES',
  'PROTEIN_G',
  'WATER_ML',
  'LEAN_MASS',
  'FFMI',
  'SHOULDER_WAIST_RATIO',
  'SLEEP_HOURS',
]);

export function isCheckInMetric(m: MetricType): boolean {
  return !NEVER_SURFACED.has(m);
}

export type DueMetricDto = {
  metric: MetricType;
  cadence: Cadence;
  lastLoggedAt: string | null;
  overdueByDays: number;
  inWindow: boolean;
  isNeverLogged: boolean;
};

export type CheckInsDueResponse = {
  items: DueMetricDto[];
  byCadence: Record<Cadence, DueMetricDto[]>;
};

/**
 * Group due metrics by cadence. Returns insertion order matching
 * CADENCES so the dashboard renders cards predictably.
 */
export function groupDueByCadence(items: DueMetricDto[]): Record<Cadence, DueMetricDto[]> {
  const out: Record<Cadence, DueMetricDto[]> = { AM: [], PM: [], WEEKLY: [] };
  for (const item of items) out[item.cadence].push(item);
  return out;
}

/** True if the current local hour is within the cadence's window. */
export function isWithinWindow(cadence: Cadence, now: Date, timezone: string | null): boolean {
  if (cadence === 'WEEKLY') return true;
  const hour = getLocalHour(now, timezone);
  const w = CADENCE_WINDOWS[cadence];
  return hour >= w.startHour && hour < w.endHour;
}

export function getLocalHour(now: Date, timezone: string | null): number {
  if (!timezone) return now.getUTCHours();
  try {
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