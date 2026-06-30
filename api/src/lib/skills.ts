// Backward-compat type exports for code that still imports
// SkillDef / SkillEffect. The full skill tree data now lives
// in seedSkills.ts (196 skills across 6 classes).

export type SkillEffect =
  | { type: 'xp_multiplier'; value: number; appliesTo: string }
  | { type: 'gold_multiplier'; value: number; appliesTo: string }
  | { type: 'raid_damage_multiplier'; value: number }
  | { type: 'measurement_bonus'; metric: string; value: number }
  | { type: 'unlock_metric'; metric: string };

export type SkillDef = {
  className: import('./prisma.js').ClassName;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  name: string;
  description: string;
  cost: number;
  prerequisites: string[];
  position: number;
  effects: SkillEffect[];
};
