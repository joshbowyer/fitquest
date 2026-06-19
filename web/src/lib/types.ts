export type ClassName =
  | 'BODYBUILDER'
  | 'POWERLIFTER'
  | 'CALISTHENIST'
  | 'ENDURANCE'
  | 'HYBRID';

export type MetricType =
  | 'BICEP' | 'CHEST' | 'SHOULDER' | 'QUAD' | 'CALF' | 'FOREARM' | 'NECK' | 'WAIST'
  | 'BENCH_1RM' | 'SQUAT_1RM' | 'DEADLIFT_1RM' | 'OHP_1RM' | 'PULLUP_1RM'
  | 'BODY_FAT_PCT' | 'LEAN_MASS' | 'FFMI' | 'WEIGHT'
  | 'VO2_MAX' | 'RESTING_HR' | 'HRV' | 'FIVE_K_TIME'
  | 'PLANK_HOLD' | 'L_SIT_HOLD'
  | 'POWERLIFT_TOTAL';

export type MetricCategory =
  | 'HYPERTROPHY' | 'STRENGTH' | 'BODY_COMP' | 'CARDIO' | 'CALISTHENICS';

export type MetricMeta = {
  type: MetricType;
  category: MetricCategory;
  label: string;
  shortLabel: string;
  unit: string;
  defaultMin: number;
  description: string;
};

export const METRICS: Record<MetricType, MetricMeta> = {
  BICEP: { type: 'BICEP', category: 'HYPERTROPHY', label: 'Bicep Circumference', shortLabel: 'Bicep', unit: 'cm', defaultMin: 30, description: 'Flexed bicep circumference.' },
  CHEST: { type: 'CHEST', category: 'HYPERTROPHY', label: 'Chest Circumference', shortLabel: 'Chest', unit: 'cm', defaultMin: 90, description: 'Chest circumference at nipple line.' },
  SHOULDER: { type: 'SHOULDER', category: 'HYPERTROPHY', label: 'Shoulder Circumference', shortLabel: 'Shoulder', unit: 'cm', defaultMin: 105, description: 'Deltoid circumference.' },
  QUAD: { type: 'QUAD', category: 'HYPERTROPHY', label: 'Quad Circumference', shortLabel: 'Quad', unit: 'cm', defaultMin: 50, description: 'Quad circumference 15cm above patella.' },
  CALF: { type: 'CALF', category: 'HYPERTROPHY', label: 'Calf Circumference', shortLabel: 'Calf', unit: 'cm', defaultMin: 35, description: 'Calf circumference at widest point.' },
  FOREARM: { type: 'FOREARM', category: 'HYPERTROPHY', label: 'Forearm Circumference', shortLabel: 'Forearm', unit: 'cm', defaultMin: 27, description: 'Forearm circumference, flexed.' },
  NECK: { type: 'NECK', category: 'HYPERTROPHY', label: 'Neck Circumference', shortLabel: 'Neck', unit: 'cm', defaultMin: 35, description: 'Neck circumference.' },
  WAIST: { type: 'WAIST', category: 'BODY_COMP', label: 'Waist Circumference', shortLabel: 'Waist', unit: 'cm', defaultMin: 70, description: 'Waist circumference at navel.' },
  BENCH_1RM: { type: 'BENCH_1RM', category: 'STRENGTH', label: 'Bench Press 1RM', shortLabel: 'Bench', unit: 'kg', defaultMin: 40, description: 'Estimated 1RM bench press.' },
  SQUAT_1RM: { type: 'SQUAT_1RM', category: 'STRENGTH', label: 'Squat 1RM', shortLabel: 'Squat', unit: 'kg', defaultMin: 60, description: 'Estimated 1RM squat.' },
  DEADLIFT_1RM: { type: 'DEADLIFT_1RM', category: 'STRENGTH', label: 'Deadlift 1RM', shortLabel: 'Deadlift', unit: 'kg', defaultMin: 80, description: 'Estimated 1RM deadlift.' },
  OHP_1RM: { type: 'OHP_1RM', category: 'STRENGTH', label: 'Overhead Press 1RM', shortLabel: 'OHP', unit: 'kg', defaultMin: 25, description: 'Estimated 1RM OHP.' },
  PULLUP_1RM: { type: 'PULLUP_1RM', category: 'STRENGTH', label: 'Pull-up 1RM', shortLabel: 'Pull-up', unit: 'kg', defaultMin: 0, description: 'Heaviest weighted pull-up.' },
  BODY_FAT_PCT: { type: 'BODY_FAT_PCT', category: 'BODY_COMP', label: 'Body Fat %', shortLabel: 'Body Fat', unit: '%', defaultMin: 8, description: 'Body fat percentage.' },
  LEAN_MASS: { type: 'LEAN_MASS', category: 'BODY_COMP', label: 'Lean Mass', shortLabel: 'Lean Mass', unit: 'kg', defaultMin: 50, description: 'Lean body mass.' },
  FFMI: { type: 'FFMI', category: 'BODY_COMP', label: 'FFMI', shortLabel: 'FFMI', unit: '', defaultMin: 18, description: 'Fat-Free Mass Index.' },
  WEIGHT: { type: 'WEIGHT', category: 'BODY_COMP', label: 'Body Weight', shortLabel: 'Weight', unit: 'kg', defaultMin: 50, description: 'Total body weight.' },
  VO2_MAX: { type: 'VO2_MAX', category: 'CARDIO', label: 'VO2 Max', shortLabel: 'VO2 Max', unit: 'ml/kg/min', defaultMin: 30, description: 'Maximal oxygen uptake.' },
  RESTING_HR: { type: 'RESTING_HR', category: 'CARDIO', label: 'Resting Heart Rate', shortLabel: 'Resting HR', unit: 'bpm', defaultMin: 50, description: 'Resting heart rate.' },
  HRV: { type: 'HRV', category: 'CARDIO', label: 'HRV (RMSSD)', shortLabel: 'HRV', unit: 'ms', defaultMin: 30, description: 'Heart rate variability.' },
  FIVE_K_TIME: { type: 'FIVE_K_TIME', category: 'CARDIO', label: '5K Time', shortLabel: '5K', unit: 's', defaultMin: 1500, description: 'Best 5K time in seconds.' },
  PLANK_HOLD: { type: 'PLANK_HOLD', category: 'CALISTHENICS', label: 'Plank Hold', shortLabel: 'Plank', unit: 's', defaultMin: 30, description: 'Longest plank hold.' },
  L_SIT_HOLD: { type: 'L_SIT_HOLD', category: 'CALISTHENICS', label: 'L-Sit Hold', shortLabel: 'L-Sit', unit: 's', defaultMin: 5, description: 'Longest L-sit hold.' },
  POWERLIFT_TOTAL: { type: 'POWERLIFT_TOTAL', category: 'STRENGTH', label: 'Powerlifting Total', shortLabel: 'PL Total', unit: 'kg', defaultMin: 200, description: 'Sum of best S/B/D.' },
};

