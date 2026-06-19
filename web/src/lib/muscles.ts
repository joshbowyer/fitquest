// Static lookup: exercise name → body parts (with priority).
//
// The exercise library isn't exhaustive — new exercises may not
// match any rule. In that case the user can either pick a
// different name from the suggestions, or the exercise just
// shows up in STATUS without a muscle annotation.
//
// Rules use simple substring matching. Each rule has:
//  - matches: substring patterns that trigger this rule
//  - primary / secondary / stabilizers: body parts hit, with
//    priority 0-100
//  - load: how the exercise is loaded (BODYWEIGHT, WEIGHTED_BW,
//    FREE_WEIGHT, MACHINE, CARDIO)
//  - displayName: the canonical form shown in autocomplete

import type { BodyPartId } from '@/components/BodyModel';

export type MuscleHit = {
  part: BodyPartId;
  priority: number;  // 0-100
};

export type ExerciseLoad =
  | 'BODYWEIGHT'
  | 'WEIGHTED_BODYWEIGHT'
  | 'FREE_WEIGHT'
  | 'MACHINE'
  | 'CARDIO'
  | 'OTHER';

export type ExerciseMuscles = {
  matches: string[];
  primary: MuscleHit[];
  secondary?: MuscleHit[];
  stabilizers?: MuscleHit[];
  load: ExerciseLoad;
  displayName: string;
  group: 'chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core' | 'cardio';
};

