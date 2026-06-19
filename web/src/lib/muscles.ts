// Static lookup: exercise name → body parts (with priority).
//
// The exercise library isn't exhaustive — new exercises may not
// match any rule. In that case the user can either pick a
// different name from the suggestions, or the exercise just
// shows up in STATUS without a muscle annotation.
//
// Rules use simple substring matching. Order matters — the first
// rule to match wins for the *primary* set; secondary rules add
// to the muscle list.

import type { BodyPartId } from '@/components/BodyModel';

// Priority: higher = more "this exercise is mainly about this muscle".
// Most rules use 100 for the primary muscle(s), 50 for synergists,
// 25 for stabilizers. Used to weight the volume / recovery calc.
export type MuscleHit = {
  part: BodyPartId;
  priority: number;  // 0-100
};

export type ExerciseMuscles = {
  // The exercise name patterns this matches
  matches: string[];
  // Primary movers
  primary: MuscleHit[];
  // Secondary / synergist muscles
  secondary?: MuscleHit[];
  // Stabilizers (small contribution)
  stabilizers?: MuscleHit[];
};

// Bigger database. ~70 common exercises across strength,
// calisthenics, and cardio. Numbers reflect typical hypertrophy
// training; strength ratios may differ slightly. These are not
// scientific measurements — they're rough guides.
const EXERCISE_DB: ExerciseMuscles[] = [
  // ───────── Chest ─────────
  { matches: ['bench press', 'barbell bench', 'flat bench'],
    primary: [{ part: 'PECTORAL', priority: 100 }],
    secondary: [{ part: 'TRICEP_L', priority: 60 }, { part: 'TRICEP_R', priority: 60 }, { part: 'SHOULDER_L', priority: 50 }, { part: 'SHOULDER_R', priority: 50 }],
    stabilizers: [{ part: 'ROTATOR_CUFF_L', priority: 20 }, { part: 'ROTATOR_CUFF_R', priority: 20 }] },
  { matches: ['incline bench', 'incline press', 'incline dumbbell'],
    primary: [{ part: 'PECTORAL', priority: 100 }],
    secondary: [{ part: 'SHOULDER_L', priority: 70 }, { part: 'SHOULDER_R', priority: 70 }, { part: 'TRICEP_L', priority: 50 }, { part: 'TRICEP_R', priority: 50 }] },
  { matches: ['decline bench', 'decline press'],
    primary: [{ part: 'PECTORAL', priority: 100 }],
    secondary: [{ part: 'TRICEP_L', priority: 60 }, { part: 'TRICEP_R', priority: 60 }] },
  { matches: ['dumbbell fly', 'cable fly', 'chest fly', 'pec deck', 'butterfly machine'],
    primary: [{ part: 'PECTORAL', priority: 100 }],
    secondary: [{ part: 'SHOULDER_L', priority: 30 }, { part: 'SHOULDER_R', priority: 30 }] },
  { matches: ['push up', 'pushup', 'push-up'],
    primary: [{ part: 'PECTORAL', priority: 80 }, { part: 'TRICEP_L', priority: 60 }, { part: 'TRICEP_R', priority: 60 }],
    secondary: [{ part: 'SHOULDER_L', priority: 50 }, { part: 'SHOULDER_R', priority: 50 }, { part: 'ABS', priority: 50 }],
    stabilizers: [{ part: 'OBLIQUE_L', priority: 25 }, { part: 'OBLIQUE_R', priority: 25 }] },
  { matches: ['dip', 'parallel bar dip', 'chest dip'],
    primary: [{ part: 'PECTORAL', priority: 80 }, { part: 'TRICEP_L', priority: 80 }, { part: 'TRICEP_R', priority: 80 }],
    secondary: [{ part: 'SHOULDER_L', priority: 50 }, { part: 'SHOULDER_R', priority: 50 }] },
  { matches: ['diamond push', 'close-grip push'],
    primary: [{ part: 'TRICEP_L', priority: 80 }, { part: 'TRICEP_R', priority: 80 }, { part: 'PECTORAL', priority: 70 }],
    secondary: [{ part: 'SHOULDER_L', priority: 40 }, { part: 'SHOULDER_R', priority: 40 }] },

  // ───────── Back ─────────
  { matches: ['deadlift', 'conventional deadlift', 'sumo deadlift', 'trap bar deadlift'],
    primary: [{ part: 'BACK_LOWER', priority: 100 }, { part: 'HAMSTRING_L', priority: 80 }, { part: 'HAMSTRING_R', priority: 80 }, { part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }, { part: 'TRAPS', priority: 80 }],
    secondary: [{ part: 'LAT_L', priority: 60 }, { part: 'LAT_R', priority: 60 }, { part: 'FOREARM_L', priority: 50 }, { part: 'FOREARM_R', priority: 50 }] },
  { matches: ['romanian deadlift', 'rdl', 'stiff leg deadlift', 'stiff-leg deadlift'],
    primary: [{ part: 'HAMSTRING_L', priority: 100 }, { part: 'HAMSTRING_R', priority: 100 }, { part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }],
    secondary: [{ part: 'BACK_LOWER', priority: 70 }, { part: 'TRAPS', priority: 40 }],
    stabilizers: [{ part: 'FOREARM_L', priority: 30 }, { part: 'FOREARM_R', priority: 30 }] },
  { matches: ['pull up', 'pullup', 'pull-up', 'chin up', 'chinup', 'chin-up'],
    primary: [{ part: 'LAT_L', priority: 100 }, { part: 'LAT_R', priority: 100 }, { part: 'BICEP_L', priority: 70 }, { part: 'BICEP_R', priority: 70 }],
    secondary: [{ part: 'TRAPS', priority: 60 }, { part: 'BACK_UPPER', priority: 50 }],
    stabilizers: [{ part: 'FOREARM_L', priority: 30 }, { part: 'FOREARM_R', priority: 30 }, { part: 'ROTATOR_CUFF_L', priority: 20 }, { part: 'ROTATOR_CUFF_R', priority: 20 }] },
  { matches: ['lat pulldown', 'pulldown', 'pull down'],
    primary: [{ part: 'LAT_L', priority: 100 }, { part: 'LAT_R', priority: 100 }],
    secondary: [{ part: 'BICEP_L', priority: 70 }, { part: 'BICEP_R', priority: 70 }, { part: 'TRAPS', priority: 50 }, { part: 'BACK_UPPER', priority: 40 }] },
  { matches: ['barbell row', 'pendlay row', 'bent-over row', 't-bar row', 't bar row', 'seated row', 'cable row', 'dumbbell row'],
    primary: [{ part: 'LAT_L', priority: 90 }, { part: 'LAT_R', priority: 90 }, { part: 'TRAPS', priority: 70 }, { part: 'BACK_UPPER', priority: 80 }],
    secondary: [{ part: 'BICEP_L', priority: 60 }, { part: 'BICEP_R', priority: 60 }, { part: 'BACK_LOWER', priority: 40 }] },
  { matches: ['seal row', 'chest supported row', 'meadows row'],
    primary: [{ part: 'LAT_L', priority: 90 }, { part: 'LAT_R', priority: 90 }, { part: 'TRAPS', priority: 80 }],
    secondary: [{ part: 'BICEP_L', priority: 60 }, { part: 'BICEP_R', priority: 60 }] },
  { matches: ['face pull', 'rear delt fly', 'reverse fly'],
    primary: [{ part: 'ROTATOR_CUFF_L', priority: 80 }, { part: 'ROTATOR_CUFF_R', priority: 80 }, { part: 'TRAPS', priority: 60 }],
    secondary: [{ part: 'SHOULDER_L', priority: 40 }, { part: 'SHOULDER_R', priority: 40 }, { part: 'BACK_UPPER', priority: 40 }] },
  { matches: ['shrug', 'trap shrug', 'barbell shrug'],
    primary: [{ part: 'TRAPS', priority: 100 }],
    secondary: [{ part: 'NECK', priority: 30 }] },
  { matches: ['good morning'],
    primary: [{ part: 'HAMSTRING_L', priority: 90 }, { part: 'HAMSTRING_R', priority: 90 }, { part: 'BACK_LOWER', priority: 90 }],
    secondary: [{ part: 'GLUTE_L', priority: 60 }, { part: 'GLUTE_R', priority: 60 }] },

  // ───────── Shoulders ─────────
  { matches: ['overhead press', 'ohp', 'military press', 'standing press', 'shoulder press'],
    primary: [{ part: 'SHOULDER_L', priority: 100 }, { part: 'SHOULDER_R', priority: 100 }],
    secondary: [{ part: 'TRICEP_L', priority: 70 }, { part: 'TRICEP_R', priority: 70 }, { part: 'TRAPS', priority: 50 }] },
  { matches: ['seated press', 'smith press'],
    primary: [{ part: 'SHOULDER_L', priority: 100 }, { part: 'SHOULDER_R', priority: 100 }],
    secondary: [{ part: 'TRICEP_L', priority: 70 }, { part: 'TRICEP_R', priority: 70 }] },
  { matches: ['lateral raise', 'side raise', 'lat raise'],
    primary: [{ part: 'SHOULDER_L', priority: 100 }, { part: 'SHOULDER_R', priority: 100 }],
    secondary: [{ part: 'ROTATOR_CUFF_L', priority: 30 }, { part: 'ROTATOR_CUFF_R', priority: 30 }] },
  { matches: ['front raise'],
    primary: [{ part: 'SHOULDER_L', priority: 90 }, { part: 'SHOULDER_R', priority: 90 }],
    secondary: [{ part: 'PECTORAL', priority: 30 }] },
  { matches: ['upright row'],
    primary: [{ part: 'TRAPS', priority: 90 }, { part: 'SHOULDER_L', priority: 80 }, { part: 'SHOULDER_R', priority: 80 }],
    secondary: [{ part: 'BICEP_L', priority: 40 }, { part: 'BICEP_R', priority: 40 }] },
  { matches: ['arnold press'],
    primary: [{ part: 'SHOULDER_L', priority: 100 }, { part: 'SHOULDER_R', priority: 100 }],
    secondary: [{ part: 'TRICEP_L', priority: 60 }, { part: 'TRICEP_R', priority: 60 }] },

  // ───────── Arms — biceps ─────────
  { matches: ['barbell curl', 'bicep curl', 'biceps curl', 'dumbbell curl', 'hammer curl', 'preacher curl', 'concentration curl', 'ez bar curl', 'cable curl', 'incline curl', 'spider curl'],
    primary: [{ part: 'BICEP_L', priority: 100 }, { part: 'BICEP_R', priority: 100 }],
    secondary: [{ part: 'FOREARM_L', priority: 50 }, { part: 'FOREARM_R', priority: 50 }] },

  // ───────── Arms — triceps ─────────
  { matches: ['tricep', 'triceps', 'skull crusher', 'skullcrusher', 'pushdown', 'push down', 'cable pushdown', 'tricep kickback', 'tricep extension', 'overhead extension', 'lying tricep'],
    primary: [{ part: 'TRICEP_L', priority: 100 }, { part: 'TRICEP_R', priority: 100 }],
    secondary: [{ part: 'SHOULDER_L', priority: 20 }, { part: 'SHOULDER_R', priority: 20 }] },
  { matches: ['close grip bench', 'close-grip bench', 'cgbp'],
    primary: [{ part: 'TRICEP_L', priority: 90 }, { part: 'TRICEP_R', priority: 90 }, { part: 'PECTORAL', priority: 70 }],
    secondary: [{ part: 'SHOULDER_L', priority: 40 }, { part: 'SHOULDER_R', priority: 40 }] },

  // ───────── Forearms ─────────
  { matches: ['wrist curl', 'reverse wrist curl', 'forearm curl', 'grip', 'farmer carry', 'farmer walk'],
    primary: [{ part: 'FOREARM_L', priority: 90 }, { part: 'FOREARM_R', priority: 90 }],
    secondary: [{ part: 'WRIST_L', priority: 50 }, { part: 'WRIST_R', priority: 50 }] },

  // ───────── Legs ─────────
  { matches: ['back squat', 'barbell squat', 'high bar squat', 'low bar squat', 'squat'],
    primary: [{ part: 'QUAD_L', priority: 100 }, { part: 'QUAD_R', priority: 100 }, { part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }],
    secondary: [{ part: 'HAMSTRING_L', priority: 60 }, { part: 'HAMSTRING_R', priority: 60 }, { part: 'ADDUCTOR_L', priority: 50 }, { part: 'ADDUCTOR_R', priority: 50 }, { part: 'BACK_LOWER', priority: 70 }],
    stabilizers: [{ part: 'ABS', priority: 40 }] },
  { matches: ['front squat'],
    primary: [{ part: 'QUAD_L', priority: 100 }, { part: 'QUAD_R', priority: 100 }],
    secondary: [{ part: 'GLUTE_L', priority: 70 }, { part: 'GLUTE_R', priority: 70 }, { part: 'ABS', priority: 50 }, { part: 'BACK_UPPER', priority: 50 }] },
  { matches: ['goblet squat'],
    primary: [{ part: 'QUAD_L', priority: 100 }, { part: 'QUAD_R', priority: 100 }],
    secondary: [{ part: 'GLUTE_L', priority: 70 }, { part: 'GLUTE_R', priority: 70 }, { part: 'ABS', priority: 50 }] },
  { matches: ['leg press'],
    primary: [{ part: 'QUAD_L', priority: 100 }, { part: 'QUAD_R', priority: 100 }, { part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }],
    secondary: [{ part: 'HAMSTRING_L', priority: 40 }, { part: 'HAMSTRING_R', priority: 40 }] },
  { matches: ['leg extension'],
    primary: [{ part: 'QUAD_L', priority: 100 }, { part: 'QUAD_R', priority: 100 }] },
  { matches: ['hack squat'],
    primary: [{ part: 'QUAD_L', priority: 100 }, { part: 'QUAD_R', priority: 100 }, { part: 'GLUTE_L', priority: 70 }, { part: 'GLUTE_R', priority: 70 }] },
  { matches: ['bulgarian split squat', 'rear foot elevated', 'rfess'],
    primary: [{ part: 'QUAD_L', priority: 90 }, { part: 'QUAD_R', priority: 90 }],
    secondary: [{ part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }, { part: 'ADDUCTOR_L', priority: 40 }, { part: 'ADDUCTOR_R', priority: 40 }] },
  { matches: ['lunge', 'walking lunge', 'reverse lunge', 'split squat', 'step up', 'stepup'],
    primary: [{ part: 'QUAD_L', priority: 90 }, { part: 'QUAD_R', priority: 90 }, { part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }] },
  { matches: ['leg curl', 'lying leg curl', 'seated leg curl', 'nordic curl'],
    primary: [{ part: 'HAMSTRING_L', priority: 100 }, { part: 'HAMSTRING_R', priority: 100 }],
    secondary: [{ part: 'GLUTE_L', priority: 30 }, { part: 'GLUTE_R', priority: 30 }] },
  { matches: ['hip thrust', 'glute bridge', 'barbell hip thrust'],
    primary: [{ part: 'GLUTE_L', priority: 100 }, { part: 'GLUTE_R', priority: 100 }, { part: 'HAMSTRING_L', priority: 50 }, { part: 'HAMSTRING_R', priority: 50 }] },
  { matches: ['cable kickback', 'glute kickback'],
    primary: [{ part: 'GLUTE_L', priority: 100 }, { part: 'GLUTE_R', priority: 100 }] },
  { matches: ['calf raise', 'standing calf', 'seated calf', 'calf press', 'donkey calf'],
    primary: [{ part: 'CALF_L', priority: 100 }, { part: 'CALF_R', priority: 100 }] },
  { matches: ['abductor machine', 'fire hydrant', 'clamshell', 'banded walk'],
    primary: [{ part: 'ABDUCTOR_L', priority: 100 }, { part: 'ABDUCTOR_R', priority: 100 }] },
  { matches: ['adductor machine', 'copenhagen', 'inner thigh', 'couch stretch'],
    primary: [{ part: 'ADDUCTOR_L', priority: 100 }, { part: 'ADDUCTOR_R', priority: 100 }] },

  // ───────── Core ─────────
  { matches: ['crunch', 'sit up', 'situp', 'sit-up', 'cable crunch'],
    primary: [{ part: 'ABS', priority: 100 }] },
  { matches: ['plank', 'hollow hold', 'hollow body', 'v up', 'v-up'],
    primary: [{ part: 'ABS', priority: 100 }],
    secondary: [{ part: 'OBLIQUE_L', priority: 30 }, { part: 'OBLIQUE_R', priority: 30 }] },
  { matches: ['russian twist', 'wood chop', 'side bend', 'side plank'],
    primary: [{ part: 'OBLIQUE_L', priority: 100 }, { part: 'OBLIQUE_R', priority: 100 }],
    secondary: [{ part: 'ABS', priority: 50 }] },
  { matches: ['leg raise', 'hanging leg raise', 'captain chair', 'reverse crunch'],
    primary: [{ part: 'ABS', priority: 100 }],
    secondary: [{ part: 'HIP_L', priority: 30 }, { part: 'HIP_R', priority: 30 }] },
  { matches: ['ab wheel', 'ab rollout'],
    primary: [{ part: 'ABS', priority: 100 }, { part: 'BACK_LOWER', priority: 60 }],
    secondary: [{ part: 'OBLIQUE_L', priority: 40 }, { part: 'OBLIQUE_R', priority: 40 }] },
  { matches: ['bicycle crunch', 'mountain climber'],
    primary: [{ part: 'ABS', priority: 90 }, { part: 'OBLIQUE_L', priority: 70 }, { part: 'OBLIQUE_R', priority: 70 }],
    secondary: [{ part: 'HIP_L', priority: 40 }, { part: 'HIP_R', priority: 40 }] },
  { matches: ['pallof press', 'pallof'],
    primary: [{ part: 'OBLIQUE_L', priority: 100 }, { part: 'OBLIQUE_R', priority: 100 }],
    secondary: [{ part: 'ABS', priority: 50 }] },
  { matches: ['dead bug'],
    primary: [{ part: 'ABS', priority: 100 }],
    secondary: [{ part: 'BACK_LOWER', priority: 50 }] },

  // ───────── Cardio ─────────
  { matches: ['run', 'jog', 'sprint', 'treadmill', '5k', '10k', 'half marathon', 'marathon'],
    primary: [{ part: 'QUAD_L', priority: 70 }, { part: 'QUAD_R', priority: 70 }, { part: 'HAMSTRING_L', priority: 50 }, { part: 'HAMSTRING_R', priority: 50 }, { part: 'CALF_L', priority: 70 }, { part: 'CALF_R', priority: 70 }],
    secondary: [{ part: 'GLUTE_L', priority: 50 }, { part: 'GLUTE_R', priority: 50 }] },
  { matches: ['bike', 'cycling', 'spinning', 'peloton'],
    primary: [{ part: 'QUAD_L', priority: 70 }, { part: 'QUAD_R', priority: 70 }],
    secondary: [{ part: 'HAMSTRING_L', priority: 50 }, { part: 'HAMSTRING_R', priority: 50 }, { part: 'CALF_L', priority: 50 }, { part: 'CALF_R', priority: 50 }, { part: 'ABDUCTOR_L', priority: 30 }, { part: 'ABDUCTOR_R', priority: 30 }] },
  { matches: ['swim', 'swimming', 'freestyle', 'backstroke', 'breaststroke', 'butterfly'],
    primary: [{ part: 'LAT_L', priority: 70 }, { part: 'LAT_R', priority: 70 }, { part: 'PECTORAL', priority: 70 }, { part: 'TRICEP_L', priority: 60 }, { part: 'TRICEP_R', priority: 60 }],
    secondary: [{ part: 'SHOULDER_L', priority: 60 }, { part: 'SHOULDER_R', priority: 60 }, { part: 'TRAPS', priority: 40 }] },
  { matches: ['row machine', 'erg', 'rowing', 'row erg'],
    primary: [{ part: 'LAT_L', priority: 80 }, { part: 'LAT_R', priority: 80 }, { part: 'QUAD_L', priority: 60 }, { part: 'QUAD_R', priority: 60 }],
    secondary: [{ part: 'HAMSTRING_L', priority: 50 }, { part: 'HAMSTRING_R', priority: 50 }, { part: 'BICEP_L', priority: 60 }, { part: 'BICEP_R', priority: 60 }, { part: 'BACK_LOWER', priority: 50 }] },
  { matches: ['stair climber', 'stairmaster', 'step mill'],
    primary: [{ part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }, { part: 'QUAD_L', priority: 70 }, { part: 'QUAD_R', priority: 70 }],
    secondary: [{ part: 'CALF_L', priority: 60 }, { part: 'CALF_R', priority: 60 }] },
  { matches: ['jump rope', 'skipping'],
    primary: [{ part: 'CALF_L', priority: 80 }, { part: 'CALF_R', priority: 80 }],
    secondary: [{ part: 'SHOULDER_L', priority: 50 }, { part: 'SHOULDER_R', priority: 50 }, { part: 'CALF_L', priority: 50 }, { part: 'CALF_R', priority: 50 }] },
];

