/**
 * Fitness-test bands for the dashboard radials.
 *
 * Two kinds:
 *  - **threshold bands** (IdealGauge): top-center is the elite midpoint,
 *    values fan out to too-low / too-high. Used for body fat (asymmetric)
 *    and 1mi/5K (lower-is-better, no gap between elite and healthy).
 *  - **monotonic thresholds** (BetterGauge): the dial fills bottom→top,
 *    with three zone backgrounds (warn / healthy / elite). Used for
 *    VO2 max, push-ups, pull-ups, plank, shoulder:waist.
 *
 * Sources are approximations, blending ACFT, USMC PFT, NSCA, and
 * general endurance norms. The user can always defer to a specific
 * population standard (NSCA for strength, ACFT for military readiness,
 * etc.) — these are decent general-purpose defaults.
 */

import type { MetricType } from '@/lib/types';

/** Threshold bands for an "ideal middle" radial (IdealGauge). */
export type IdealBands = {
  min: number;
  eliteMin: number;
  eliteMax: number;
  healthyMin: number;
  healthyMax: number;
  max: number;
  subtitle: string;
  /** True for "less is better" — angle mapping flips so elite is at
   *  the low end. Used by 1mi/5K. */
  lessIsBetter?: boolean;
  /** Optional asymmetric mapping: split the dial at `midpoint` with
   *  the left half covering `leftSpan` units and the right half
   *  `rightSpan`. If unset, mapping is symmetric around the elite
   *  midpoint. Body fat uses this so the "too low" side compresses. */
  midpoint?: number;
  leftSpan?: number;
  rightSpan?: number;
};

/** Threshold bands for a monotonic "more is better" radial (BetterGauge). */
export type MonotonicBands = {
  min: number;
  max: number;
  eliteMin: number;
  healthyMin: number;
  subtitle: string;
};

// World records (kept as constants for reference).
const WR_1MI_SECONDS = 223;   // 3:43 — El Guerrouj, 1999
const WR_5K_SECONDS  = 755;   // 12:35 — Cheptegei, 2020

export const METRIC_IDEAL_BANDS: Partial<Record<MetricType, IdealBands>> = {
  BODY_FAT_PCT: {
    // <5% is rare and unhealthy. 5-9 is below healthy. 10-12 elite.
    // 13-15 healthy. 16-22 warn. >22 far.
    // Asymmetric: min→midpoint covers 6pp, midpoint→max covers 15pp.
    min: 5,
    eliteMin: 10,
    eliteMax: 12,
    healthyMin: 8,
    healthyMax: 15,
    max: 26,
    midpoint: 11,
    leftSpan: 6,
    rightSpan: 15,
    subtitle: 'elite 10–12% · healthy 8–15% · >25% is "too fat"',
  },
  HRV: {
    min: 10,
    eliteMin: 60,
    eliteMax: 80,
    healthyMin: 40,
    healthyMax: 95,
    max: 150,
    subtitle: 'elite 60–80 ms · healthy 40–95',
  },
  ONE_MILE_TIME: {
    // Threshold bands for "less is better". Elite is anything below
    // 5:30 (330s). Healthy is anything below 9:00 (540s) that isn't
    // elite. >9:00 is warn/far.
    min: WR_1MI_SECONDS - 5,
    eliteMin: WR_1MI_SECONDS - 5,
    eliteMax: 5 * 60 + 30,    // 5:30 — top of elite
    healthyMin: 5 * 60 + 30, // 5:30 — bottom of elite = top of healthy (no gap)
    healthyMax: 9 * 60,      // 9:00 — bottom of healthy
    max: 15 * 60,
    lessIsBetter: true,
    subtitle: `elite <5:30 · healthy <9:00 · WR ${Math.floor(WR_1MI_SECONDS/60)}:${(WR_1MI_SECONDS%60).toString().padStart(2,'0')}`,
  },
  FIVE_K_TIME: {
    min: WR_5K_SECONDS - 5,
    eliteMin: WR_5K_SECONDS - 5,
    eliteMax: 17 * 60,        // 17:00 — top of elite
    healthyMin: 17 * 60,      // no gap
    healthyMax: 28 * 60,      // 28:00 — bottom of healthy
    max: 50 * 60,
    lessIsBetter: true,
    subtitle: `elite <17:00 · healthy <28:00 · WR ${Math.floor(WR_5K_SECONDS/60)}:${(WR_5K_SECONDS%60).toString().padStart(2,'0')}`,
  },
};

export const METRIC_MONOTONIC_BANDS: Partial<Record<MetricType, MonotonicBands>> = {
  VO2_MAX: {
    // Monotonic "more is better". Elite endurance athletes 70+; elite
    // general adult 55+; healthy 40+.
    min: 15,
    max: 85,
    eliteMin: 55,
    healthyMin: 40,
    subtitle: 'elite ≥55 · healthy ≥40 ml/kg/min',
  },
  PLANK_HOLD: {
    // No max for elite — if you can plank 9 min you're elite, no cap.
    min: 0,
    max: 600,
    eliteMin: 240,    // 4:00 — top of elite band
    healthyMin: 120,  // 2:00 — top of healthy
    subtitle: 'elite ≥4:00 · healthy ≥2:00',
  },
  DEAD_HANG: {
    // Same shape as PLANK_HOLD. Elite hang time is broadly similar
    // to elite plank time — both are full-body isometric holds. 3
    // min is the typical "elite recreational" threshold; 1:30 is
    // a realistic healthy floor for a casual trainee.
    min: 0,
    max: 600,
    eliteMin: 180,    // 3:00
    healthyMin: 90,  // 1:30
    subtitle: 'elite ≥3:00 · healthy ≥1:30',
  },
  PUSHUP_MAX: {
    min: 0,
    max: 100,
    eliteMin: 50,
    healthyMin: 25,
    subtitle: 'elite ≥50 · healthy ≥25 reps',
  },
  PULLUP_MAX: {
    min: 0,
    max: 35,
    eliteMin: 15,
    healthyMin: 8,
    subtitle: 'elite ≥15 · healthy ≥8 reps',
  },
};

/** Synthetic metric: shoulder ÷ waist (a V-taper indicator). */
export const SHO_WAIST_RATIO: MonotonicBands = {
  min: 1.0,
  max: 2.0,
  eliteMin: 1.6,
  healthyMin: 1.4,
  subtitle: 'elite ≥1.6 · healthy ≥1.4',
};

export function idealBandsFor(metric: MetricType): IdealBands | null {
  return METRIC_IDEAL_BANDS[metric] ?? null;
}

export function monotonicBandsFor(metric: MetricType): MonotonicBands | null {
  return METRIC_MONOTONIC_BANDS[metric] ?? null;
}