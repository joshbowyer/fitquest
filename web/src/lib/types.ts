export type ClassName =
  | 'JUGGERNAUT'
  | 'PHANTOM'
  | 'SCOUT'
  | 'BERSERKER'
  | 'ORACLE';

export type MetricType =
  | 'BICEP' | 'CHEST' | 'SHOULDER' | 'QUAD' | 'CALF' | 'FOREARM' | 'NECK' | 'WAIST'
  | 'BENCH_1RM' | 'SQUAT_1RM' | 'DEADLIFT_1RM' | 'OHP_1RM' | 'PULLUP_1RM'
  | 'BODY_FAT_PCT' | 'LEAN_MASS' | 'FFMI' | 'WEIGHT'
  | 'VO2_MAX' | 'RESTING_HR' | 'HRV' | 'FIVE_K_TIME'
  | 'PLANK_HOLD' | 'L_SIT_HOLD'
  | 'POWERLIFT_TOTAL'
  | 'SLEEP_HOURS' | 'SLEEP_QUALITY'
  | 'CALORIES' | 'PROTEIN_G' | 'WATER_ML'
  | 'MOOD' | 'ENERGY' | 'SORENESS' | 'STRESS';

export type MetricCategory =
  | 'HYPERTROPHY' | 'STRENGTH' | 'BODY_COMP' | 'CARDIO' | 'CALISTHENICS'
  | 'SLEEP' | 'NUTRITION' | 'WELLNESS';

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
  SLEEP_HOURS: { type: 'SLEEP_HOURS', category: 'SLEEP', label: 'Sleep Duration', shortLabel: 'Sleep', unit: 'h', defaultMin: 5, description: 'Hours slept.' },
  SLEEP_QUALITY: { type: 'SLEEP_QUALITY', category: 'SLEEP', label: 'Sleep Quality', shortLabel: 'Sleep Q', unit: '/10', defaultMin: 5, description: 'Sleep quality 1-10.' },
  CALORIES: { type: 'CALORIES', category: 'NUTRITION', label: 'Calories', shortLabel: 'Calories', unit: 'kcal', defaultMin: 1500, description: 'Daily calories.' },
  PROTEIN_G: { type: 'PROTEIN_G', category: 'NUTRITION', label: 'Protein', shortLabel: 'Protein', unit: 'g', defaultMin: 80, description: 'Daily protein (g).' },
  WATER_ML: { type: 'WATER_ML', category: 'NUTRITION', label: 'Water', shortLabel: 'Water', unit: 'ml', defaultMin: 1500, description: 'Daily water (ml).' },
  MOOD: { type: 'MOOD', category: 'WELLNESS', label: 'Mood', shortLabel: 'Mood', unit: '/10', defaultMin: 5, description: 'Mood 1-10.' },
  ENERGY: { type: 'ENERGY', category: 'WELLNESS', label: 'Energy', shortLabel: 'Energy', unit: '/10', defaultMin: 5, description: 'Energy 1-10.' },
  SORENESS: { type: 'SORENESS', category: 'WELLNESS', label: 'Soreness', shortLabel: 'Soreness', unit: '/10', defaultMin: 5, description: 'Soreness 1-10.' },
  STRESS: { type: 'STRESS', category: 'WELLNESS', label: 'Stress', shortLabel: 'Stress', unit: '/10', defaultMin: 5, description: 'Stress 1-10.' },
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

import type { FrameArchetype } from './frame';

export type PrimaryAspect = 'STRENGTH' | 'CONSTITUTION' | 'AGILITY' | 'MIND';

export const PRIMARY_ASPECT_LABEL: Record<PrimaryAspect, string> = {
  STRENGTH: 'Strength',
  CONSTITUTION: 'Constitution',
  AGILITY: 'Agility',
  MIND: 'Mind',
};

// Game-effect style "ability tag" per class (Habitica-like). Displayed
// in the class selector and applied to future raid/enemy calculations.
export type ClassAbility =
  | { tag: '+DMG'; label: string }
  | { tag: '+EVA'; label: string }
  | { tag: '+CRIT'; label: string }
  | { tag: '+HEAL'; label: string }
  | { tag: '+DISC'; label: string };