// Flat lookup. Returns the FIRST matching rule.
function lookupRule(name: string): ExerciseMuscles | undefined {
  const lower = name.toLowerCase().trim();
  if (!lower) return undefined;
  return EXERCISE_DB.find((rule) =>
    rule.matches.some((m) => lower.includes(m)),
  );
}

/**
 * Get the body parts hit by an exercise, with priorities.
 * Returns primary + secondary + stabilizers flattened.
 */
export function musclesForExerciseDetailed(name: string): MuscleHit[] {
  const rule = lookupRule(name);
  if (!rule) return [];
  return [
    ...rule.primary,
    ...(rule.secondary ?? []),
    ...(rule.stabilizers ?? []),
  ];
}

/**
 * Get just the body part IDs that an exercise works.
 * Used by the API to populate Exercise.musclesWorked.
 */
export function musclesForExercise(name: string): BodyPartId[] {
  const hits = musclesForExerciseDetailed(name);
  // De-dup parts (a muscle could be primary + secondary across
  // different rules, but in our DB each rule puts it in one place).
  return [...new Set(hits.map((h) => h.part))];
}

/**
 * Group exercises by region for UI display.
 */
export function groupExercisesByRegion(muscles: BodyPartId[]): {
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

/**
 * Get all exercise names that match this pattern (used for
 * suggestions in the workout input).
 */
export function suggestExercises(partial: string, limit = 8): string[] {
  if (!partial || partial.length < 2) return [];
  const lower = partial.toLowerCase();
  const suggestions = new Set<string>();
  for (const rule of EXERCISE_DB) {
    for (const m of rule.matches) {
      if (m.includes(lower)) {
        // Use the longest matching key as the display name
        suggestions.add(m);
        if (suggestions.size >= limit) break;
      }
    }
    if (suggestions.size >= limit) break;
  }
  return [...suggestions].slice(0, limit);
}

export const TOTAL_EXERCISES = EXERCISE_DB.length;