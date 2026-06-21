export type ClassName =
  | 'JUGGERNAUT'
  | 'PHANTOM'
  | 'SCOUT'
  | 'BERSERKER'
  | 'TRACER'
  | 'ORACLE';

export type MetricType =
  | 'BICEP' | 'CHEST' | 'SHOULDER' | 'QUAD' | 'CALF' | 'FOREARM' | 'NECK' | 'WAIST'
  | 'BENCH_1RM' | 'SQUAT_1RM' | 'DEADLIFT_1RM' | 'OHP_1RM' | 'PULLUP_1RM'
  | 'BODY_FAT_PCT' | 'LEAN_MASS' | 'FFMI' | 'WEIGHT'
  | 'VO2_MAX' | 'RESTING_HR' | 'HRV' | 'FIVE_K_TIME' | 'ONE_MILE_TIME'
  | 'PLANK_HOLD' | 'L_SIT_HOLD' | 'PUSHUP_MAX' | 'PULLUP_MAX'
  | 'POWERLIFT_TOTAL'
  // Derived — not logged directly. Computed by Dashboard from SHOULDER + WAIST.
  | 'SHOULDER_WAIST_RATIO'
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
  // SHOULDER is shoulder-to-shoulder BREADTH (the "biacromial
  // breadth"), NOT the deltoid circumference.
  SHOULDER: { type: 'SHOULDER', category: 'HYPERTROPHY', label: 'Shoulder Width', shortLabel: 'Shoulder', unit: 'cm', defaultMin: 38, description: 'Shoulder-to-shoulder breadth (biacromial).' },
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
  // LEAN_MASS is derived from weight × (1 - bf%). It's shown in
  // the UI but never logged directly. The Measurements page and
  // WeighIn panel hide the entry UI for this metric.
  LEAN_MASS: { type: 'LEAN_MASS', category: 'BODY_COMP', label: 'Lean Mass (auto)', shortLabel: 'Lean Mass', unit: 'kg', defaultMin: 50, description: 'Auto-calculated: weight × (1 − body fat %).' },
  FFMI: { type: 'FFMI', category: 'BODY_COMP', label: 'FFMI', shortLabel: 'FFMI', unit: '', defaultMin: 18, description: 'Fat-Free Mass Index (auto).' },
  WEIGHT: { type: 'WEIGHT', category: 'BODY_COMP', label: 'Body Weight', shortLabel: 'Weight', unit: 'kg', defaultMin: 50, description: 'Total body weight.' },
  VO2_MAX: { type: 'VO2_MAX', category: 'CARDIO', label: 'VO2 Max', shortLabel: 'VO2 Max', unit: 'ml/kg/min', defaultMin: 30, description: 'Maximal oxygen uptake.' },
  RESTING_HR: { type: 'RESTING_HR', category: 'CARDIO', label: 'Resting Heart Rate', shortLabel: 'Resting HR', unit: 'bpm', defaultMin: 50, description: 'Resting heart rate.' },
  HRV: { type: 'HRV', category: 'CARDIO', label: 'HRV (RMSSD)', shortLabel: 'HRV', unit: 'ms', defaultMin: 30, description: 'Heart rate variability.' },
  FIVE_K_TIME: { type: 'FIVE_K_TIME', category: 'CARDIO', label: '5K Time', shortLabel: '5K', unit: 's', defaultMin: 1500, description: 'Best 5K run time in seconds.' },
  ONE_MILE_TIME: { type: 'ONE_MILE_TIME', category: 'CARDIO', label: '1 Mile Time', shortLabel: '1 Mile', unit: 's', defaultMin: 360, description: 'Best 1 mile run time in seconds.' },
  PLANK_HOLD: { type: 'PLANK_HOLD', category: 'CALISTHENICS', label: 'Plank Hold', shortLabel: 'Plank', unit: 's', defaultMin: 30, description: 'Longest plank hold.' },
  L_SIT_HOLD: { type: 'L_SIT_HOLD', category: 'CALISTHENICS', label: 'L-Sit Hold', shortLabel: 'L-Sit', unit: 's', defaultMin: 5, description: 'Longest L-sit hold.' },
  PUSHUP_MAX: { type: 'PUSHUP_MAX', category: 'CALISTHENICS', label: 'Push-ups in a Row', shortLabel: 'Push-ups', unit: 'reps', defaultMin: 5, description: 'Max push-ups in a single unbroken set.' },
  PULLUP_MAX: { type: 'PULLUP_MAX', category: 'CALISTHENICS', label: 'Pull-ups in a Row', shortLabel: 'Pull-ups', unit: 'reps', defaultMin: 1, description: 'Max pull-ups in a single unbroken set.' },
  POWERLIFT_TOTAL: { type: 'POWERLIFT_TOTAL', category: 'STRENGTH', label: 'Powerlifting Total', shortLabel: 'PL Total', unit: 'kg', defaultMin: 200, description: 'Sum of best Squat + Bench + Deadlift.' },
  // Derived metric — auto-computed from SHOULDER ÷ WAIST. Not loggable.
  SHOULDER_WAIST_RATIO: { type: 'SHOULDER_WAIST_RATIO', category: 'BODY_COMP', label: 'V-Taper', shortLabel: 'V-TAPER', unit: '', defaultMin: 1, description: 'Auto: shoulder width ÷ waist circumference. Higher = more V-taper.' },
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
  BODY_COMP: ['BODY_FAT_PCT', 'LEAN_MASS', 'FFMI', 'WEIGHT', 'WAIST', 'SHOULDER_WAIST_RATIO'],
  CARDIO: ['VO2_MAX', 'RESTING_HR', 'HRV', 'FIVE_K_TIME', 'ONE_MILE_TIME'],
  CALISTHENICS: ['PLANK_HOLD', 'L_SIT_HOLD', 'PUSHUP_MAX', 'PULLUP_MAX'],
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
  TRACER: ['ONE_MILE_TIME', 'FIVE_K_TIME', 'VO2_MAX', 'RESTING_HR'],
  ORACLE: ['HRV', 'RESTING_HR', 'VO2_MAX', 'SLEEP_HOURS', 'SLEEP_QUALITY'],
};

