// Map exercise names to the body parts they primarily work.
// Used to populate the Exercise.musclesWorked field when a user
// logs a workout. The lookup is by lowercase substring so it
// tolerates "Bench Press", "Bench", "Barbell Bench Press", etc.

import type { BodyPartId } from '@/components/BodyModel';

type MuscleRule = {
  // Substrings (case-insensitive) that trigger this rule
  matches: string[];
  parts: BodyPartId[];
  // Optional: the side of the muscle
  side?: 'BOTH' | 'L' | 'R';
};

const RULES: MuscleRule[] = [
  // Chest / pec
  { matches: ['bench', 'incline press', 'decline press', 'chest press', 'fly', 'pec deck', 'cable fly', 'push up', 'pushup'], parts: ['PECTORAL', 'TRICEP_L', 'TRICEP_R', 'SHOULDER_L', 'SHOULDER_R'] },

  // Shoulders / delts
  { matches: ['overhead press', 'ohp', 'military press', 'shoulder press', 'lateral raise', 'front raise', 'rear delt', 'upright row', 'arnold press'], parts: ['SHOULDER_L', 'SHOULDER_R', 'ROTATOR_CUFF_L', 'ROTATOR_CUFF_R', 'TRICEP_L', 'TRICEP_R'] },

  // Back / lats / traps
  { matches: ['pull up', 'pullup', 'chin up', 'chinup', 'lat pulldown', 'pulldown', 'row', 'seated row', 'barbell row', 'dumbbell row', 't-bar', 't bar', 'pendlay', 'face pull', 'shrug'], parts: ['LAT_L', 'LAT_R', 'BICEP_L', 'BICEP_R', 'TRAPS'] },
  { matches: ['deadlift', 'dead lift', 'rdl', 'romanian deadlift', 'sumo deadlift', 'trap bar'], parts: ['BACK_LOWER', 'HAMSTRING_L', 'HAMSTRING_R', 'GLUTE_L', 'GLUTE_R', 'TRAPS', 'LAT_L', 'LAT_R'] },

  // Arms — biceps
  { matches: ['bicep curl', 'biceps curl', 'barbell curl', 'dumbbell curl', 'hammer curl', 'preacher curl', 'concentration curl', 'ez bar curl', 'cable curl'], parts: ['BICEP_L', 'BICEP_R', 'FOREARM_L', 'FOREARM_R'] },

  // Arms — triceps
  { matches: ['tricep', 'triceps', 'skull crusher', 'skullcrusher', 'pushdown', 'push down', 'kickback', 'close grip', 'close-grip', 'diamond push', 'overhead extension'], parts: ['TRICEP_L', 'TRICEP_R'] },

  // Forearms / grip
  { matches: ['wrist curl', 'reverse curl', 'farmer carry', 'farmer walk', 'grip', 'forearm curl'], parts: ['FOREARM_L', 'FOREARM_R', 'WRIST_L', 'WRIST_R'] },

  // Legs — quads dominant
  { matches: ['squat', 'front squat', 'goblet squat', 'leg press', 'leg extension', 'hack squat', 'split squat', 'bulgarian', 'step up', 'stepup', 'lunge', 'walking lunge'], parts: ['QUAD_L', 'QUAD_R', 'GLUTE_L', 'GLUTE_R', 'ADDUCTOR_L', 'ADDUCTOR_R'] },

  // Legs — hamstring dominant
  { matches: ['leg curl', 'lying leg curl', 'seated leg curl', 'stiff leg', 'good morning', 'nordic curl'], parts: ['HAMSTRING_L', 'HAMSTRING_R', 'GLUTE_L', 'GLUTE_R'] },

  // Glutes
  { matches: ['hip thrust', 'glute bridge', 'cable kickback', 'glute kickback'], parts: ['GLUTE_L', 'GLUTE_R'] },

  // Calves
  { matches: ['calf raise', 'calves', 'calf press', 'standing calf', 'seated calf'], parts: ['CALF_L', 'CALF_R'] },

  // Core
  { matches: ['crunch', 'sit up', 'situp', 'plank', 'ab wheel', 'cable crunch', 'leg raise', 'hollow hold', 'v up', 'mountain climber', 'russian twist', 'bicycle'], parts: ['ABS'] },
  { matches: ['russian twist', 'side bend', 'side plank', 'wood chop', 'pallof', 'oblique'], parts: ['OBLIQUE_L', 'OBLIQUE_R', 'ABS'] },
  { matches: ['abductor', 'fire hydrant', 'clamshell', 'banded walk', 'sumo walk'], parts: ['ABDUCTOR_L', 'ABDUCTOR_R'] },
  { matches: ['adductor', 'copenhagen', 'inner thigh'], parts: ['ADDUCTOR_L', 'ADDUCTOR_R'] },

  // Cardio / full-body
  { matches: ['run', 'jog', 'sprint', 'treadmill', '5k', '10k', 'half marathon', 'marathon'], parts: ['QUAD_L', 'QUAD_R', 'HAMSTRING_L', 'HAMSTRING_R', 'CALF_L', 'CALF_R'] },
  { matches: ['bike', 'cycling', 'spinning', 'peloton'], parts: ['QUAD_L', 'QUAD_R', 'HAMSTRING_L', 'HAMSTRING_R', 'CALF_L', 'CALF_R', 'ABDUCTOR_L', 'ABDUCTOR_R'] },
  { matches: ['swim', 'swimming', 'freestyle', 'backstroke', 'breaststroke'], parts: ['PECTORAL', 'LAT_L', 'LAT_R', 'SHOULDER_L', 'SHOULDER_R', 'TRICEP_L', 'TRICEP_R'] },
  { matches: ['row machine', 'erg', 'rowing'], parts: ['LAT_L', 'LAT_R', 'QUAD_L', 'QUAD_R', 'HAMSTRING_L', 'HAMSTRING_R', 'BICEP_L', 'BICEP_R'] },
];