export const PRIMARY_METRICS_BY_CLASS: Record<string, MetricType[]> = {
  JUGGERNAUT: ['BENCH_1RM', 'SQUAT_1RM', 'DEADLIFT_1RM', 'POWERLIFT_TOTAL'],
  PHANTOM: ['PULLUP_1RM', 'PLANK_HOLD', 'L_SIT_HOLD', 'FIVE_K_TIME'],
  SCOUT: ['VO2_MAX', 'FIVE_K_TIME', 'RESTING_HR', 'HRV'],
  BERSERKER: ['BENCH_1RM', 'SQUAT_1RM', 'PULLUP_1RM', 'PLANK_HOLD'],
  ORACLE: ['HRV', 'RESTING_HR', 'VO2_MAX', 'SLEEP_HOURS', 'SLEEP_QUALITY'],
};

export const CLASS_META: Record<string, {
  label: string;
  color: 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet';
  tagline: string;
  description: string;
  primary: PrimaryAspect;
  ability: ClassAbility;
  // Which archetypes qualify for this class. Empty = available to all.
  eligibility: FrameArchetype[];
}> = {
  JUGGERNAUT: {
    label: 'Juggernaut',
    color: 'amber',
    tagline: 'Heavy hits, big gains',
    description: 'Built for the big lifts. Squat, bench, dead — max out the compound movements. SBD sessions and heavy singles reward massive XP. Powerlifter / bodybuilder.',
    primary: 'STRENGTH',
    ability: { tag: '+DMG', label: 'More raid damage' },
    // STRENGTH primary requires solid or large-balanced build
    eligibility: ['DRAKE', 'FORGE', 'GOLEM', 'BEAR', 'BEHEMOTH'],
  },
  PHANTOM: {
    label: 'Phantom',
    color: 'magenta',
    tagline: 'Agile, lean, bodyweight mastery',
    description: 'Bodyweight and agility. Calisthenics, mobility, total-body control. PRs come from skill, not weight on the bar.',
    primary: 'AGILITY',
    ability: { tag: '+EVA', label: 'Chance to evade in raids' },
    // AGILITY primary: lean or small/medium-balanced. "Too big"
    // archetypes (BEAR, BEHEMOTH, GOLEM, DRAKE) aren't lithe.
    eligibility: ['WISP', 'SPRITE', 'STRIKER', 'FORGE', 'WIRED'],
  },
  SCOUT: {
    label: 'Scout',
    color: 'lime',
    tagline: 'Long, steady, exploring',
    description: 'Explorer. Sustained effort, trail running, hiking, multi-sport. Finds items and quests faster. The first to see new areas and new enemies.',
    primary: 'CONSTITUTION',
    ability: { tag: '+DISC', label: 'Faster item/quest discovery' },
    // CONSTITUTION primary is universal
    eligibility: [],
  },
  BERSERKER: {
    label: 'Berserker',
    color: 'magenta',
    tagline: 'All-out, no days off',
    description: 'High volume, high intensity. HIIT, tabata, all-out efforts. No metagame — just train hard. Intensity is a choice, not a build.',
    primary: 'CONSTITUTION',
    ability: { tag: '+CRIT', label: 'Bonus damage on crits' },
    // CONSTITUTION primary is universal
    eligibility: [],
  },
  ORACLE: {
    label: 'Oracle',
    color: 'cyan',
    tagline: 'Recovery, mindfulness, ritual',
    description: 'Train smart, recover harder. Wellness, sleep, HRV. The compound interest of consistency beats intensity. Yoga, pilates, meditation.',
    primary: 'MIND',
    ability: { tag: '+HEAL', label: 'Heal between rounds · see enemy stats' },
    // MIND primary is universal
    eligibility: [],
  },
};

export function isClassEligible(cls: ClassName, archetype: FrameArchetype | null): boolean {
  const meta = CLASS_META[cls];
  if (!meta) return false;
  if (meta.eligibility.length === 0) return true; // universal
  if (archetype == null) return false;
  return meta.eligibility.includes(archetype);
}

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