// ====================================================================
//  Class Evolution Tree
// ====================================================================
// Each class line has 3 stages. Stage is purely derived from the
// user's level, so a "Bruiser" automatically becomes a "Strongman"
// when they cross level 10, and a "Juggernaut" at level 25.
//
//   Stage 1 (Lv 1-9):     beginner name
//   Stage 2 (Lv 10-24):   intermediate name
//   Stage 3 (Lv 25+):     final / advanced name
//
// The 5 lines map to the 5 ClassName values that already exist in
// the schema. The display name changes; the underlying ClassName
// (used by raid damage, etc.) stays the same.

export type ClassStage = 1 | 2 | 3;

export const CLASS_EVOLUTION: Record<string, {
  line: string;          // matches ClassName
  stages: [string, string, string]; // [stage1, stage2, stage3]
  // Level thresholds for promotion. index i = threshold to promote FROM i TO i+1.
  thresholds: [number, number];
}> = {
  JUGGERNAUT: {
    line: 'JUGGERNAUT',
    stages: ['Bruiser', 'Strongman', 'Juggernaut'],
    thresholds: [10, 25],
  },
  PHANTOM: {
    line: 'PHANTOM',
    stages: ['Striker', 'Acrobat', 'Phantom'],
    thresholds: [10, 25],
  },
  SCOUT: {
    line: 'SCOUT',
    stages: ['Hiker', 'Trailblazer', 'Scout'],
    thresholds: [10, 25],
  },
  BERSERKER: {
    line: 'BERSERKER',
    stages: ['Brawler', 'Marauder', 'Berserker'],
    thresholds: [10, 25],
  },
  ORACLE: {
    line: 'ORACLE',
    stages: ['Initiate', 'Acolyte', 'Oracle'],
    thresholds: [10, 25],
  },
};

export function getClassStage(level: number): ClassStage {
  if (level >= 25) return 3;
  if (level >= 10) return 2;
  return 1;
}

export function getClassDisplayName(line: string | null, level: number): string {
  if (!line) return 'Unclassed';
  const evo = CLASS_EVOLUTION[line];
  if (!evo) return line;
  const stage = getClassStage(level);
  return evo.stages[stage - 1];
}