/**
 * Given an exercise name, return the body parts it primarily works.
 * Falls back to empty array if no rule matches — user can manually
 * tag in that case.
 */
export function musclesForExercise(name: string): BodyPartId[] {
  const lower = name.toLowerCase().trim();
  if (!lower) return [];

  const parts = new Set<BodyPartId>();
  for (const rule of RULES) {
    if (rule.matches.some((m) => lower.includes(m))) {
      for (const p of rule.parts) parts.add(p);
    }
  }
  return [...parts];
}

/**
 * Group muscles by body region for nicer UI display.
 */
export function groupMusclesByRegion(muscles: BodyPartId[]): {
  chest: BodyPartId[];
  back: BodyPartId[];
  arms: BodyPartId[];
  legs: BodyPartId[];
  core: BodyPartId[];
  other: BodyPartId[];
} {
  const groups = { chest: [], back: [], arms: [], legs: [], core: [], other: [] } as Record<string, BodyPartId[]>;
  for (const m of muscles) {
    const l = m.toLowerCase();
    if (l.includes('pect') || l.includes('chest')) groups.chest.push(m);
    else if (l.includes('lat') || l.includes('back') || l.includes('trap')) groups.back.push(m);
    else if (l.includes('bicep') || l.includes('tricep') || l.includes('forearm') || l.includes('wrist') || l.includes('shoulder') || l.includes('rotator')) groups.arms.push(m);
    else if (l.includes('quad') || l.includes('hamstring') || l.includes('glute') || l.includes('calf') || l.includes('knee') || l.includes('ankle') || l.includes('foot') || l.includes('hip') || l.includes('adductor') || l.includes('abductor')) groups.legs.push(m);
    else if (l.includes('abs') || l.includes('oblique')) groups.core.push(m);
    else groups.other.push(m);
  }
  return groups as any;
}