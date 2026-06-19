import { MetricType } from '@prisma/client';

export type MetricCategory =
  | 'HYPERTROPHY'
  | 'STRENGTH'
  | 'BODY_COMP'
  | 'CARDIO'
  | 'CALISTHENICS'
  | 'SLEEP'
  | 'NUTRITION'
  | 'WELLNESS';

export type MetricMeta = {
  type: MetricType;
  category: MetricCategory;
  label: string;
  shortLabel: string;
  unit: string;
  // Lower is "better" for some metrics (body fat, resting HR, 5k time)
  inverted: boolean;
  // For gauges: sensible default min for a beginner
  defaultMin: number;
  // Format helpers
  format: (v: number) => string;
  description: string;
};

const cm = (v: number) => `${v.toFixed(1)} cm`;
const kg = (v: number) => `${v.toFixed(1)} kg`;
const pct = (v: number) => `${v.toFixed(1)}%`;
const bpm = (v: number) => `${Math.round(v)} bpm`;
const seconds = (v: number) => {
  const s = Math.round(v);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${r.toString().padStart(2, '0')}` : `${r}s`;
};
const num = (v: number) => v.toFixed(1);

export const METRICS: Record<MetricType, MetricMeta> = {
  // Hypertrophy
  BICEP: {
    type: 'BICEP',
    category: 'HYPERTROPHY',
    label: 'Bicep Circumference',
    shortLabel: 'Bicep',
    unit: 'cm',
    inverted: false,
    defaultMin: 30,
    format: cm,
    description: 'Flexed bicep circumference. Key hypertrophy stat.',
  },
  CHEST: {
    type: 'CHEST',
    category: 'HYPERTROPHY',
    label: 'Chest Circumference',
    shortLabel: 'Chest',
    unit: 'cm',
    inverted: false,
    defaultMin: 90,
    format: cm,
    description: 'Chest circumference at nipple line, exhaled.',
  },
  SHOULDER: {
    type: 'SHOULDER',
    category: 'HYPERTROPHY',
    label: 'Shoulder Circumference',
    shortLabel: 'Shoulder',
    unit: 'cm',
    inverted: false,
    defaultMin: 105,
    format: cm,
    description: 'Deltoid circumference around the bulge.',
  },
  QUAD: {
    type: 'QUAD',
    category: 'HYPERTROPHY',
    label: 'Quad Circumference',
    shortLabel: 'Quad',
    unit: 'cm',
    inverted: false,
    defaultMin: 50,
    format: cm,
    description: 'Quad circumference, 15cm above patella.',
  },
  CALF: {
    type: 'CALF',
    category: 'HYPERTROPHY',
    label: 'Calf Circumference',
    shortLabel: 'Calf',
    unit: 'cm',
    inverted: false,
    defaultMin: 35,
    format: cm,
    description: 'Calf circumference at widest point.',
  },
  FOREARM: {
    type: 'FOREARM',
    category: 'HYPERTROPHY',
    label: 'Forearm Circumference',
    shortLabel: 'Forearm',
    unit: 'cm',
    inverted: false,
    defaultMin: 27,
    format: cm,
    description: 'Forearm circumference, flexed.',
  },
  NECK: {
    type: 'NECK',
    category: 'HYPERTROPHY',
    label: 'Neck Circumference',
    shortLabel: 'Neck',
    unit: 'cm',
    inverted: false,
    defaultMin: 35,
    format: cm,
    description: 'Neck circumference below the larynx.',
  },
  WAIST: {
    type: 'WAIST',
    category: 'BODY_COMP',
    label: 'Waist Circumference',
    shortLabel: 'Waist',
    unit: 'cm',
    inverted: false,
    defaultMin: 70,
    format: cm,
    description: 'Waist circumference at navel. Indicator of leanness.',
  },
  // Strength
  BENCH_1RM: {
    type: 'BENCH_1RM',
    category: 'STRENGTH',
    label: 'Bench Press 1RM',
    shortLabel: 'Bench',
    unit: 'kg',
    inverted: false,
    defaultMin: 40,
    format: kg,
    description: 'Estimated one-rep max bench press.',
  },
  SQUAT_1RM: {
    type: 'SQUAT_1RM',
    category: 'STRENGTH',
    label: 'Squat 1RM',
    shortLabel: 'Squat',
    unit: 'kg',
    inverted: false,
    defaultMin: 60,
    format: kg,
    description: 'Estimated one-rep max back squat.',
  },
  DEADLIFT_1RM: {
    type: 'DEADLIFT_1RM',
    category: 'STRENGTH',
    label: 'Deadlift 1RM',
    shortLabel: 'Deadlift',
    unit: 'kg',
    inverted: false,
    defaultMin: 80,
    format: kg,
    description: 'Estimated one-rep max conventional deadlift.',
  },
  OHP_1RM: {
    type: 'OHP_1RM',
    category: 'STRENGTH',
    label: 'Overhead Press 1RM',
    shortLabel: 'OHP',
    unit: 'kg',
    inverted: false,
    defaultMin: 25,
    format: kg,
    description: 'Estimated one-rep max strict overhead press.',
  },
  PULLUP_1RM: {
    type: 'PULLUP_1RM',
    category: 'STRENGTH',
    label: 'Pull-up 1RM (weighted)',
    shortLabel: 'Pull-up',
    unit: 'kg',
    inverted: false,
    defaultMin: 0,
    format: kg,
    description: 'Heaviest weighted pull-up you can do for 1.',
  },
  // Body composition
  BODY_FAT_PCT: {
    type: 'BODY_FAT_PCT',
    category: 'BODY_COMP',
    label: 'Body Fat %',
    shortLabel: 'Body Fat',
    unit: '%',
    inverted: false,
    defaultMin: 8,
    format: pct,
    description: 'Body fat percentage (lower is generally leaner).',
  },
  LEAN_MASS: {
    type: 'LEAN_MASS',
    category: 'BODY_COMP',
    label: 'Lean Mass',
    shortLabel: 'Lean Mass',
    unit: 'kg',
    inverted: false,
    defaultMin: 50,
    format: kg,
    description: 'Total lean body mass in kg.',
  },
  FFMI: {
    type: 'FFMI',
    category: 'BODY_COMP',
    label: 'FFMI',
    shortLabel: 'FFMI',
    unit: '',
    inverted: false,
    defaultMin: 18,
    format: num,
    description: 'Fat-Free Mass Index. Natural ceiling ~25-26.',
  },
  WEIGHT: {
    type: 'WEIGHT',
    category: 'BODY_COMP',
    label: 'Body Weight',
    shortLabel: 'Weight',
    unit: 'kg',
    inverted: false,
    defaultMin: 50,
    format: kg,
    description: 'Total body weight in kg.',
  },
  // Cardio / endurance
  VO2_MAX: {
    type: 'VO2_MAX',
    category: 'CARDIO',
    label: 'VO2 Max',
    shortLabel: 'VO2 Max',
    unit: 'ml/kg/min',
    inverted: false,
    defaultMin: 30,
    format: num,
    description: 'Maximal oxygen uptake per kg per minute.',
  },
  RESTING_HR: {
    type: 'RESTING_HR',
    category: 'CARDIO',
    label: 'Resting Heart Rate',
    shortLabel: 'Resting HR',
    unit: 'bpm',
    inverted: false,
    defaultMin: 50,
    format: bpm,
    description: 'Resting heart rate. Lower typically means better cardio.',
  },
  HRV: {
    type: 'HRV',
    category: 'CARDIO',
    label: 'HRV (RMSSD)',
    shortLabel: 'HRV',
    unit: 'ms',
    inverted: false,
    defaultMin: 30,
    format: num,
    description: 'Heart rate variability. Higher = better recovery.',
  },
  FIVE_K_TIME: {
    type: 'FIVE_K_TIME',
    category: 'CARDIO',
    label: '5K Time',
    shortLabel: '5K',
    unit: 's',
    inverted: false,
    defaultMin: 1500,
    format: seconds,
    description: 'Best 5K time in seconds.',
  },
  // Calisthenics
  PLANK_HOLD: {
    type: 'PLANK_HOLD',
    category: 'CALISTHENICS',
    label: 'Plank Hold',
    shortLabel: 'Plank',
    unit: 's',
    inverted: false,
    defaultMin: 30,
    format: seconds,
    description: 'Longest plank hold in seconds.',
  },
  L_SIT_HOLD: {
    type: 'L_SIT_HOLD',
    category: 'CALISTHENICS',
    label: 'L-Sit Hold',
    shortLabel: 'L-Sit',
    unit: 's',
    inverted: false,
    defaultMin: 5,
    format: seconds,
    description: 'Longest L-sit hold in seconds.',
  },
  // Powerlifting total
  POWERLIFT_TOTAL: {
    type: 'POWERLIFT_TOTAL',
    category: 'STRENGTH',
    label: 'Powerlifting Total',
    shortLabel: 'PL Total',
    unit: 'kg',
    inverted: false,
    defaultMin: 200,
    format: kg,
    description: 'Sum of best S/B/D. Strength-standards reference.',
  },
  // Sleep
  SLEEP_HOURS: {
    type: 'SLEEP_HOURS',
    category: 'SLEEP',
    label: 'Sleep Duration',
    shortLabel: 'Sleep',
    unit: 'h',
    inverted: false,
    defaultMin: 5,
    format: (v) => `${v.toFixed(1)} h`,
    description: 'Hours slept last night.',
  },
  SLEEP_QUALITY: {
    type: 'SLEEP_QUALITY',
    category: 'SLEEP',
    label: 'Sleep Quality',
    shortLabel: 'Sleep Q',
    unit: '/10',
    inverted: false,
    defaultMin: 5,
    format: (v) => `${v.toFixed(0)}/10`,
    description: 'Subjective sleep quality (1-10).',
  },
  // Nutrition
  CALORIES: {
    type: 'CALORIES',
    category: 'NUTRITION',
    label: 'Calories',
    shortLabel: 'Calories',
    unit: 'kcal',
    inverted: false,
    defaultMin: 1500,
    format: (v) => `${Math.round(v)} kcal`,
    description: 'Total daily calories consumed.',
  },
  PROTEIN_G: {
    type: 'PROTEIN_G',
    category: 'NUTRITION',
    label: 'Protein',
    shortLabel: 'Protein',
    unit: 'g',
    inverted: false,
    defaultMin: 80,
    format: (v) => `${Math.round(v)} g`,
    description: 'Total daily protein in grams.',
  },
  WATER_ML: {
    type: 'WATER_ML',
    category: 'NUTRITION',
    label: 'Water',
    shortLabel: 'Water',
    unit: 'ml',
    inverted: false,
    defaultMin: 1500,
    format: (v) => `${Math.round(v)} ml`,
    description: 'Total daily water intake.',
  },
  // Wellness (subjective 1-10)
  MOOD: {
    type: 'MOOD',
    category: 'WELLNESS',
    label: 'Mood',
    shortLabel: 'Mood',
    unit: '/10',
    inverted: false,
    defaultMin: 5,
    format: (v) => `${v.toFixed(0)}/10`,
    description: 'Subjective mood (1-10).',
  },
  ENERGY: {
    type: 'ENERGY',
    category: 'WELLNESS',
    label: 'Energy',
    shortLabel: 'Energy',
    unit: '/10',
    inverted: false,
    defaultMin: 5,
    format: (v) => `${v.toFixed(0)}/10`,
    description: 'Subjective energy (1-10).',
  },
  SORENESS: {
    type: 'SORENESS',
    category: 'WELLNESS',
    label: 'Soreness',
    shortLabel: 'Soreness',
    unit: '/10',
    inverted: false,
    defaultMin: 5,
    format: (v) => `${v.toFixed(0)}/10`,
    description: 'Muscle soreness (1-10). Higher = more sore.',
  },
  STRESS: {
    type: 'STRESS',
    category: 'WELLNESS',
    label: 'Stress',
    shortLabel: 'Stress',
    unit: '/10',
    inverted: false,
    defaultMin: 5,
    format: (v) => `${v.toFixed(0)}/10`,
    description: 'Subjective stress (1-10).',
  },
};

export const METRICS_BY_CATEGORY: Record<MetricCategory, MetricType[]> = {
  HYPERTROPHY: ['BICEP', 'CHEST', 'SHOULDER', 'QUAD', 'CALF', 'FOREARM', 'NECK'],
  STRENGTH: ['BENCH_1RM', 'SQUAT_1RM', 'DEADLIFT_1RM', 'OHP_1RM', 'PULLUP_1RM', 'POWERLIFT_TOTAL'],
  BODY_COMP: ['BODY_FAT_PCT', 'LEAN_MASS', 'FFMI', 'WEIGHT', 'WAIST'],
  CARDIO: ['VO2_MAX', 'RESTING_HR', 'HRV', 'FIVE_K_TIME'],
  CALISTHENICS: ['PLANK_HOLD', 'L_SIT_HOLD'],
  SLEEP: ['SLEEP_HOURS', 'SLEEP_QUALITY'],
  NUTRITION: ['CALORIES', 'PROTEIN_G', 'WATER_ML'],
  WELLNESS: ['MOOD', 'ENERGY', 'SORENESS', 'STRESS'],
};

export const PRIMARY_METRICS_BY_CLASS: Record<string, MetricType[]> = {
  BODYBUILDER: ['BICEP', 'CHEST', 'SHOULDER', 'QUAD'],
  POWERLIFTER: ['BENCH_1RM', 'SQUAT_1RM', 'DEADLIFT_1RM', 'POWERLIFT_TOTAL'],
  CALISTHENIST: ['PULLUP_1RM', 'PLANK_HOLD', 'L_SIT_HOLD'],
  ENDURANCE: ['VO2_MAX', 'FIVE_K_TIME', 'RESTING_HR', 'HRV'],
  HYBRID: ['BENCH_1RM', 'BICEP', 'VO2_MAX', 'WEIGHT'],
};