export function getNextPromotion(line: string | null, level: number): { nextStage: ClassStage; threshold: number } | null {
  if (!line) return null;
  const evo = CLASS_EVOLUTION[line];
  if (!evo) return null;
  const stage = getClassStage(level);
  if (stage >= 3) return null;
  return { nextStage: (stage + 1) as ClassStage, threshold: evo.thresholds[stage - 1] };
}

export const CLASS_META: Record<string, {
  label: string;
  color: 'cyan' | 'red' | 'orange' | 'magenta' | 'lime' | 'amber' | 'goldenrod' | 'periwinkle' | 'violet';
  tagline: string;
  description: string;
  // Concise fitness style mapping (displayed on the Profile page).
  fitnessType: string;
  primary: PrimaryAspect;
  ability: ClassAbility;
  // Energy-system tag — what's being trained (aerobic capacity, anaerobic
  // burst, recovery, etc.). Surfaced on class cards so users can compare
  // classes at a glance.
  energySystem: 'AEROBIC' | 'ANAEROBIC' | 'POWER' | 'INTENSITY' | 'CONTROL' | 'RECOVERY';
  // Which archetypes qualify for this class. Empty = available to all.
  eligibility: FrameArchetype[];
}> = {
  JUGGERNAUT: {
    label: 'Juggernaut',
    color: 'red',
    tagline: 'Heavy hits, big gains',
    description: 'Built for the big lifts. Squat, bench, dead — max out the compound movements. SBD sessions and heavy singles reward massive XP. Powerlifter / bodybuilder.',
    fitnessType: 'Powerlifting / Heavy Strength',
    primary: 'STRENGTH',
    energySystem: 'POWER',
    ability: { tag: '+DMG', label: 'More raid damage' },
    eligibility: ['DRAKE', 'FORGE', 'GOLEM', 'BEAR', 'BEHEMOTH'],
  },
  PHANTOM: {
    label: 'Phantom',
    color: 'lime',
    tagline: 'Agile, lean, bodyweight mastery',
    description: 'Bodyweight and agility. Calisthenics, mobility, total-body control. PRs come from skill, not weight on the bar.',
    fitnessType: 'Calisthenics / Gymnastics / Mobility',
    primary: 'AGILITY',
    energySystem: 'CONTROL',
    ability: { tag: '+EVA', label: 'Chance to evade in raids' },
    eligibility: ['WISP', 'SPRITE', 'STRIKER', 'FORGE', 'WIRED'],
  },
  SCOUT: {
    label: 'Scout',
    color: 'goldenrod',
    tagline: 'Long, steady, exploring',
    description: 'Explorer. Sustained aerobic effort — trail running, hiking, biking, rucking. The path of the steady. Distinct from Tracer in energy system: Scout trains mitochondria, not fast-twitch.',
    fitnessType: 'Endurance / Trail Running / Hiking',
    primary: 'CONSTITUTION',
    energySystem: 'AEROBIC',
    ability: { tag: '+DISC', label: 'Faster item/quest discovery' },
    eligibility: [],
  },
  BERSERKER: {
    label: 'Berserker',
    color: 'magenta',
    tagline: 'All-out, no days off',
    description: 'High volume, high intensity. HIIT, tabata, all-out efforts. No metagame — just train hard. Intensity is a choice, not a build.',
    fitnessType: 'HIIT / CrossFit / Conditioning',
    primary: 'STRENGTH',
    energySystem: 'INTENSITY',
    ability: { tag: '+CRIT', label: 'Bonus damage on crits' },
    eligibility: [],
  },
  TRACER: {
    label: 'Tracer',
    color: 'orange',
    tagline: 'Burst, vanish, return',
    description: 'Sprinting and explosive movement — track intervals, plyometrics, jump rope, martial arts bursts. Anaerobic, fast-twitch dominant. Distinct from Scout: short, max effort, repeat. Sprint across The Gap before it closes.',
    fitnessType: 'Sprinting / Plyometrics / Martial Arts',
    primary: 'AGILITY',
    energySystem: 'ANAEROBIC',
    ability: { tag: '+BURST', label: 'Initiative + front-loaded raid damage' },
    eligibility: ['WISP', 'STRIKER', 'WIRED'],
  },
  ORACLE: {
    label: 'Oracle',
    color: 'periwinkle',
    tagline: 'Recovery, mindfulness, ritual',
    description: 'Train smart, recover harder. Wellness, sleep, HRV. The compound interest of consistency beats intensity. Yoga, pilates, meditation.',
    fitnessType: 'Yoga / Recovery / Wellness',
    primary: 'MIND',
    energySystem: 'RECOVERY',
    ability: { tag: '+HEAL', label: 'Heal between rounds · see enemy stats' },
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
  skipped?: boolean;
  skipReason?: 'INJURY' | 'ILLNESS' | 'FATIGUE' | 'EQUIPMENT' | 'SCHEDULE' | 'OTHER' | null;
};

/** Server-generated morning briefing. One row per user per day. */
export type MorningReport = {
  id: string;
  userId: string;
  date: string;
  general: string;
  sleep: string;
  training: string;
  recovery: string;
  nutrition: string;
  spiritual: string;
  riskFlags: string[];
  model: string | null;
  latencyMs: number | null;
  createdAt: string;
  cached: boolean;
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


// ---------------------------------------------------------------------------
// Inventory — equipment catalog + per-user ownership.
// ---------------------------------------------------------------------------

export type EquipSlot = 'HEAD' | 'BODY' | 'HANDS' | 'FEET' | 'MAIN' | 'OFF' | 'NECK' | 'RING';

export const EQUIP_SLOTS: EquipSlot[] = ['HEAD', 'BODY', 'HANDS', 'FEET', 'MAIN', 'OFF', 'NECK', 'RING'];

export const EQUIP_SLOT_LABEL: Record<EquipSlot, string> = {
  HEAD:  'Helm',
  BODY:  'Armor',
  HANDS: 'Gloves',
  FEET:  'Boots',
  MAIN:  'Main Hand',
  OFF:   'Off Hand',
  NECK:  'Amulet',
  RING:  'Ring',
};

export const EQUIP_SLOT_GLYPH: Record<EquipSlot, string> = {
  HEAD:  '⛑',
  BODY:  '🛡',
  HANDS: '✋',
  FEET:  '🥾',
  MAIN:  '⚔',
  OFF:   '🛡',
  NECK:  '📿',
  RING:  '💍',
};

export type ItemRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC';

export const RARITY_ORDER: Record<ItemRarity, number> = {
  COMMON: 0, UNCOMMON: 1, RARE: 2, EPIC: 3, LEGENDARY: 4, MYTHIC: 5,
};

export const RARITY_COLOR: Record<ItemRarity, string> = {
  COMMON:    '#a8a8b8',
  UNCOMMON:  '#5cffa0',
  RARE:      '#5cb8ff',
  EPIC:      '#c45cff',
  LEGENDARY: '#ffc34d',
  MYTHIC:    '#ff55cc',
};

export const RARITY_LABEL: Record<ItemRarity, string> = {
  COMMON:    'Common',
  UNCOMMON:  'Uncommon',
  RARE:      'Rare',
  EPIC:      'Epic',
  LEGENDARY: 'Legendary',
  MYTHIC:    'Mythic',
};

export type ItemSource =
  | 'MONSTER_DROP'
  | 'BOSS_DROP'
  | 'QUEST_REWARD'
  | 'SHOP'
  | 'CRAFTED'
  | 'ACHIEVEMENT'
  | 'STARTER_KIT';

export type ItemStats = Record<string, number>;

export type ItemDef = {
  id: string;
  name: string;
  description: string | null;
  slot: EquipSlot;
  sprite: string;
  color: string;
  rarity: ItemRarity;
  stats: ItemStats;
  classRestriction: string | null;
  setId: string | null;
  createdAt: string;
};

export type InventoryItem = {
  id: string;
  userId: string;
  itemDefId: string;
  equippedSlot: EquipSlot | null;
  acquiredAt: string;
  source: ItemSource;
  notes: string | null;
  itemDef: ItemDef;
};

// Convenience: stat key display
export const STAT_LABEL: Record<string, string> = {
  '+DMG':   'Damage',
  '+CRIT':  'Crit Chance',
  '+EVA':   'Evade',
  '+DEF':   'Defense',
  '+HP':    'HP',
  '+HEAL':  'Healing',
  '+BURST': 'Burst',
  '+DISC':  'Discovery',
  '+XP':    'XP Bonus',
  '+GOLD':  'Gold Bonus',
};
