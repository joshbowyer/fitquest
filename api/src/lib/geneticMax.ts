import type { MetricType } from '@prisma/client';
import { METRICS } from './metrics.js';

type Inputs = {
  heightCm?: number | null;
  wristCm?: number | null;
  ankleCm?: number | null;
  weightKg?: number | null;
  bodyFatPct?: number | null;
  birthDate?: Date | null;
  sex?: 'male' | 'female' | null;
};

function age(birthDate?: Date | null): number | null {
  if (!birthDate) return null;
  const ms = Date.now() - birthDate.getTime();
  return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

/**
 * Compute a default genetic max for a given metric using simple proportional
 * formulas. These are intentionally simple, conservative starting points —
 * users can override per metric. References: McCallum proportions, FFMI
 * natural ceiling, age-adjusted VO2 max norms, strength-to-bodyweight norms.
 */
export function computeGeneticMax(metric: MetricType, inputs: Inputs): number | null {
  const { heightCm, wristCm, ankleCm, weightKg, bodyFatPct, birthDate, sex } = inputs;

  switch (metric) {
    case 'BICEP': {
      // McCallum's "ideal" formula is bicep = wrist, but that's the target
      // for a well-proportioned physique, not the genetic ceiling. Use 1.6x
      // wrist as a realistic max for a natural lifter at low body fat.
      if (wristCm) return round1(wristCm * 1.6);
      if (heightCm) return round1(heightCm * 0.31);
      return null;
    }
    case 'FOREARM': {
      if (wristCm) return round1(wristCm * 1.05);
      return null;
    }
    case 'CHEST': {
      if (wristCm) return round1(wristCm * 6.6);
      if (heightCm) return round1(heightCm * 0.66);
      return null;
    }
    case 'SHOULDER': {
      if (wristCm) return round1(wristCm * 6.5);
      if (heightCm) return round1(heightCm * 0.7);
      return null;
    }
    case 'NECK': {
      if (wristCm) return round1(wristCm * 1.6);
      if (heightCm) return round1(heightCm * 0.27);
      return null;
    }
    case 'QUAD': {
      if (ankleCm) return round1(ankleCm * 1.85);
      if (heightCm) return round1(heightCm * 0.34);
      return null;
    }
    case 'CALF': {
      if (ankleCm) return round1(ankleCm * 1.55);
      if (heightCm) return round1(heightCm * 0.23);
      return null;
    }
    case 'WAIST': {
      // Maxes below wrist×4.4 keep the V-taper look; smaller = leaner
      if (wristCm) return round1(wristCm * 4.0);
      if (heightCm) return round1(heightCm * 0.42);
      return null;
    }
    case 'LEAN_MASS': {
      if (weightKg && bodyFatPct) return round1(weightKg * (1 - bodyFatPct / 100));
      return null;
    }
    case 'FFMI': {
      // Natural ceiling: 25-26. Target = min(25, current projected FFMI * 1.15)
      if (weightKg && heightCm && bodyFatPct) {
        const lean = weightKg * (1 - bodyFatPct / 100);
        const f = lean / Math.pow(heightCm / 100, 2);
        return round1(Math.min(25, Math.max(f * 1.1, 22)));
      }
      // Default ceiling for unknown
      return 25;
    }
    case 'BODY_FAT_PCT': {
      // "Optimal" lower bound (genetic) — typical male ~6-8%, female ~12-14%
      if (sex === 'female') return 14;
      return 8;
    }
    case 'WEIGHT': {
      // BMI midrange as a baseline, override-able
      if (heightCm) {
        const bmi = 24;
        return round1(bmi * Math.pow(heightCm / 100, 2));
      }
      return null;
    }
    case 'BENCH_1RM': {
      if (weightKg) return round1(weightKg * 1.5);
      return null;
    }
    case 'SQUAT_1RM': {
      if (weightKg) return round1(weightKg * 2.25);
      return null;
    }
    case 'DEADLIFT_1RM': {
      if (weightKg) return round1(weightKg * 2.75);
      return null;
    }
    case 'OHP_1RM': {
      if (weightKg) return round1(weightKg * 1.0);
      return null;
    }
    case 'PULLUP_1RM': {
      if (weightKg) return Math.max(0, round1(weightKg * 0.5));
      return null;
    }
    case 'POWERLIFT_TOTAL': {
      if (weightKg) return round1(weightKg * 6.5);
      return null;
    }
    case 'VO2_MAX': {
      // Age/sex adjusted norms (rough): male ~50-elite, female ~45-elite
      const a = age(birthDate) ?? 30;
      const baseMale = 60;
      const baseFemale = 55;
      const decline = Math.max(0, (a - 25) * 0.4);
      const ceiling = (sex === 'female' ? baseFemale : baseMale) - decline;
      return round1(Math.max(35, ceiling));
    }
    case 'RESTING_HR': {
      // Genetic/resting "good" floor ~ 45-50
      return 45;
    }
    case 'HRV': {
      // "Excellent" range upper, age-adjusted
      const a = age(birthDate) ?? 30;
      return Math.max(40, 90 - a * 0.5);
    }
    case 'FIVE_K_TIME': {
      // 20 min for fit, 15 min for elite male, 17 female baseline
      return sex === 'female' ? 17 * 60 : 15 * 60;
    }
    case 'PLANK_HOLD': {
      return 240; // 4 min plank as a strong "natural" target
    }
    case 'L_SIT_HOLD': {
      return 60;
    }
    default:
      return null;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeAllGeneticMaxes(inputs: Inputs): Record<MetricType, number | null> {
  const out = {} as Record<MetricType, number | null>;
  for (const m of Object.keys(METRICS) as MetricType[]) {
    out[m] = computeGeneticMax(m, inputs);
  }
  return out;
}
