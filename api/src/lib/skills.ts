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
  BODYBUILDER: [
    { className: 'BODYBUILDER', tier: 'TIER_1', name: 'Mind-Muscle Connection', description: '+10% XP from hypertrophy workouts.', cost: 1, prerequisites: [], position: 0, effects: [{ type: 'xp_multiplier', value: 1.1, appliesTo: 'HYPERTROPHY' }] },
    { className: 'BODYBUILDER', tier: 'TIER_1', name: 'PPL Specialist', description: '+10% XP from push/pull/leg sessions.', cost: 1, prerequisites: [], position: 1, effects: [{ type: 'xp_multiplier', value: 1.1, appliesTo: 'HYPERTROPHY' }] },
    { className: 'BODYBUILDER', tier: 'TIER_2', name: 'Volume Tolerance', description: '+15% gold from hypertrophy sessions.', cost: 2, prerequisites: ['Mind-Muscle Connection'], position: 2, effects: [{ type: 'gold_multiplier', value: 1.15, appliesTo: 'HYPERTROPHY' }] },
    { className: 'BODYBUILDER', tier: 'TIER_2', name: 'Body Composition Insight', description: '+1% lean mass genetic max.', cost: 2, prerequisites: ['PPL Specialist'], position: 3, effects: [{ type: 'measurement_bonus', metric: 'LEAN_MASS', value: 0.01 }] },
    { className: 'BODYBUILDER', tier: 'TIER_3', name: 'Aesthetician', description: '+10% raid damage from hypertrophy PRs.', cost: 3, prerequisites: ['Volume Tolerance', 'Body Composition Insight'], position: 4, effects: [{ type: 'raid_damage_multiplier', value: 1.1 }] },
  ],

  POWERLIFTER: [
    { className: 'POWERLIFTER', tier: 'TIER_1', name: 'Bracing', description: '+10% XP from SBD sessions.', cost: 1, prerequisites: [], position: 0, effects: [{ type: 'xp_multiplier', value: 1.1, appliesTo: 'STRENGTH' }] },
    { className: 'POWERLIFTER', tier: 'TIER_1', name: 'Conjugate', description: '+5% gold from all workouts.', cost: 1, prerequisites: [], position: 1, effects: [{ type: 'gold_multiplier', value: 1.05, appliesTo: 'ALL' }] },
    { className: 'POWERLIFTER', tier: 'TIER_2', name: 'Pause Specialist', description: '+10% PR detection sensitivity.', cost: 2, prerequisites: ['Bracing'], position: 2, effects: [{ type: 'raid_damage_multiplier', value: 1.05 }] },
    { className: 'POWERLIFTER', tier: 'TIER_2', name: 'Intensity King', description: '+15% XP from heavy singles (1-3 reps).', cost: 2, prerequisites: ['Conjugate'], position: 3, effects: [{ type: 'xp_multiplier', value: 1.15, appliesTo: 'STRENGTH' }] },
    { className: 'POWERLIFTER', tier: 'TIER_3', name: 'Total Domination', description: '+1% bench, squat, deadlift genetic max.', cost: 3, prerequisites: ['Pause Specialist', 'Intensity King'], position: 4, effects: [
      { type: 'measurement_bonus', metric: 'BENCH_1RM', value: 0.01 },
      { type: 'measurement_bonus', metric: 'SQUAT_1RM', value: 0.01 },
      { type: 'measurement_bonus', metric: 'DEADLIFT_1RM', value: 0.01 },
    ] },
  ],

  CALISTHENIST: [
    { className: 'CALISTHENIST', tier: 'TIER_1', name: 'Static Holds', description: '+10% XP from calisthenics sessions.', cost: 1, prerequisites: [], position: 0, effects: [{ type: 'xp_multiplier', value: 1.1, appliesTo: 'CALISTHENICS' }] },
    { className: 'CALISTHENIST', tier: 'TIER_1', name: 'Body Awareness', description: '+5% XP from mobility work.', cost: 1, prerequisites: [], position: 1, effects: [{ type: 'xp_multiplier', value: 1.05, appliesTo: 'MOBILITY' }] },
    { className: 'CALISTHENIST', tier: 'TIER_2', name: 'Dynamic Skills', description: '+10% gold from calisthenics.', cost: 2, prerequisites: ['Static Holds'], position: 2, effects: [{ type: 'gold_multiplier', value: 1.10, appliesTo: 'CALISTHENICS' }] },
    { className: 'CALISTHENIST', tier: 'TIER_2', name: 'One-Arm Path', description: '+15% pull-up genetic max.', cost: 2, prerequisites: ['Body Awareness'], position: 3, effects: [{ type: 'measurement_bonus', metric: 'PULLUP_1RM', value: 0.15 }] },
    { className: 'CALISTHENIST', tier: 'TIER_3', name: 'Skill Mastery', description: '+20% raid damage from calisthenics PRs.', cost: 3, prerequisites: ['Dynamic Skills', 'One-Arm Path'], position: 4, effects: [{ type: 'raid_damage_multiplier', value: 1.20 }] },
  ],

  ENDURANCE: [
    { className: 'ENDURANCE', tier: 'TIER_1', name: 'Zone 2 Foundation', description: '+10% XP from cardio sessions.', cost: 1, prerequisites: [], position: 0, effects: [{ type: 'xp_multiplier', value: 1.1, appliesTo: 'CARDIO' }] },
    { className: 'ENDURANCE', tier: 'TIER_1', name: 'Aerobic Engine', description: '+5% gold from cardio.', cost: 1, prerequisites: [], position: 1, effects: [{ type: 'gold_multiplier', value: 1.05, appliesTo: 'CARDIO' }] },
    { className: 'ENDURANCE', tier: 'TIER_2', name: 'Lactate Threshold', description: '+10% XP from cardio PRs.', cost: 2, prerequisites: ['Zone 2 Foundation'], position: 2, effects: [{ type: 'xp_multiplier', value: 1.1, appliesTo: 'CARDIO' }] },
    { className: 'ENDURANCE', tier: 'TIER_2', name: 'HRV Reader', description: '+1 HRV genetic max.', cost: 2, prerequisites: ['Aerobic Engine'], position: 3, effects: [{ type: 'measurement_bonus', metric: 'HRV', value: 1 }] },
    { className: 'ENDURANCE', tier: 'TIER_3', name: 'VO2 Peak', description: '+1 VO2 max genetic ceiling.', cost: 3, prerequisites: ['Lactate Threshold', 'HRV Reader'], position: 4, effects: [{ type: 'measurement_bonus', metric: 'VO2_MAX', value: 1 }] },
  ],

  HYBRID: [
    { className: 'HYBRID', tier: 'TIER_1', name: 'Adaptation', description: '+5% XP from all workouts.', cost: 1, prerequisites: [], position: 0, effects: [{ type: 'xp_multiplier', value: 1.05, appliesTo: 'ALL' }] },
    { className: 'HYBRID', tier: 'TIER_1', name: 'Recovery', description: '+10% gold from all sessions.', cost: 1, prerequisites: [], position: 1, effects: [{ type: 'gold_multiplier', value: 1.10, appliesTo: 'ALL' }] },
    { className: 'HYBRID', tier: 'TIER_2', name: 'Jack-of-All', description: '+5% raid damage.', cost: 2, prerequisites: ['Adaptation'], position: 2, effects: [{ type: 'raid_damage_multiplier', value: 1.05 }] },
    { className: 'HYBRID', tier: 'TIER_2', name: 'Generalist', description: '+1% to all strength genetic maxes.', cost: 2, prerequisites: ['Recovery'], position: 3, effects: [
      { type: 'measurement_bonus', metric: 'BENCH_1RM', value: 0.01 },
      { type: 'measurement_bonus', metric: 'SQUAT_1RM', value: 0.01 },
      { type: 'measurement_bonus', metric: 'DEADLIFT_1RM', value: 0.01 },
    ] },
    { className: 'HYBRID', tier: 'TIER_3', name: 'Master of None, Better Than One', description: '+15% XP and gold from all workouts.', cost: 3, prerequisites: ['Jack-of-All', 'Generalist'], position: 4, effects: [
      { type: 'xp_multiplier', value: 1.15, appliesTo: 'ALL' },
      { type: 'gold_multiplier', value: 1.15, appliesTo: 'ALL' },
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