const EXERCISE_DB: ExerciseMuscles[] = [
  // ───────── Bodyweight chest / push ─────────
  { matches: ['push up', 'pushup', 'push-up'],
    primary: [{ part: 'PECTORAL', priority: 80 }, { part: 'TRICEP_L', priority: 60 }, { part: 'TRICEP_R', priority: 60 }],
    secondary: [{ part: 'SHOULDER_L', priority: 50 }, { part: 'SHOULDER_R', priority: 50 }, { part: 'ABS', priority: 50 }],
    stabilizers: [{ part: 'OBLIQUE_L', priority: 25 }, { part: 'OBLIQUE_R', priority: 25 }],
    load: 'BODYWEIGHT', displayName: 'Push-Up', group: 'chest' },
  { matches: ['weighted push', 'push up weighted', 'weighted pushup'],
    primary: [{ part: 'PECTORAL', priority: 90 }, { part: 'TRICEP_L', priority: 70 }, { part: 'TRICEP_R', priority: 70 }],
    secondary: [{ part: 'SHOULDER_L', priority: 60 }, { part: 'SHOULDER_R', priority: 60 }, { part: 'ABS', priority: 60 }],
    load: 'WEIGHTED_BODYWEIGHT', displayName: 'Weighted Push-Up', group: 'chest' },
  { matches: ['diamond push', 'close-grip push'],
    primary: [{ part: 'TRICEP_L', priority: 80 }, { part: 'TRICEP_R', priority: 80 }, { part: 'PECTORAL', priority: 70 }],
    secondary: [{ part: 'SHOULDER_L', priority: 40 }, { part: 'SHOULDER_R', priority: 40 }],
    load: 'BODYWEIGHT', displayName: 'Diamond Push-Up', group: 'chest' },
  { matches: ['decline push', 'feet-elevated push'],
    primary: [{ part: 'PECTORAL', priority: 90 }, { part: 'TRICEP_L', priority: 60 }, { part: 'TRICEP_R', priority: 60 }],
    secondary: [{ part: 'SHOULDER_L', priority: 50 }, { part: 'SHOULDER_R', priority: 50 }],
    load: 'BODYWEIGHT', displayName: 'Decline Push-Up', group: 'chest' },
  { matches: ['decline pushup weighted'],
    primary: [{ part: 'PECTORAL', priority: 100 }, { part: 'TRICEP_L', priority: 70 }, { part: 'TRICEP_R', priority: 70 }],
    secondary: [{ part: 'SHOULDER_L', priority: 60 }, { part: 'SHOULDER_R', priority: 60 }],
    load: 'WEIGHTED_BODYWEIGHT', displayName: 'Weighted Decline Push-Up', group: 'chest' },

  // ───────── Chest — barbell / dumbbell / cable ─────────
  { matches: ['bench press', 'barbell bench', 'flat bench'],
    primary: [{ part: 'PECTORAL', priority: 100 }],
    secondary: [{ part: 'TRICEP_L', priority: 60 }, { part: 'TRICEP_R', priority: 60 }, { part: 'SHOULDER_L', priority: 50 }, { part: 'SHOULDER_R', priority: 50 }],
    stabilizers: [{ part: 'ROTATOR_CUFF_L', priority: 20 }, { part: 'ROTATOR_CUFF_R', priority: 20 }],
    load: 'FREE_WEIGHT', displayName: 'Bench Press', group: 'chest' },
  { matches: ['incline bench', 'incline press', 'incline dumbbell'],
    primary: [{ part: 'PECTORAL', priority: 100 }],
    secondary: [{ part: 'SHOULDER_L', priority: 70 }, { part: 'SHOULDER_R', priority: 70 }, { part: 'TRICEP_L', priority: 50 }, { part: 'TRICEP_R', priority: 50 }],
    load: 'FREE_WEIGHT', displayName: 'Incline Bench Press', group: 'chest' },
  { matches: ['decline bench', 'decline press'],
    primary: [{ part: 'PECTORAL', priority: 100 }],
    secondary: [{ part: 'TRICEP_L', priority: 60 }, { part: 'TRICEP_R', priority: 60 }],
    load: 'FREE_WEIGHT', displayName: 'Decline Bench Press', group: 'chest' },
  { matches: ['dumbbell fly', 'cable fly', 'chest fly', 'pec deck', 'butterfly machine', 'machine fly'],
    primary: [{ part: 'PECTORAL', priority: 100 }],
    secondary: [{ part: 'SHOULDER_L', priority: 30 }, { part: 'SHOULDER_R', priority: 30 }],
    load: 'MACHINE', displayName: 'Chest Fly', group: 'chest' },

  // ───────── Triceps — bodyweight + weighted ─────────
  { matches: ['dip', 'parallel bar dip', 'chest dip', 'bar dip'],
    primary: [{ part: 'PECTORAL', priority: 80 }, { part: 'TRICEP_L', priority: 80 }, { part: 'TRICEP_R', priority: 80 }],
    secondary: [{ part: 'SHOULDER_L', priority: 50 }, { part: 'SHOULDER_R', priority: 50 }],
    load: 'BODYWEIGHT', displayName: 'Dip', group: 'chest' },
  { matches: ['weighted dip', 'dip weighted'],
    primary: [{ part: 'PECTORAL', priority: 90 }, { part: 'TRICEP_L', priority: 90 }, { part: 'TRICEP_R', priority: 90 }],
    secondary: [{ part: 'SHOULDER_L', priority: 60 }, { part: 'SHOULDER_R', priority: 60 }],
    load: 'WEIGHTED_BODYWEIGHT', displayName: 'Weighted Dip', group: 'chest' },

  // ───────── Back — bodyweight pull-ups ─────────
  { matches: ['pull up', 'pullup', 'pull-up'],
    primary: [{ part: 'LAT_L', priority: 100 }, { part: 'LAT_R', priority: 100 }, { part: 'BICEP_L', priority: 70 }, { part: 'BICEP_R', priority: 70 }],
    secondary: [{ part: 'TRAPS', priority: 60 }, { part: 'BACK_UPPER', priority: 50 }],
    stabilizers: [{ part: 'FOREARM_L', priority: 30 }, { part: 'FOREARM_R', priority: 30 }, { part: 'ROTATOR_CUFF_L', priority: 20 }, { part: 'ROTATOR_CUFF_R', priority: 20 }],
    load: 'BODYWEIGHT', displayName: 'Pull-Up', group: 'back' },
  { matches: ['weighted pull', 'pull up weighted', 'weighted pullup'],
    primary: [{ part: 'LAT_L', priority: 100 }, { part: 'LAT_R', priority: 100 }, { part: 'BICEP_L', priority: 80 }, { part: 'BICEP_R', priority: 80 }],
    secondary: [{ part: 'TRAPS', priority: 70 }, { part: 'BACK_UPPER', priority: 60 }],
    load: 'WEIGHTED_BODYWEIGHT', displayName: 'Weighted Pull-Up', group: 'back' },
  { matches: ['chin up', 'chinup', 'chin-up'],
    primary: [{ part: 'LAT_L', priority: 100 }, { part: 'LAT_R', priority: 100 }, { part: 'BICEP_L', priority: 80 }, { part: 'BICEP_R', priority: 80 }],
    secondary: [{ part: 'TRAPS', priority: 60 }, { part: 'BACK_UPPER', priority: 50 }],
    stabilizers: [{ part: 'FOREARM_L', priority: 30 }, { part: 'FOREARM_R', priority: 30 }],
    load: 'BODYWEIGHT', displayName: 'Chin-Up', group: 'back' },
  { matches: ['weighted chin', 'chin up weighted', 'weighted chinup'],
    primary: [{ part: 'LAT_L', priority: 100 }, { part: 'LAT_R', priority: 100 }, { part: 'BICEP_L', priority: 90 }, { part: 'BICEP_R', priority: 90 }],
    secondary: [{ part: 'TRAPS', priority: 70 }, { part: 'BACK_UPPER', priority: 60 }],
    load: 'WEIGHTED_BODYWEIGHT', displayName: 'Weighted Chin-Up', group: 'back' },
  { matches: ['muscle up'],
    primary: [{ part: 'LAT_L', priority: 100 }, { part: 'LAT_R', priority: 100 }, { part: 'TRICEP_L', priority: 80 }, { part: 'TRICEP_R', priority: 80 }, { part: 'PECTORAL', priority: 70 }],
    secondary: [{ part: 'BICEP_L', priority: 60 }, { part: 'BICEP_R', priority: 60 }, { part: 'TRAPS', priority: 60 }],
    load: 'BODYWEIGHT', displayName: 'Muscle-Up', group: 'back' },
  { matches: ['weighted muscle', 'muscle up weighted'],
    primary: [{ part: 'LAT_L', priority: 100 }, { part: 'LAT_R', priority: 100 }, { part: 'TRICEP_L', priority: 90 }, { part: 'TRICEP_R', priority: 90 }, { part: 'PECTORAL', priority: 80 }],
    secondary: [{ part: 'BICEP_L', priority: 70 }, { part: 'BICEP_R', priority: 70 }, { part: 'TRAPS', priority: 70 }],
    load: 'WEIGHTED_BODYWEIGHT', displayName: 'Weighted Muscle-Up', group: 'back' },
  { matches: ['inverted row', 'bodyweight row', 'aussie pull', 'ring row'],
    primary: [{ part: 'LAT_L', priority: 80 }, { part: 'LAT_R', priority: 80 }, { part: 'TRAPS', priority: 70 }, { part: 'BACK_UPPER', priority: 70 }],
    secondary: [{ part: 'BICEP_L', priority: 50 }, { part: 'BICEP_R', priority: 50 }],
    load: 'BODYWEIGHT', displayName: 'Inverted Row', group: 'back' },
  { matches: ['pull up negative', 'pullup negative', 'eccentric pull'],
    primary: [{ part: 'LAT_L', priority: 100 }, { part: 'LAT_R', priority: 100 }, { part: 'BICEP_L', priority: 80 }, { part: 'BICEP_R', priority: 80 }],
    secondary: [{ part: 'TRAPS', priority: 60 }, { part: 'BACK_UPPER', priority: 50 }],
    load: 'BODYWEIGHT', displayName: 'Pull-Up Negative', group: 'back' },

  // ───────── Back — deadlift / row ─────────
  { matches: ['deadlift', 'conventional deadlift', 'sumo deadlift', 'trap bar deadlift'],
    primary: [{ part: 'BACK_LOWER', priority: 100 }, { part: 'HAMSTRING_L', priority: 80 }, { part: 'HAMSTRING_R', priority: 80 }, { part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }, { part: 'TRAPS', priority: 80 }],
    secondary: [{ part: 'LAT_L', priority: 60 }, { part: 'LAT_R', priority: 60 }, { part: 'FOREARM_L', priority: 50 }, { part: 'FOREARM_R', priority: 50 }],
    load: 'FREE_WEIGHT', displayName: 'Deadlift', group: 'back' },
  { matches: ['romanian deadlift', 'rdl', 'stiff leg deadlift', 'stiff-leg deadlift'],
    primary: [{ part: 'HAMSTRING_L', priority: 100 }, { part: 'HAMSTRING_R', priority: 100 }, { part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }],
    secondary: [{ part: 'BACK_LOWER', priority: 70 }, { part: 'TRAPS', priority: 40 }],
    stabilizers: [{ part: 'FOREARM_L', priority: 30 }, { part: 'FOREARM_R', priority: 30 }],
    load: 'FREE_WEIGHT', displayName: 'Romanian Deadlift', group: 'back' },
  { matches: ['lat pulldown', 'pulldown', 'pull down'],
    primary: [{ part: 'LAT_L', priority: 100 }, { part: 'LAT_R', priority: 100 }],
    secondary: [{ part: 'BICEP_L', priority: 70 }, { part: 'BICEP_R', priority: 70 }, { part: 'TRAPS', priority: 50 }, { part: 'BACK_UPPER', priority: 40 }],
    load: 'MACHINE', displayName: 'Lat Pulldown', group: 'back' },
  { matches: ['barbell row', 'pendlay row', 'bent-over row', 't-bar row', 't bar row', 'seated row', 'cable row', 'dumbbell row'],
    primary: [{ part: 'LAT_L', priority: 90 }, { part: 'LAT_R', priority: 90 }, { part: 'TRAPS', priority: 70 }, { part: 'BACK_UPPER', priority: 80 }],
    secondary: [{ part: 'BICEP_L', priority: 60 }, { part: 'BICEP_R', priority: 60 }, { part: 'BACK_LOWER', priority: 40 }],
    load: 'FREE_WEIGHT', displayName: 'Barbell Row', group: 'back' },
  { matches: ['seal row', 'chest supported row', 'meadows row'],
    primary: [{ part: 'LAT_L', priority: 90 }, { part: 'LAT_R', priority: 90 }, { part: 'TRAPS', priority: 80 }],
    secondary: [{ part: 'BICEP_L', priority: 60 }, { part: 'BICEP_R', priority: 60 }],
    load: 'FREE_WEIGHT', displayName: 'Seal Row', group: 'back' },
  { matches: ['face pull', 'rear delt fly', 'reverse fly'],
    primary: [{ part: 'ROTATOR_CUFF_L', priority: 80 }, { part: 'ROTATOR_CUFF_R', priority: 80 }, { part: 'TRAPS', priority: 60 }],
    secondary: [{ part: 'SHOULDER_L', priority: 40 }, { part: 'SHOULDER_R', priority: 40 }, { part: 'BACK_UPPER', priority: 40 }],
    load: 'FREE_WEIGHT', displayName: 'Face Pull', group: 'back' },
  { matches: ['shrug', 'trap shrug', 'barbell shrug'],
    primary: [{ part: 'TRAPS', priority: 100 }],
    secondary: [{ part: 'NECK', priority: 30 }],
    load: 'FREE_WEIGHT', displayName: 'Shrug', group: 'back' },
  { matches: ['good morning'],
    primary: [{ part: 'HAMSTRING_L', priority: 90 }, { part: 'HAMSTRING_R', priority: 90 }, { part: 'BACK_LOWER', priority: 90 }],
    secondary: [{ part: 'GLUTE_L', priority: 60 }, { part: 'GLUTE_R', priority: 60 }],
    load: 'FREE_WEIGHT', displayName: 'Good Morning', group: 'back' },

  // ───────── Shoulders ─────────
  { matches: ['overhead press', 'ohp', 'military press', 'standing press', 'shoulder press'],
    primary: [{ part: 'SHOULDER_L', priority: 100 }, { part: 'SHOULDER_R', priority: 100 }],
    secondary: [{ part: 'TRICEP_L', priority: 70 }, { part: 'TRICEP_R', priority: 70 }, { part: 'TRAPS', priority: 50 }],
    load: 'FREE_WEIGHT', displayName: 'Overhead Press', group: 'shoulders' },
  { matches: ['handstand push', 'hspu', 'wall walk', 'pike push'],
    primary: [{ part: 'SHOULDER_L', priority: 100 }, { part: 'SHOULDER_R', priority: 100 }, { part: 'TRICEP_L', priority: 70 }, { part: 'TRICEP_R', priority: 70 }],
    secondary: [{ part: 'TRAPS', priority: 60 }, { part: 'ABS', priority: 30 }],
    load: 'BODYWEIGHT', displayName: 'Handstand Push-Up', group: 'shoulders' },
  { matches: ['weighted handstand', 'hspu weighted'],
    primary: [{ part: 'SHOULDER_L', priority: 100 }, { part: 'SHOULDER_R', priority: 100 }, { part: 'TRICEP_L', priority: 80 }, { part: 'TRICEP_R', priority: 80 }],
    secondary: [{ part: 'TRAPS', priority: 70 }, { part: 'ABS', priority: 40 }],
    load: 'WEIGHTED_BODYWEIGHT', displayName: 'Weighted Handstand Push-Up', group: 'shoulders' },
  { matches: ['seated press', 'smith press'],
    primary: [{ part: 'SHOULDER_L', priority: 100 }, { part: 'SHOULDER_R', priority: 100 }],
    secondary: [{ part: 'TRICEP_L', priority: 70 }, { part: 'TRICEP_R', priority: 70 }],
    load: 'MACHINE', displayName: 'Seated Shoulder Press', group: 'shoulders' },
  { matches: ['lateral raise', 'side raise', 'lat raise'],
    primary: [{ part: 'SHOULDER_L', priority: 100 }, { part: 'SHOULDER_R', priority: 100 }],
    secondary: [{ part: 'ROTATOR_CUFF_L', priority: 30 }, { part: 'ROTATOR_CUFF_R', priority: 30 }],
    load: 'FREE_WEIGHT', displayName: 'Lateral Raise', group: 'shoulders' },
  { matches: ['front raise'],
    primary: [{ part: 'SHOULDER_L', priority: 90 }, { part: 'SHOULDER_R', priority: 90 }],
    secondary: [{ part: 'PECTORAL', priority: 30 }],
    load: 'FREE_WEIGHT', displayName: 'Front Raise', group: 'shoulders' },
  { matches: ['upright row'],
    primary: [{ part: 'TRAPS', priority: 90 }, { part: 'SHOULDER_L', priority: 80 }, { part: 'SHOULDER_R', priority: 80 }],
    secondary: [{ part: 'BICEP_L', priority: 40 }, { part: 'BICEP_R', priority: 40 }],
    load: 'FREE_WEIGHT', displayName: 'Upright Row', group: 'shoulders' },
  { matches: ['arnold press'],
    primary: [{ part: 'SHOULDER_L', priority: 100 }, { part: 'SHOULDER_R', priority: 100 }],
    secondary: [{ part: 'TRICEP_L', priority: 60 }, { part: 'TRICEP_R', priority: 60 }],
    load: 'FREE_WEIGHT', displayName: 'Arnold Press', group: 'shoulders' },

  // ───────── Biceps ─────────
  { matches: ['barbell curl', 'bicep curl', 'biceps curl', 'dumbbell curl', 'hammer curl', 'preacher curl', 'concentration curl', 'ez bar curl', 'cable curl', 'incline curl', 'spider curl'],
    primary: [{ part: 'BICEP_L', priority: 100 }, { part: 'BICEP_R', priority: 100 }],
    secondary: [{ part: 'FOREARM_L', priority: 50 }, { part: 'FOREARM_R', priority: 50 }],
    load: 'FREE_WEIGHT', displayName: 'Bicep Curl', group: 'arms' },

  // ───────── Triceps (free weight) ─────────
  { matches: ['tricep', 'triceps', 'skull crusher', 'skullcrusher', 'pushdown', 'push down', 'cable pushdown', 'tricep kickback', 'tricep extension', 'overhead extension', 'lying tricep'],
    primary: [{ part: 'TRICEP_L', priority: 100 }, { part: 'TRICEP_R', priority: 100 }],
    secondary: [{ part: 'SHOULDER_L', priority: 20 }, { part: 'SHOULDER_R', priority: 20 }],
    load: 'FREE_WEIGHT', displayName: 'Tricep Extension', group: 'arms' },
  { matches: ['close grip bench', 'close-grip bench', 'cgbp'],
    primary: [{ part: 'TRICEP_L', priority: 90 }, { part: 'TRICEP_R', priority: 90 }, { part: 'PECTORAL', priority: 70 }],
    secondary: [{ part: 'SHOULDER_L', priority: 40 }, { part: 'SHOULDER_R', priority: 40 }],
    load: 'FREE_WEIGHT', displayName: 'Close-Grip Bench Press', group: 'arms' },

  // ───────── Forearms ─────────
  { matches: ['wrist curl', 'reverse wrist curl', 'forearm curl', 'grip', 'farmer carry', 'farmer walk'],
    primary: [{ part: 'FOREARM_L', priority: 90 }, { part: 'FOREARM_R', priority: 90 }],
    secondary: [{ part: 'WRIST_L', priority: 50 }, { part: 'WRIST_R', priority: 50 }],
    load: 'FREE_WEIGHT', displayName: 'Wrist Curl', group: 'arms' },

  // ───────── Legs — bodyweight ─────────
  { matches: ['bodyweight squat', 'air squat'],
    primary: [{ part: 'QUAD_L', priority: 90 }, { part: 'QUAD_R', priority: 90 }, { part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }],
    secondary: [{ part: 'HAMSTRING_L', priority: 40 }, { part: 'HAMSTRING_R', priority: 40 }, { part: 'ABS', priority: 30 }],
    load: 'BODYWEIGHT', displayName: 'Bodyweight Squat', group: 'legs' },
  { matches: ['sissy squat'],
    primary: [{ part: 'QUAD_L', priority: 100 }, { part: 'QUAD_R', priority: 100 }],
    secondary: [{ part: 'ABS', priority: 30 }],
    load: 'BODYWEIGHT', displayName: 'Sissy Squat', group: 'legs' },
  { matches: ['pistol squat', 'single leg squat'],
    primary: [{ part: 'QUAD_L', priority: 100 }, { part: 'QUAD_R', priority: 100 }, { part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }],
    secondary: [{ part: 'ABDUCTOR_L', priority: 40 }, { part: 'ABDUCTOR_R', priority: 40 }, { part: 'ABS', priority: 40 }],
    load: 'BODYWEIGHT', displayName: 'Pistol Squat', group: 'legs' },
  { matches: ['nordic curl', 'nordic hamstring'],
    primary: [{ part: 'HAMSTRING_L', priority: 100 }, { part: 'HAMSTRING_R', priority: 100 }],
    secondary: [{ part: 'GLUTE_L', priority: 30 }, { part: 'GLUTE_R', priority: 30 }],
    load: 'BODYWEIGHT', displayName: 'Nordic Curl', group: 'legs' },
  { matches: ['glute bridge', 'bodyweight hip thrust'],
    primary: [{ part: 'GLUTE_L', priority: 100 }, { part: 'GLUTE_R', priority: 100 }, { part: 'HAMSTRING_L', priority: 50 }, { part: 'HAMSTRING_R', priority: 50 }],
    load: 'BODYWEIGHT', displayName: 'Glute Bridge', group: 'legs' },
  { matches: ['single leg glute bridge'],
    primary: [{ part: 'GLUTE_L', priority: 100 }, { part: 'GLUTE_R', priority: 100 }],
    load: 'BODYWEIGHT', displayName: 'Single Leg Glute Bridge', group: 'legs' },

  // ───────── Legs — weighted ─────────
  { matches: ['back squat', 'barbell squat', 'high bar squat', 'low bar squat'],
    primary: [{ part: 'QUAD_L', priority: 100 }, { part: 'QUAD_R', priority: 100 }, { part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }],
    secondary: [{ part: 'HAMSTRING_L', priority: 60 }, { part: 'HAMSTRING_R', priority: 60 }, { part: 'ADDUCTOR_L', priority: 50 }, { part: 'ADDUCTOR_R', priority: 50 }, { part: 'BACK_LOWER', priority: 70 }],
    stabilizers: [{ part: 'ABS', priority: 40 }],
    load: 'FREE_WEIGHT', displayName: 'Back Squat', group: 'legs' },
  { matches: ['front squat'],
    primary: [{ part: 'QUAD_L', priority: 100 }, { part: 'QUAD_R', priority: 100 }],
    secondary: [{ part: 'GLUTE_L', priority: 70 }, { part: 'GLUTE_R', priority: 70 }, { part: 'ABS', priority: 50 }, { part: 'BACK_UPPER', priority: 50 }],
    load: 'FREE_WEIGHT', displayName: 'Front Squat', group: 'legs' },
  { matches: ['goblet squat'],
    primary: [{ part: 'QUAD_L', priority: 100 }, { part: 'QUAD_R', priority: 100 }],
    secondary: [{ part: 'GLUTE_L', priority: 70 }, { part: 'GLUTE_R', priority: 70 }, { part: 'ABS', priority: 50 }],
    load: 'FREE_WEIGHT', displayName: 'Goblet Squat', group: 'legs' },
  { matches: ['leg press'],
    primary: [{ part: 'QUAD_L', priority: 100 }, { part: 'QUAD_R', priority: 100 }, { part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }],
    secondary: [{ part: 'HAMSTRING_L', priority: 40 }, { part: 'HAMSTRING_R', priority: 40 }],
    load: 'MACHINE', displayName: 'Leg Press', group: 'legs' },
  { matches: ['leg extension'],
    primary: [{ part: 'QUAD_L', priority: 100 }, { part: 'QUAD_R', priority: 100 }],
    load: 'MACHINE', displayName: 'Leg Extension', group: 'legs' },
  { matches: ['hack squat'],
    primary: [{ part: 'QUAD_L', priority: 100 }, { part: 'QUAD_R', priority: 100 }, { part: 'GLUTE_L', priority: 70 }, { part: 'GLUTE_R', priority: 70 }],
    load: 'MACHINE', displayName: 'Hack Squat', group: 'legs' },
  { matches: ['bulgarian split squat', 'rear foot elevated', 'rfess'],
    primary: [{ part: 'QUAD_L', priority: 90 }, { part: 'QUAD_R', priority: 90 }],
    secondary: [{ part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }, { part: 'ADDUCTOR_L', priority: 40 }, { part: 'ADDUCTOR_R', priority: 40 }],
    load: 'FREE_WEIGHT', displayName: 'Bulgarian Split Squat', group: 'legs' },
  { matches: ['lunge', 'walking lunge', 'reverse lunge', 'split squat', 'step up', 'stepup'],
    primary: [{ part: 'QUAD_L', priority: 90 }, { part: 'QUAD_R', priority: 90 }, { part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }],
    load: 'BODYWEIGHT', displayName: 'Lunge', group: 'legs' },
  { matches: ['weighted lunge', 'walking lunge weighted', 'weighted step up'],
    primary: [{ part: 'QUAD_L', priority: 90 }, { part: 'QUAD_R', priority: 90 }, { part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }],
    load: 'WEIGHTED_BODYWEIGHT', displayName: 'Weighted Lunge', group: 'legs' },
  { matches: ['leg curl', 'lying leg curl', 'seated leg curl'],
    primary: [{ part: 'HAMSTRING_L', priority: 100 }, { part: 'HAMSTRING_R', priority: 100 }],
    secondary: [{ part: 'GLUTE_L', priority: 30 }, { part: 'GLUTE_R', priority: 30 }],
    load: 'MACHINE', displayName: 'Leg Curl', group: 'legs' },
  { matches: ['hip thrust', 'barbell hip thrust'],
    primary: [{ part: 'GLUTE_L', priority: 100 }, { part: 'GLUTE_R', priority: 100 }, { part: 'HAMSTRING_L', priority: 50 }, { part: 'HAMSTRING_R', priority: 50 }],
    load: 'FREE_WEIGHT', displayName: 'Hip Thrust', group: 'legs' },
  { matches: ['cable kickback', 'glute kickback'],
    primary: [{ part: 'GLUTE_L', priority: 100 }, { part: 'GLUTE_R', priority: 100 }],
    load: 'MACHINE', displayName: 'Glute Kickback', group: 'legs' },
  { matches: ['calf raise', 'standing calf', 'seated calf', 'calf press', 'donkey calf'],
    primary: [{ part: 'CALF_L', priority: 100 }, { part: 'CALF_R', priority: 100 }],
    load: 'MACHINE', displayName: 'Calf Raise', group: 'legs' },
  { matches: ['single leg calf raise'],
    primary: [{ part: 'CALF_L', priority: 100 }, { part: 'CALF_R', priority: 100 }],
    load: 'BODYWEIGHT', displayName: 'Single Leg Calf Raise', group: 'legs' },
  { matches: ['abductor machine', 'fire hydrant', 'clamshell', 'banded walk'],
    primary: [{ part: 'ABDUCTOR_L', priority: 100 }, { part: 'ABDUCTOR_R', priority: 100 }],
    load: 'BODYWEIGHT', displayName: 'Hip Abduction', group: 'legs' },
  { matches: ['adductor machine', 'copenhagen', 'inner thigh', 'couch stretch'],
    primary: [{ part: 'ADDUCTOR_L', priority: 100 }, { part: 'ADDUCTOR_R', priority: 100 }],
    load: 'BODYWEIGHT', displayName: 'Hip Adduction', group: 'legs' },

  // ───────── Core ─────────
  { matches: ['crunch', 'sit up', 'situp', 'sit-up', 'cable crunch'],
    primary: [{ part: 'ABS', priority: 100 }],
    load: 'BODYWEIGHT', displayName: 'Crunch', group: 'core' },
  { matches: ['plank', 'hollow hold', 'hollow body', 'v up', 'v-up'],
    primary: [{ part: 'ABS', priority: 100 }],
    secondary: [{ part: 'OBLIQUE_L', priority: 30 }, { part: 'OBLIQUE_R', priority: 30 }],
    load: 'BODYWEIGHT', displayName: 'Plank', group: 'core' },
  { matches: ['weighted plank'],
    primary: [{ part: 'ABS', priority: 100 }],
    secondary: [{ part: 'OBLIQUE_L', priority: 40 }, { part: 'OBLIQUE_R', priority: 40 }],
    load: 'WEIGHTED_BODYWEIGHT', displayName: 'Weighted Plank', group: 'core' },
  { matches: ['russian twist', 'wood chop', 'side bend', 'side plank'],
    primary: [{ part: 'OBLIQUE_L', priority: 100 }, { part: 'OBLIQUE_R', priority: 100 }],
    secondary: [{ part: 'ABS', priority: 50 }],
    load: 'BODYWEIGHT', displayName: 'Side Bend', group: 'core' },
  { matches: ['leg raise', 'hanging leg raise', 'captain chair', 'reverse crunch'],
    primary: [{ part: 'ABS', priority: 100 }],
    secondary: [{ part: 'HIP_L', priority: 30 }, { part: 'HIP_R', priority: 30 }],
    load: 'BODYWEIGHT', displayName: 'Leg Raise', group: 'core' },
  { matches: ['weighted leg raise'],
    primary: [{ part: 'ABS', priority: 100 }, { part: 'PECTORAL', priority: 50 }],
    load: 'WEIGHTED_BODYWEIGHT', displayName: 'Weighted Leg Raise', group: 'core' },
  { matches: ['ab wheel', 'ab rollout'],
    primary: [{ part: 'ABS', priority: 100 }, { part: 'BACK_LOWER', priority: 60 }],
    secondary: [{ part: 'OBLIQUE_L', priority: 40 }, { part: 'OBLIQUE_R', priority: 40 }],
    load: 'BODYWEIGHT', displayName: 'Ab Wheel', group: 'core' },
  { matches: ['bicycle crunch', 'mountain climber'],
    primary: [{ part: 'ABS', priority: 90 }, { part: 'OBLIQUE_L', priority: 70 }, { part: 'OBLIQUE_R', priority: 70 }],
    secondary: [{ part: 'HIP_L', priority: 40 }, { part: 'HIP_R', priority: 40 }],
    load: 'BODYWEIGHT', displayName: 'Bicycle Crunch', group: 'core' },
  { matches: ['pallof press', 'pallof'],
    primary: [{ part: 'OBLIQUE_L', priority: 100 }, { part: 'OBLIQUE_R', priority: 100 }],
    secondary: [{ part: 'ABS', priority: 50 }],
    load: 'MACHINE', displayName: 'Pallof Press', group: 'core' },
  { matches: ['dead bug'],
    primary: [{ part: 'ABS', priority: 100 }],
    secondary: [{ part: 'BACK_LOWER', priority: 50 }],
    load: 'BODYWEIGHT', displayName: 'Dead Bug', group: 'core' },
  { matches: ['hanging knee raise'],
    primary: [{ part: 'ABS', priority: 100 }],
    load: 'BODYWEIGHT', displayName: 'Hanging Knee Raise', group: 'core' },

  // ───────── Cardio ─────────
  { matches: ['run', 'jog', 'sprint', 'treadmill', '5k', '10k', 'half marathon', 'marathon'],
    primary: [{ part: 'QUAD_L', priority: 70 }, { part: 'QUAD_R', priority: 70 }, { part: 'HAMSTRING_L', priority: 50 }, { part: 'HAMSTRING_R', priority: 50 }, { part: 'CALF_L', priority: 70 }, { part: 'CALF_R', priority: 70 }],
    secondary: [{ part: 'GLUTE_L', priority: 50 }, { part: 'GLUTE_R', priority: 50 }],
    load: 'CARDIO', displayName: 'Run', group: 'cardio' },
  { matches: ['bike', 'cycling', 'spinning', 'peloton'],
    primary: [{ part: 'QUAD_L', priority: 70 }, { part: 'QUAD_R', priority: 70 }],
    secondary: [{ part: 'HAMSTRING_L', priority: 50 }, { part: 'HAMSTRING_R', priority: 50 }, { part: 'CALF_L', priority: 50 }, { part: 'CALF_R', priority: 50 }, { part: 'ABDUCTOR_L', priority: 30 }, { part: 'ABDUCTOR_R', priority: 30 }],
    load: 'CARDIO', displayName: 'Cycling', group: 'cardio' },
  { matches: ['swim', 'swimming', 'freestyle', 'backstroke', 'breaststroke', 'butterfly'],
    primary: [{ part: 'LAT_L', priority: 70 }, { part: 'LAT_R', priority: 70 }, { part: 'PECTORAL', priority: 70 }, { part: 'TRICEP_L', priority: 60 }, { part: 'TRICEP_R', priority: 60 }],
    secondary: [{ part: 'SHOULDER_L', priority: 60 }, { part: 'SHOULDER_R', priority: 60 }, { part: 'TRAPS', priority: 40 }],
    load: 'CARDIO', displayName: 'Swimming', group: 'cardio' },
  { matches: ['row machine', 'erg', 'rowing', 'row erg'],
    primary: [{ part: 'LAT_L', priority: 80 }, { part: 'LAT_R', priority: 80 }, { part: 'QUAD_L', priority: 60 }, { part: 'QUAD_R', priority: 60 }],
    secondary: [{ part: 'HAMSTRING_L', priority: 50 }, { part: 'HAMSTRING_R', priority: 50 }, { part: 'BICEP_L', priority: 60 }, { part: 'BICEP_R', priority: 60 }, { part: 'BACK_LOWER', priority: 50 }],
    load: 'CARDIO', displayName: 'Rowing', group: 'cardio' },
  { matches: ['stair climber', 'stairmaster', 'step mill'],
    primary: [{ part: 'GLUTE_L', priority: 80 }, { part: 'GLUTE_R', priority: 80 }, { part: 'QUAD_L', priority: 70 }, { part: 'QUAD_R', priority: 70 }],
    secondary: [{ part: 'CALF_L', priority: 60 }, { part: 'CALF_R', priority: 60 }],
    load: 'CARDIO', displayName: 'Stair Climber', group: 'cardio' },
  { matches: ['jump rope', 'skipping'],
    primary: [{ part: 'CALF_L', priority: 80 }, { part: 'CALF_R', priority: 80 }],
    secondary: [{ part: 'SHOULDER_L', priority: 50 }, { part: 'SHOULDER_R', priority: 50 }],
    load: 'CARDIO', displayName: 'Jump Rope', group: 'cardio' },
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
  return [...new Set(hits.map((h) => h.part))];
}