export const METRICS_BY_CATEGORY: Record<MetricCategory, MetricType[]> = {
  HYPERTROPHY: ['BICEP', 'CHEST', 'SHOULDER', 'QUAD', 'CALF', 'FOREARM', 'NECK'],
  STRENGTH: ['BENCH_1RM', 'SQUAT_1RM', 'DEADLIFT_1RM', 'OHP_1RM', 'PULLUP_1RM', 'POWERLIFT_TOTAL'],
  BODY_COMP: ['BODY_FAT_PCT', 'LEAN_MASS', 'FFMI', 'WEIGHT', 'WAIST'],
  CARDIO: ['VO2_MAX', 'RESTING_HR', 'HRV', 'FIVE_K_TIME'],
  CALISTHENICS: ['PLANK_HOLD', 'L_SIT_HOLD'],
};

export const PRIMARY_METRICS_BY_CLASS: Record<string, MetricType[]> = {
  BODYBUILDER: ['BICEP', 'CHEST', 'SHOULDER', 'QUAD'],
  POWERLIFTER: ['BENCH_1RM', 'SQUAT_1RM', 'DEADLIFT_1RM', 'POWERLIFT_TOTAL'],
  CALISTHENIST: ['PULLUP_1RM', 'PLANK_HOLD', 'L_SIT_HOLD'],
  ENDURANCE: ['VO2_MAX', 'FIVE_K_TIME', 'RESTING_HR', 'HRV'],
  HYBRID: ['BENCH_1RM', 'BICEP', 'VO2_MAX', 'WEIGHT'],
};

export const CLASS_META: Record<string, { label: string; color: 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet'; tagline: string }> = {
  BODYBUILDER: { label: 'Bodybuilder', color: 'magenta', tagline: 'Sculpt the physique' },
  POWERLIFTER: { label: 'Powerlifter', color: 'cyan', tagline: 'Total domination' },
  CALISTHENIST: { label: 'Calisthenist', color: 'lime', tagline: 'Master your bodyweight' },
  ENDURANCE: { label: 'Endurance', color: 'amber', tagline: 'Outlast the rest' },
  HYBRID: { label: 'Hybrid', color: 'violet', tagline: 'Jack of all trades' },
};

export type WorkoutType = 'STRENGTH' | 'HYPERTROPHY' | 'CALISTHENICS' | 'CARDIO' | 'MOBILITY' | 'OTHER';
export type Workout = {
  id: string;
  type: WorkoutType;
  name: string | null;
  duration: number | null;
  notes: string | null;
  performedAt: string;
  exercises: Exercise[];
};
export type Exercise = {
  id: string;
  name: string;
  order: number;
  notes: string | null;
  sets: SetEntry[];
};
export type SetEntry = {
  id: string;
  reps: number;
  weight: number | null;
  duration: number | null;
  rpe: number | null;
  completed: boolean;
  order: number;
};
export type Measurement = {
  id: string;
  metric: MetricType;
  value: number;
  unit: string;
  notes: string | null;
  recordedAt: string;
};
export type GeneticMax = {
  id: string;
  metric: MetricType;
  value: number;
  source: 'FORMULA' | 'MANUAL' | 'PROJECTED';
  notes: string | null;
};
export type Skill = {
  id: string;
  className: string;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  name: string;
  description: string;
  cost: number;
  prerequisites: string[];
  position: number;
  effects: any;
  unlocked: boolean;
};
export type Achievement = {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  points: number;
  unlocked: boolean;
  unlockedAt: string | null;
};
export type Raid = {
  id: string;
  bossName: string;
  bossHp: number;
  bossMaxHp: number;
  status: 'ACTIVE' | 'VICTORY' | 'DEFEAT';
  startedAt: string;
  endedAt: string | null;
  contributions: RaidContribution[];
};
export type RaidContribution = {
  id: string;
  damage: number;
  source: string;
  contributedAt: string;
  user: { id: string; username: string; class: string | null; level: number };
};
