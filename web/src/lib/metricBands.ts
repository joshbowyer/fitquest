/**
 * Fitness-test bands for metrics that should be displayed as
 * ideal-radial gauges (top = ideal elite, fanning out to "too low"
 * on the left and "too high" on the right).
 *
 * Sources are approximate, blending ACFT/Air Force / general
 * strength standards + USAFA / military fitness. Values are
 * gender-neutral averages; the user can always check metric-specific
 * tests (ACFT, USMC PFT, NSCA) for population-specific norms.
 */

import type { MetricType } from '@/lib/types';

export type MetricBands = {
  min: number;
  eliteMin: number;
  eliteMax: number;
  healthyMin: number;
  healthyMax: number;
  max: number;
  subtitle: string;
  unit: string;
};

// World-record / elite-athletic values for time-based events.
const WR_1MI_SECONDS = 223;    // 3:43 — El Guerrouj, 1999
const WR_5K_SECONDS  = 755;    // 12:35 — Cheptegei, 2020
const BEGINNER_1MI   = 12 * 60; // 12:00 — novice ceiling
const BEGINNER_5K    = 40 * 60; // 40:00 — novice ceiling

export const METRIC_BANDS: Partial<Record<MetricType, MetricBands>> = {
  BODY_FAT_PCT: {
    // top is elite, healthy is a wider band. <6% objectively unhealthy.
    min: 3,
    eliteMin: 11,
    eliteMax: 13,
    healthyMin: 9,
    healthyMax: 16,
    max: 35,
    subtitle: 'elite 11–13% · healthy 9–16%',
    unit: '%',
  },
  HRV: {
    // Higher RMSSD generally better. Elite endurance athletes 70-90+.
    min: 10,
    eliteMin: 60,
    eliteMax: 80,
    healthyMin: 40,
    healthyMax: 95,
    max: 150,
    subtitle: 'elite 60–80 ms · healthy 40–95',
    unit: 'ms',
  },
  VO2_MAX: {
    // ml/kg/min. Elite 55+ for most men, 50+ women; elite endurance 70+.
    min: 15,
    eliteMin: 55,
    eliteMax: 65,
    healthyMin: 40,
    healthyMax: 75,
    max: 90,
    subtitle: 'elite 55–65 · healthy 40–75',
    unit: 'ml/kg/min',
  },
  ONE_MILE_TIME: {
    // Inverse — lower is better. Top of dial = elite (fast), so we
    // present time values flipped. We achieve the flip by setting
    // min/max swapped (min = WR ceiling, max = beginner ceiling) and
    // letting the gauge render the raw second value; the formatter
    // converts to M:SS. Elite band maps to fastest realistic times.
    min: WR_1MI_SECONDS - 5,
    eliteMin: WR_1MI_SECONDS,
    eliteMax: 5 * 60 + 30,    // 5:30 — club-level elite amateur
    healthyMin: 6 * 60,         // 6:00 — competitive amateur
    healthyMax: 9 * 60,         // 9:00 — recreational
    max: BEGINNER_1MI,
    subtitle: `elite sub-5:30 · healthy 6:00–9:00 · WR ${Math.floor(WR_1MI_SECONDS/60)}:${(WR_1MI_SECONDS%60).toString().padStart(2,'0')}`,
    unit: 's',
  },
  FIVE_K_TIME: {
    min: WR_5K_SECONDS - 5,
    eliteMin: WR_5K_SECONDS,
    eliteMax: 17 * 60,         // 17:00 — strong amateur
    healthyMin: 20 * 60,        // 20:00 — solid recreational
    healthyMax: 28 * 60,        // 28:00 — typical adult
    max: BEGINNER_5K,
    subtitle: `elite sub-17 · healthy 20–28 · WR ${Math.floor(WR_5K_SECONDS/60)}:${(WR_5K_SECONDS%60).toString().padStart(2,'0')}`,
    unit: 's',
  },
  PLANK_HOLD: {
    // ACFT uses 2:30 minimum (silver standard), 4:30+ elite.
    // Values are seconds.
    min: 0,
    eliteMin: 240,   // 4:00
    eliteMax: 360,   // 6:00
    healthyMin: 120, // 2:00
    healthyMax: 300, // 5:00
    max: 600,         // 10:00 (top of dial)
    subtitle: 'elite 4–6 min · healthy 2–5 min',
    unit: 's',
  },
  PUSHUP_MAX: {
    // ACFT: min 10, max 71. Industry standards for healthy adult males 25-30;
    // elite 50+, women proportionally lower.
    min: 0,
    eliteMin: 50,
    eliteMax: 80,
    healthyMin: 25,
    healthyMax: 49,
    max: 100,
    subtitle: 'elite 50–80 reps · healthy 25–49',
    unit: 'reps',
  },
  PULLUP_MAX: {
    // ACFT: dead-hang pull-up, men 1 min, max 20. NASM elite 15+.
    min: 0,
    eliteMin: 15,
    eliteMax: 25,
    healthyMin: 8,
    healthyMax: 14,
    max: 35,
    subtitle: 'elite 15–25 reps · healthy 8–14',
    unit: 'reps',
  },
};

export function bandsFor(metric: MetricType): MetricBands | null {
  return METRIC_BANDS[metric] ?? null;
}