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
    // Casey Butt–calibrated formulas. All ratios are derived from the
    // natural ceiling at FFMI 25 (~16% body fat, contest shape, years of
    // optimal training) for a small-frame male (6" wrist, 5'11"). Height
    // fallbacks are calibrated to give the same answer for that frame so
    // results are consistent regardless of which inputs are present.
    case 'BICEP': {
      // Casey Butt range: 15.5-16.5" (2.6-2.75x wrist), midpoint ~2.7x.
      // 6" wrist -> 16.2" ceiling. (User initially estimated 18" but
      // Grok + Casey Butt flag that as too high for a 6" wrist frame.)
      if (wristCm) return round1(wristCm * 2.7);
      if (heightCm) return round1(heightCm * 0.228);
      return null;
    }
    case 'FOREARM': {
      // Casey Butt range: 13-14" (2.2-2.4x wrist), midpoint ~2.3x.
      if (wristCm) return round1(wristCm * 2.3);
      if (heightCm) return round1(heightCm * 0.195);
      return null;
    }
    case 'CHEST': {
      // Casey Butt range: 44-47" (7.3-7.8x wrist), midpoint ~7.5x.
      if (wristCm) return round1(wristCm * 7.5);
      if (heightCm) return round1(heightCm * 0.634);
      return null;
    }
    case 'SHOULDER': {
      // Casey Butt range: 49-53" (8.2-8.8x wrist), midpoint ~8.5x.
      if (wristCm) return round1(wristCm * 8.5);
      if (heightCm) return round1(heightCm * 0.718);
      return null;
    }
    case 'NECK': {
      // Casey Butt range: 17-18" (2.8-3.0x wrist), midpoint ~2.9x.
      if (wristCm) return round1(wristCm * 2.9);
      if (heightCm) return round1(heightCm * 0.245);
      return null;
    }
    case 'QUAD': {
      // Casey Butt range: 24-26" (2.7-3.0x ankle), midpoint ~2.85x.
      // Old formula was 2.0x which gave only 17.5" for 8.75" ankle —
      // that was an "untrained" baseline, not a natural ceiling.
      if (ankleCm) return round1(ankleCm * 2.85);
      if (heightCm) return round1(heightCm * 0.352);
      return null;
    }
    case 'CALF': {
      // Casey Butt range: 16-17.5" (1.8-2.0x ankle), midpoint ~1.9x.
      if (ankleCm) return round1(ankleCm * 1.9);
      if (heightCm) return round1(heightCm * 0.234);
      return null;
    }
    case 'WAIST': {
      // Smaller is leaner — this is the contest-shape "lean max" for
      // small frame at FFMI 25. ~0.16x height gives ~29" for 5'11".
      if (heightCm) return round1(heightCm * 0.161);
      if (wristCm) return round1(wristCm * 1.9);
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