/**
 * Get the load type for an exercise — used to enable/disable
 * the weight input. BODYWEIGHT = use bodyweight, no input;
 * WEIGHTED_BODYWEIGHT = bodyweight + extra weight from belt/vest;
 * FREE_WEIGHT / MACHINE = external load; CARDIO = duration-based.
 */
export function loadForExercise(name: string): ExerciseLoad {
  const rule = lookupRule(name);
  return rule?.load ?? 'OTHER';
}

export function ruleForExercise(name: string): ExerciseMuscles | undefined {
  return lookupRule(name);
}

/**
 * Get autocomplete suggestions for an exercise input. Returns up
 * to `limit` display names that match the partial input.
 */
export function suggestExercises(partial: string, limit = 8): Array<{
  name: string;
  load: ExerciseLoad;
  group: string;
}> {
  if (!partial || partial.length < 1) return [];
  const lower = partial.toLowerCase().trim();

  // Score each rule by how well its display name matches.
  const scored: Array<{ rule: ExerciseMuscles; score: number }> = [];
  for (const rule of EXERCISE_DB) {
    const nameLower = rule.displayName.toLowerCase();
    if (nameLower.startsWith(lower)) {
      scored.push({ rule, score: 100 });
    } else if (nameLower.includes(lower)) {
      scored.push({ rule, score: 50 });
    } else if (rule.matches.some((m) => m.includes(lower))) {
      scored.push({ rule, score: 25 });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  // De-dup by displayName (in case two rules match)
  const seen = new Set<string>();
  const out: Array<{ name: string; load: ExerciseLoad; group: string }> = [];
  for (const { rule } of scored) {
    if (seen.has(rule.displayName.toLowerCase())) continue;
    seen.add(rule.displayName.toLowerCase());
    out.push({ name: rule.displayName, load: rule.load, group: rule.group });
    if (out.length >= limit) break;
  }
  return out;
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

export const TOTAL_EXERCISES = EXERCISE_DB.length;

/**
 * For weighted bodyweight exercises, compute the effective load
 * (bodyweight + extra weight) for volume calculations.
 */
export function effectiveLoad(
  exerciseName: string,
  extraWeight: number,
  bodyweightKg: number | null | undefined,
): number {
  const load = loadForExercise(exerciseName);
  if (load === 'BODYWEIGHT') return bodyweightKg ?? 0;
  if (load === 'WEIGHTED_BODYWEIGHT') return (bodyweightKg ?? 0) + extraWeight;
  return extraWeight;
}