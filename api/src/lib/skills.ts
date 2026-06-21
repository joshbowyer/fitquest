import type { ClassName } from '@prisma/client';

export type SkillEffect =
  | { type: 'xp_multiplier'; value: number; appliesTo: string }
  | { type: 'gold_multiplier'; value: number; appliesTo: string }
  | { type: 'raid_damage_multiplier'; value: number }
  | { type: 'measurement_bonus'; metric: string; value: number }
  | { type: 'unlock_metric'; metric: string };

export type SkillDef = {
  className: ClassName;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  name: string;
  description: string;
  cost: number;
  prerequisites: string[];
  position: number;
  effects: SkillEffect[];
};

export const SKILL_TREES: Record<ClassName, SkillDef[]> = {
  JUGGERNAUT: [
    { className: 'JUGGERNAUT', tier: 'TIER_1', name: 'Bracing', description: '+10% XP from SBD sessions.', cost: 1, prerequisites: [], position: 0, effects: [{ type: 'xp_multiplier', value: 1.1, appliesTo: 'STRENGTH' }] },
    { className: 'JUGGERNAUT', tier: 'TIER_1', name: 'Compound Specialist', description: '+10% gold from PRs.', cost: 1, prerequisites: [], position: 1, effects: [{ type: 'gold_multiplier', value: 1.10, appliesTo: 'ALL' }] },
    { className: 'JUGGERNAUT', tier: 'TIER_2', name: 'Heavy Hitter', description: '+5% bench/squat/deadlift XP.', cost: 2, prerequisites: ['Bracing'], position: 2, effects: [{ type: 'xp_multiplier', value: 1.05, appliesTo: 'STRENGTH' }] },
    { className: 'JUGGERNAUT', tier: 'TIER_2', name: 'Power Through Pain', description: '+15% XP from heavy singles (1-3 reps).', cost: 2, prerequisites: ['Compound Specialist'], position: 3, effects: [{ type: 'xp_multiplier', value: 1.15, appliesTo: 'STRENGTH' }] },
    { className: 'JUGGERNAUT', tier: 'TIER_3', name: 'Mountain of Muscle', description: '+1% all muscle-genetic maxes.', cost: 3, prerequisites: ['Heavy Hitter', 'Power Through Pain'], position: 4, effects: [
      { type: 'measurement_bonus', metric: 'BENCH_1RM', value: 0.01 },
      { type: 'measurement_bonus', metric: 'SQUAT_1RM', value: 0.01 },
      { type: 'measurement_bonus', metric: 'DEADLIFT_1RM', value: 0.01 },
      { type: 'measurement_bonus', metric: 'OHP_1RM', value: 0.01 },
    ] },
  ],

  PHANTOM: [
    { className: 'PHANTOM', tier: 'TIER_1', name: 'Static Holds', description: '+10% XP from calisthenics sessions.', cost: 1, prerequisites: [], position: 0, effects: [{ type: 'xp_multiplier', value: 1.1, appliesTo: 'CALISTHENICS' }] },
    { className: 'PHANTOM', tier: 'TIER_1', name: 'Body Awareness', description: '+5% XP from mobility work.', cost: 1, prerequisites: [], position: 1, effects: [{ type: 'xp_multiplier', value: 1.05, appliesTo: 'MOBILITY' }] },
    { className: 'PHANTOM', tier: 'TIER_2', name: 'Aerobic Engine', description: '+10% XP from cardio sessions.', cost: 2, prerequisites: ['Static Holds'], position: 2, effects: [{ type: 'xp_multiplier', value: 1.10, appliesTo: 'CARDIO' }] },
    { className: 'PHANTOM', tier: 'TIER_2', name: 'One-Arm Path', description: '+15% pull-up genetic max.', cost: 2, prerequisites: ['Body Awareness'], position: 3, effects: [{ type: 'measurement_bonus', metric: 'PULLUP_1RM', value: 0.15 }] },
    { className: 'PHANTOM', tier: 'TIER_3', name: 'Skill Mastery', description: '+20% raid damage from calisthenics PRs + +EVA proc chance.', cost: 3, prerequisites: ['Aerobic Engine', 'One-Arm Path'], position: 4, effects: [
      { type: 'raid_damage_multiplier', value: 1.20 },
      { type: 'measurement_bonus', metric: 'PULLUP_1RM', value: 0.20 },
    ] },
  ],

  SCOUT: [
    { className: 'SCOUT', tier: 'TIER_1', name: 'Trail Sense', description: '+10% XP from cardio sessions.', cost: 1, prerequisites: [], position: 0, effects: [{ type: 'xp_multiplier', value: 1.1, appliesTo: 'CARDIO' }] },
    { className: 'SCOUT', tier: 'TIER_1', name: 'Pathfinder', description: '+5% gold from all sessions (exploration bonus).', cost: 1, prerequisites: [], position: 1, effects: [{ type: 'gold_multiplier', value: 1.05, appliesTo: 'ALL' }] },
    { className: 'SCOUT', tier: 'TIER_2', name: 'Forager', description: '+10% XP from cardio PRs (faster route discovery).', cost: 2, prerequisites: ['Trail Sense'], position: 2, effects: [{ type: 'xp_multiplier', value: 1.10, appliesTo: 'CARDIO' }] },
    { className: 'SCOUT', tier: 'TIER_2', name: 'HRV Reader', description: '+1 HRV genetic max.', cost: 2, prerequisites: ['Pathfinder'], position: 3, effects: [{ type: 'measurement_bonus', metric: 'HRV', value: 1 }] },
    { className: 'SCOUT', tier: 'TIER_3', name: 'Cartographer', description: '+1 VO2 max ceiling + +DISC mastery (sees hidden routes).', cost: 3, prerequisites: ['Forager', 'HRV Reader'], position: 4, effects: [
      { type: 'measurement_bonus', metric: 'VO2_MAX', value: 1 },
    ] },
  ],

  BERSERKER: [
    { className: 'BERSERKER', tier: 'TIER_1', name: 'All-Out', description: '+10% XP on high-RPE sets (RPE ≥ 8).', cost: 1, prerequisites: [], position: 0, effects: [{ type: 'xp_multiplier', value: 1.10, appliesTo: 'ALL' }] },
    { className: 'BERSERKER', tier: 'TIER_1', name: 'Volume King', description: '+10% XP on hypertrophy workouts.', cost: 1, prerequisites: [], position: 1, effects: [{ type: 'xp_multiplier', value: 1.10, appliesTo: 'HYPERTROPHY' }] },
    { className: 'BERSERKER', tier: 'TIER_2', name: 'No Days Off', description: '+5% XP on streak days.', cost: 2, prerequisites: ['All-Out'], position: 2, effects: [{ type: 'xp_multiplier', value: 1.05, appliesTo: 'ALL' }] },
    { className: 'BERSERKER', tier: 'TIER_2', name: 'Pain into Power', description: '+10% gold on all sessions.', cost: 2, prerequisites: ['Volume King'], position: 3, effects: [{ type: 'gold_multiplier', value: 1.10, appliesTo: 'ALL' }] },
    { className: 'BERSERKER', tier: 'TIER_3', name: 'Unstoppable', description: '+1% all muscle-genetic maxes.', cost: 3, prerequisites: ['No Days Off', 'Pain into Power'], position: 4, effects: [
      { type: 'measurement_bonus', metric: 'BENCH_1RM', value: 0.01 },
      { type: 'measurement_bonus', metric: 'SQUAT_1RM', value: 0.01 },
      { type: 'measurement_bonus', metric: 'DEADLIFT_1RM', value: 0.01 },
    ] },
  ],

  TRACER: [
    { className: 'TRACER', tier: 'TIER_1', name: 'Burst', description: '+15% XP from sprint / plyometric sessions.', cost: 1, prerequisites: [], position: 0, effects: [{ type: 'xp_multiplier', value: 1.15, appliesTo: 'CARDIO' }] },
    { className: 'TRACER', tier: 'TIER_1', name: 'Fast Twitch', description: '+10% gold from 1mi / 5K PRs.', cost: 1, prerequisites: [], position: 1, effects: [{ type: 'gold_multiplier', value: 1.10, appliesTo: 'ALL' }] },
    { className: 'TRACER', tier: 'TIER_2', name: 'Vapor Trail', description: '+10% XP from high-pace 5K runs.', cost: 2, prerequisites: ['Burst'], position: 2, effects: [{ type: 'xp_multiplier', value: 1.10, appliesTo: 'CARDIO' }] },
    { className: 'TRACER', tier: 'TIER_2', name: 'Lactic Tolerance', description: '-1 second off 5K genetic max (anaerobic threshold).', cost: 2, prerequisites: ['Fast Twitch'], position: 3, effects: [{ type: 'measurement_bonus', metric: 'FIVE_K_TIME', value: -1 }] },
    { className: 'TRACER', tier: 'TIER_3', name: 'Phantom Step', description: '+25% raid damage + +BURST mastery (always acts first).', cost: 3, prerequisites: ['Vapor Trail', 'Lactic Tolerance'], position: 4, effects: [
      { type: 'raid_damage_multiplier', value: 1.25 },
      { type: 'measurement_bonus', metric: 'ONE_MILE_TIME', value: -2 },
    ] },
  ],

  ORACLE: [
    { className: 'ORACLE', tier: 'TIER_1', name: 'Mindful Movement', description: '+5% XP on mobility/recovery sessions.', cost: 1, prerequisites: [], position: 0, effects: [{ type: 'xp_multiplier', value: 1.05, appliesTo: 'MOBILITY' }] },
    { className: 'ORACLE', tier: 'TIER_1', name: 'Sleep Mastery', description: '+10% XP for logging 7+ hrs of sleep.', cost: 1, prerequisites: [], position: 1, effects: [{ type: 'xp_multiplier', value: 1.10, appliesTo: 'ALL' }] },
    { className: 'ORACLE', tier: 'TIER_2', name: 'Rest Day Reward', description: '+10% gold on rest days.', cost: 2, prerequisites: ['Mindful Movement'], position: 2, effects: [{ type: 'gold_multiplier', value: 1.10, appliesTo: 'ALL' }] },
    { className: 'ORACLE', tier: 'TIER_2', name: 'HRV Reader', description: '+1 HRV genetic max.', cost: 2, prerequisites: ['Sleep Mastery'], position: 3, effects: [{ type: 'measurement_bonus', metric: 'HRV', value: 1 }] },
    { className: 'ORACLE', tier: 'TIER_3', name: 'Inner Peace', description: '+1 VO2 max ceiling, +1 recovery.', cost: 3, prerequisites: ['Rest Day Reward', 'HRV Reader'], position: 4, effects: [
      { type: 'measurement_bonus', metric: 'VO2_MAX', value: 1 },
    ] },
  ],
};

export async function ensureSkillsSeeded() {
  const { prisma } = await import('./prisma.js');
  for (const list of Object.values(SKILL_TREES)) {
    for (const s of list) {
      await prisma.skill.upsert({
        where: { name: s.name },
        create: {
          className: s.className,
          tier: s.tier,
          name: s.name,
          description: s.description,
          cost: s.cost,
          prerequisites: s.prerequisites,
          position: s.position,
          effects: s.effects as any,
        },
        update: {
          className: s.className,
          tier: s.tier,
          description: s.description,
          cost: s.cost,
          prerequisites: s.prerequisites,
          position: s.position,
          effects: s.effects as any,
        },
      });
    }
  }
}
