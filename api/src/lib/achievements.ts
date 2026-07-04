import { AchievementCategory, type PrismaClient } from './prisma.js';
import { prisma } from './prisma.js';
import { getWeighInStreak, getCategoryStreak } from './streaks.js';
import { localDayKey } from './timezone.js';

type Criteria =
  | { kind: 'workout_count'; gte: number }
  | { kind: 'pr'; exercise: string; gte: number }
  | { kind: 'relative_pr'; exercise: 'BENCH' | 'SQUAT' | 'DEADLIFT'; multiple: number }
  | { kind: 'pl_total_relative'; multiple: number }
  | { kind: 'measurement'; metric: string; lte?: number; gte?: number }
  | { kind: 'streak_days'; gte: number }
  | { kind: 'party_join' }
  | { kind: 'raid_victory' }
  | { kind: 'leak_kill'; gte: number }
  | { kind: 'vo2_max_gte'; gte: number }
  | { kind: 'plank_hold_gte'; gte: number }
  | { kind: 'weigh_in_count'; gte: number }
  | { kind: 'weigh_in_streak'; gte: number }
  | { kind: 'category_streak'; category: string; gte: number }
  | { kind: 'prayer_count'; gte: number }
  | { kind: 'prayer_streak'; gte: number }
  | { kind: 'class_stage'; gte: 1 | 2 | 3 }
  | { kind: 'time_of_day_workout'; hourStart: number; hourEnd: number; gte?: number }
  | { kind: 'profile_complete' }
  | { kind: 'quest_world_complete'; worldId: string }
  | { kind: 'boss_kill' };

export const ACHIEVEMENT_DEFS: Array<{
  key: string;
  name: string;
  description: string;
  category: AchievementCategory;
  icon: string;
  criteria: Criteria;
  points: number;
  witty?: boolean;
}> = [
  // ============================================================
  // Consistency
  // ============================================================
  { key: 'first_workout',     name: 'Baby Steps',           description: 'One rep. One log. You showed up.', category: 'CONSISTENCY', icon: 'medal',    criteria: { kind: 'workout_count', gte: 1 },   points: 5 },
  { key: 'ten_workouts',      name: 'Showing Up',           description: 'Ten workouts. The bar remembers your face.', category: 'CONSISTENCY', icon: 'flame',    criteria: { kind: 'workout_count', gte: 10 },  points: 15 },
  { key: 'fifty_workouts',    name: 'This Is Routine Now',  description: 'Fifty workouts. Not a streak, a lifestyle.', category: 'CONSISTENCY', icon: 'flame',    criteria: { kind: 'workout_count', gte: 50 },  points: 40 },
  { key: 'hundred_workouts',  name: 'Centurion',            description: 'A hundred workouts. The barbell remembers.', category: 'CONSISTENCY', icon: 'crown',    criteria: { kind: 'workout_count', gte: 100 }, points: 100 },
  { key: 'twofifty_workouts', name: 'Five Hundred Down',    description: 'Two hundred fifty workouts. You are the floor now.', category: 'CONSISTENCY', icon: 'crown', criteria: { kind: 'workout_count', gte: 250 }, points: 200, witty: true },
  { key: 'streak_7',          name: 'The Pattern Forms',    description: 'Seven days in a row. The habit has hooks.', category: 'CONSISTENCY', icon: 'flame',    criteria: { kind: 'streak_days', gte: 7 },      points: 25 },
  { key: 'streak_30',         name: 'Iron Routine',         description: 'Thirty days. It is no longer a decision.', category: 'CONSISTENCY', icon: 'flame',    criteria: { kind: 'streak_days', gte: 30 },     points: 100 },
  { key: 'streak_100',        name: 'The Grind Knows My Name', description: 'One hundred days. The gym owes you a plaque.', category: 'CONSISTENCY', icon: 'crown', criteria: { kind: 'streak_days', gte: 100 }, points: 250, witty: true },
  { key: 'streak_365',        name: 'Year One',             description: 'Three hundred sixty-five days. You did the math.', category: 'CONSISTENCY', icon: 'crown', criteria: { kind: 'streak_days', gte: 365 }, points: 500, witty: true },

  // ============================================================
  // Strength — Big 3 + Powerlifting Total
  // ============================================================
  { key: 'bench_bw',    name: 'Bodyweight Bench', description: 'Bench press one times your bodyweight.', category: 'STRENGTH', icon: 'dumbbell', criteria: { kind: 'relative_pr', exercise: 'BENCH',    multiple: 1   }, points: 25 },
  { key: 'bench_1.5x',  name: 'Better Than Average', description: 'Bench one and a half times your bodyweight.', category: 'STRENGTH', icon: 'dumbbell', criteria: { kind: 'relative_pr', exercise: 'BENCH',    multiple: 1.5 }, points: 60 },
  { key: 'bench_2x',    name: 'Chest Was A Suggestion', description: 'Bench two times your bodyweight.', category: 'STRENGTH', icon: 'dumbbell', criteria: { kind: 'relative_pr', exercise: 'BENCH',    multiple: 2   }, points: 150 },
  { key: 'bench_2.5x',  name: 'Pressing Matters',   description: 'Bench two and a half times your bodyweight.', category: 'STRENGTH', icon: 'dumbbell', criteria: { kind: 'relative_pr', exercise: 'BENCH',    multiple: 2.5 }, points: 300, witty: true },
  { key: 'squat_2x',    name: 'Pillar of Power',    description: 'Squat two times your bodyweight.', category: 'STRENGTH', icon: 'dumbbell', criteria: { kind: 'relative_pr', exercise: 'SQUAT',    multiple: 2   }, points: 100 },
  { key: 'squat_2.5x',  name: 'Wheels of Steel',    description: 'Squat two and a half times your bodyweight.', category: 'STRENGTH', icon: 'dumbbell', criteria: { kind: 'relative_pr', exercise: 'SQUAT',    multiple: 2.5 }, points: 200 },
  { key: 'squat_3x',    name: 'Leg Day Is A Love Language', description: 'Squat three times your bodyweight.', category: 'STRENGTH', icon: 'crown', criteria: { kind: 'relative_pr', exercise: 'SQUAT',    multiple: 3   }, points: 400, witty: true },
  { key: 'deadlift_2.5x', name: 'Anchor',          description: 'Deadlift two and a half times your bodyweight.', category: 'STRENGTH', icon: 'dumbbell', criteria: { kind: 'relative_pr', exercise: 'DEADLIFT', multiple: 2.5 }, points: 150 },
  { key: 'deadlift_3x',   name: 'Titan',          description: 'Deadlift three times your bodyweight.', category: 'STRENGTH', icon: 'crown',    criteria: { kind: 'relative_pr', exercise: 'DEADLIFT', multiple: 3   }, points: 300 },
  { key: 'deadlift_4x',   name: 'Lower Back Of Steel', description: 'Deadlift four times your bodyweight. The floor is just a suggestion.', category: 'STRENGTH', icon: 'crown', criteria: { kind: 'relative_pr', exercise: 'DEADLIFT', multiple: 4   }, points: 600, witty: true },
  { key: 'pl_total_5x',   name: 'Wilks In Training', description: 'Powerlifting total (S+B+D) ≥ 5x bodyweight.', category: 'STRENGTH', icon: 'crown', criteria: { kind: 'pl_total_relative', multiple: 5 }, points: 250, witty: true },
  { key: 'pl_total_6x',   name: 'The Big Three, The Big Number', description: 'Powerlifting total ≥ 6x bodyweight. You are a meet.', category: 'STRENGTH', icon: 'crown', criteria: { kind: 'pl_total_relative', multiple: 6 }, points: 500, witty: true },

  // ============================================================
  // Hypertrophy
  // ============================================================
  { key: 'bicep_40',     name: 'Sleeves Are Optional', description: 'Bicep circumference ≥ 40 cm. Tailors hate you.', category: 'HYPERTROPHY', icon: 'arm', criteria: { kind: 'measurement', metric: 'BICEP', gte: 40 }, points: 50 },
  { key: 'bicep_45',     name: 'Sleeves Don\u2019t Fit', description: 'Bicep circumference ≥ 45 cm. The tailor has filed a complaint.', category: 'HYPERTROPHY', icon: 'arm', criteria: { kind: 'measurement', metric: 'BICEP', gte: 45 }, points: 150, witty: true },
  { key: 'shoulder_140', name: 'Doorways Are Suggestions', description: 'Shoulder width ≥ 140 cm. Architects weep.', category: 'HYPERTROPHY', icon: 'body', criteria: { kind: 'measurement', metric: 'SHOULDER', gte: 140 }, points: 100, witty: true },
  { key: 'chest_120',    name: 'Frame Of Reference', description: 'Chest circumference ≥ 120 cm. Cross-country from above now.', category: 'HYPERTROPHY', icon: 'body', criteria: { kind: 'measurement', metric: 'CHEST', gte: 120 }, points: 75, witty: true },
  { key: 'quad_65',      name: 'Quads Of Doom',     description: 'Quad circumference ≥ 65 cm. Pants are a negotiation.', category: 'HYPERTROPHY', icon: 'arm', criteria: { kind: 'measurement', metric: 'QUAD', gte: 65 }, points: 75, witty: true },
  { key: 'calf_45',      name: 'Floor Apparent',    description: 'Calf circumference ≥ 45 cm. Socks fit like compression sleeves.', category: 'HYPERTROPHY', icon: 'arm', criteria: { kind: 'measurement', metric: 'CALF', gte: 45 }, points: 75, witty: true },

  // ============================================================
  // Body Comp
  // ============================================================
  { key: 'ffmi_22', name: 'Compression Algorithm', description: 'FFMI ≥ 22. Optimized for size, recompiled for strength.', category: 'BODY_COMP', icon: 'body', criteria: { kind: 'measurement', metric: 'FFMI', gte: 22 }, points: 80 },
  { key: 'ffmi_24', name: 'Compiled',              description: 'FFMI ≥ 24. Lean mass deployed.', category: 'BODY_COMP', icon: 'crown', criteria: { kind: 'measurement', metric: 'FFMI', gte: 24 }, points: 200 },
  { key: 'ffmi_26', name: 'Compiled At -O3',       description: 'FFMI ≥ 26. Elite natural ceiling, achieved.', category: 'BODY_COMP', icon: 'crown', criteria: { kind: 'measurement', metric: 'FFMI', gte: 26 }, points: 400, witty: true },
  { key: 'bf_sub10', name: 'Sub-10 Club', description: 'Body fat ≤ 10%. Visible abs without flexing.', category: 'BODY_COMP', icon: 'body', criteria: { kind: 'measurement', metric: 'BODY_FAT_PCT', lte: 10 }, points: 150, witty: true },

  // ============================================================
  // Endurance
  // ============================================================
  { key: 'vo2_45',   name: 'Cardio Is A Love Language', description: 'VO2 max ≥ 45 ml/kg/min. The lungs have opinions.', category: 'ENDURANCE', icon: 'lung', criteria: { kind: 'vo2_max_gte', gte: 45 }, points: 50 },
  { key: 'vo2_55',   name: 'Aerobic Apex',  description: 'VO2 max ≥ 55 ml/kg/min. You out-breathe the room.', category: 'ENDURANCE', icon: 'lung', criteria: { kind: 'vo2_max_gte', gte: 55 }, points: 150 },
  { key: 'vo2_60',   name: 'Lung Capacity Wonder', description: 'VO2 max ≥ 60. Tour de France called, they want their lungs back.', category: 'ENDURANCE', icon: 'lung', criteria: { kind: 'vo2_max_gte', gte: 60 }, points: 300, witty: true },
  { key: 'sub30_5k', name: 'Sub-30 Club',   description: '5K time ≤ 30:00.', category: 'ENDURANCE', icon: 'shoe', criteria: { kind: 'measurement', metric: 'FIVE_K_TIME', lte: 30 * 60 }, points: 25 },
  { key: 'sub25_5k', name: 'Sub-25 Club',   description: '5K time ≤ 25:00.', category: 'ENDURANCE', icon: 'shoe', criteria: { kind: 'measurement', metric: 'FIVE_K_TIME', lte: 25 * 60 }, points: 50 },
  { key: 'sub20_5k', name: 'Sub-20 Club',   description: '5K time ≤ 20:00. The taper worked.', category: 'ENDURANCE', icon: 'shoe', criteria: { kind: 'measurement', metric: 'FIVE_K_TIME', lte: 20 * 60 }, points: 150 },
  { key: 'sub18_5k', name: 'Negative Split', description: '5K time ≤ 18:00. Podium-shaped.', category: 'ENDURANCE', icon: 'shoe', criteria: { kind: 'measurement', metric: 'FIVE_K_TIME', lte: 18 * 60 }, points: 300, witty: true },

  // ============================================================
  // Calisthenics
  // ============================================================
  { key: 'plank_60',  name: 'Iron Core',       description: 'Plank hold ≥ 60s. The floor is where you live.', category: 'CALISTHENICS', icon: 'core', criteria: { kind: 'plank_hold_gte', gte: 60 }, points: 30 },
  { key: 'plank_180', name: 'Gravity Is A Suggestion', description: 'Plank hold ≥ 3 minutes. The floor and you have an arrangement.', category: 'CALISTHENICS', icon: 'core', criteria: { kind: 'plank_hold_gte', gte: 180 }, points: 100 },
  { key: 'plank_300', name: 'Floor Apparent',  description: 'Plank hold ≥ 5 minutes. Are you furniture?', category: 'CALISTHENICS', icon: 'core', criteria: { kind: 'plank_hold_gte', gte: 300 }, points: 250, witty: true },
  { key: 'lsit_30',   name: 'L-Sit Apprentice', description: 'L-sit ≥ 30s.', category: 'CALISTHENICS', icon: 'core', criteria: { kind: 'measurement', metric: 'L_SIT_HOLD', gte: 30 }, points: 60 },
  { key: 'lsit_60',   name: 'Hover Mode',       description: 'L-sit ≥ 60s. You are between steps in the air.', category: 'CALISTHENICS', icon: 'core', criteria: { kind: 'measurement', metric: 'L_SIT_HOLD', gte: 60 }, points: 150, witty: true },
  { key: 'pullup_15', name: 'Pull-Up Enthusiast', description: '15 pull-ups in a row. The bar is now family.', category: 'CALISTHENICS', icon: 'arm', criteria: { kind: 'measurement', metric: 'PULLUP_MAX', gte: 15 }, points: 60, witty: true },
  { key: 'pullup_25', name: 'Pull-Up Industrial Complex', description: '25 pull-ups in a row. The bar bill is non-trivial.', category: 'CALISTHENICS', icon: 'crown', criteria: { kind: 'measurement', metric: 'PULLUP_MAX', gte: 25 }, points: 200, witty: true },

  // ============================================================
  // Social
  // ============================================================
  { key: 'first_party',   name: 'Formed A Band',     description: 'Join or create a party.', category: 'SOCIAL', icon: 'shield', criteria: { kind: 'party_join' }, points: 10 },
  { key: 'raid_victory',  name: 'Boss Down',          description: 'Defeat a raid boss with your party.', category: 'SOCIAL', icon: 'sword', criteria: { kind: 'raid_victory' }, points: 100 },
  { key: 'first_leak',     name: 'Sealed the Breach',    description: 'Defeat a portal leak and claim its loot.', category: 'SOCIAL', icon: 'shield', criteria: { kind: 'leak_kill', gte: 1 }, points: 25, witty: true },
  { key: 'ten_leaks',     name: 'Plumber',              description: 'Ten portal leaks sealed. You are a maintenance crew.', category: 'SOCIAL', icon: 'wrench', criteria: { kind: 'leak_kill', gte: 10 }, points: 80 },
  { key: 'world_boss_kill', name: 'World Boss Down', description: 'Defeat a world boss.', category: 'SOCIAL', icon: 'sword', criteria: { kind: 'boss_kill' }, points: 200, witty: true },

  // ============================================================
  // Spiritual
  // ============================================================
  { key: 'first_prayer',     name: 'First Vespers',          description: 'Log your first prayer.', category: 'CONSISTENCY', icon: 'moon',   criteria: { kind: 'prayer_count', gte: 1 },   points: 5 },
  { key: 'prayer_25',        name: 'Litanist',               description: 'Twenty-five prayers logged.', category: 'CONSISTENCY', icon: 'moon', criteria: { kind: 'prayer_count', gte: 25 },  points: 30, witty: true },
  { key: 'prayer_100',       name: 'Rule Of 12',             description: 'One hundred prayers logged. The rhythm is the point.', category: 'CONSISTENCY', icon: 'moon', criteria: { kind: 'prayer_count', gte: 100 }, points: 100, witty: true },
  { key: 'prayer_streak_7',  name: 'Daily Office Devotee',   description: 'Seven-day prayer streak.', category: 'CONSISTENCY', icon: 'moon', criteria: { kind: 'prayer_streak', gte: 7 },   points: 30 },
  { key: 'prayer_streak_30', name: 'Hours Are A Rhythm',     description: 'Thirty-day prayer streak. The hours know you.', category: 'CONSISTENCY', icon: 'moon', criteria: { kind: 'prayer_streak', gte: 30 },  points: 150, witty: true },

  // ============================================================
  // Daily weigh-ins
  // ============================================================
  { key: 'first_weigh_in',       name: 'On The Scale',       description: 'Log your first daily weigh-in.', category: 'CONSISTENCY', icon: 'scale', criteria: { kind: 'weigh_in_count', gte: 1 }, points: 5 },
  { key: 'weigh_in_week',        name: 'Weekly Weigh-In',    description: 'Seven-day weigh-in streak.', category: 'CONSISTENCY', icon: 'scale', criteria: { kind: 'weigh_in_streak', gte: 7 }, points: 30 },
  { key: 'weigh_in_fortnight',   name: 'Two Weeks Of Truth', description: 'Fourteen-day weigh-in streak.', category: 'CONSISTENCY', icon: 'scale', criteria: { kind: 'weigh_in_streak', gte: 14 }, points: 75 },
  { key: 'weigh_in_month',       name: 'Iron Routine',       description: 'Thirty-day weigh-in streak.', category: 'CONSISTENCY', icon: 'scale', criteria: { kind: 'weigh_in_streak', gte: 30 }, points: 200 },

  // ============================================================
  // Habit tracking (sleep / nutrition / wellness)
  // ============================================================
  { key: 'sleep_week',       name: 'Well Rested',       description: 'Log sleep seven days in a row.', category: 'CONSISTENCY', icon: 'moon', criteria: { kind: 'category_streak', category: 'SLEEP', gte: 7 }, points: 25 },
  { key: 'sleep_month',      name: 'Sleep Architect',   description: 'Log sleep thirty days in a row.', category: 'CONSISTENCY', icon: 'moon', criteria: { kind: 'category_streak', category: 'SLEEP', gte: 30 }, points: 150 },
  { key: 'nutrition_week',   name: 'Fueled Up',         description: 'Log nutrition seven days in a row.', category: 'CONSISTENCY', icon: 'apple', criteria: { kind: 'category_streak', category: 'NUTRITION', gte: 7 }, points: 25 },
  { key: 'nutrition_month',  name: 'Macro Master',      description: 'Log nutrition thirty days in a row.', category: 'CONSISTENCY', icon: 'apple', criteria: { kind: 'category_streak', category: 'NUTRITION', gte: 30 }, points: 150 },
  { key: 'wellness_week',    name: 'Self-Aware',        description: 'Log wellness seven days in a row.', category: 'CONSISTENCY', icon: 'heart', criteria: { kind: 'category_streak', category: 'WELLNESS', gte: 7 }, points: 25 },
  { key: 'wellness_month',   name: 'Mind-Body Sync',    description: 'Log wellness thirty days in a row.', category: 'CONSISTENCY', icon: 'heart', criteria: { kind: 'category_streak', category: 'WELLNESS', gte: 30 }, points: 150 },

  // ============================================================
  // Class evolution
  // ============================================================
  { key: 'class_stage_2',    name: 'Promoted',          description: 'Reach class evolution stage 2 (Level 10+).', category: 'STRENGTH', icon: 'crown', criteria: { kind: 'class_stage', gte: 2 }, points: 50, witty: true },
  { key: 'class_stage_3',    name: 'Final Form',        description: 'Reach class evolution stage 3 (Level 25+).', category: 'STRENGTH', icon: 'crown', criteria: { kind: 'class_stage', gte: 3 }, points: 200, witty: true },

  // ============================================================
  // Special / hidden — earned through unusual patterns
  // ============================================================
  { key: 'owl_hours',         name: 'Owl Hours',         description: 'Log a workout between midnight and 4 AM. The gym staff knows your name.', category: 'CONSISTENCY', icon: 'moon', criteria: { kind: 'time_of_day_workout', hourStart: 0, hourEnd: 4, gte: 1 }, points: 25, witty: true },
  { key: 'lunch_break_lifter', name: 'Lunch Break Lifter', description: 'Log a workout between 11 AM and 1 PM on a weekday. HR noticed.', category: 'CONSISTENCY', icon: 'medal', criteria: { kind: 'time_of_day_workout', hourStart: 11, hourEnd: 13, gte: 5 }, points: 30, witty: true },
  { key: 'profile_complete',  name: 'Calibrated',        description: 'Fill in all frame measurements (height, wrist, ankle, forearm, neck).', category: 'CONSISTENCY', icon: 'body', criteria: { kind: 'profile_complete' }, points: 10, witty: true },
  { key: 'side_by_side',       name: 'Side By Side',      description: 'Completed a team workout with at least one other party member.', category: 'SOCIAL', icon: 'people', criteria: { kind: 'team_workout_count', gte: 1 }, points: 50 },
];

export async function ensureAchievementsSeeded() {
  for (const a of ACHIEVEMENT_DEFS) {
    await prisma.achievement.upsert({
      where: { key: a.key },
      create: {
        key: a.key,
        name: a.name,
        description: a.description,
        category: a.category,
        icon: a.icon,
        criteria: a.criteria as any,
        points: a.points,
      },
      update: {
        name: a.name,
        description: a.description,
        category: a.category,
        icon: a.icon,
        criteria: a.criteria as any,
        points: a.points,
      },
    });
  }
}

export async function checkAchievements(
  userId: string,
  tx: PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0] = prisma,
) {
  // Lazy lookup; re-uses a passed-in transaction if any.
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: {
      measurements: { orderBy: { recordedAt: 'desc' } },
      workouts: { select: { id: true, performedAt: true } },
      prs: true,
      partyMember: true,
      raidContribs: { include: { raid: true } },
      achievements: { select: { achievementId: true } },
      prayerLogs: { select: { loggedAt: true } },
      worldProgress: true,
      worldBosses: true,
      // Portal leaks the user has sealed. Pre-filter to DEFEATED
      // server-side so we don't ship the active ones back. Used
      // by the `leak_kill` achievement criteria kind.
      portalLeaks: { where: { status: 'DEFEATED' }, select: { id: true } },
    },
  });
  if (!user) return [];

  const ownedIds = new Set(user.achievements.map((a) => a.achievementId));
  const all = await tx.achievement.findMany();
  const newlyUnlocked: string[] = [];
  const tz = user.timezone ?? null;

  // Helper: latest measurement of a metric
  const latest = (metric: string) => {
    const m = user.measurements.find((m) => m.metric === metric);
    return m?.value ?? null;
  };

  // Helper: best PR for a given exercise
  const bestPr = (exercise: string) => {
    const ps = user.prs.filter((p) => p.exercise === exercise);
    return ps.length ? Math.max(...ps.map((p) => p.value)) : null;
  };

  // Streak: distinct workout days, count consecutive ending today/yesterday
  // Buckets use localDayKey (user-tz) — was toDateString() (server-local UTC).
  const days = new Set(user.workouts.map((w) => localDayKey(new Date(w.performedAt), tz)));
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = localDayKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000), tz);
    if (days.has(d)) streak++;
    else if (i > 0) break;
  }

  // Prayer streak
  const prayerDays = new Set(user.prayerLogs.map((p) => localDayKey(new Date(p.loggedAt), tz)));
  let prayerStreak = 0;
  for (let i = 0; i < 365; i++) {
    const d = localDayKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000), tz);
    if (prayerDays.has(d)) prayerStreak++;
    else if (i > 0) break;
  }

  // Powerlifting total (sum of best S/B/D if all three exist, else null)
  const plTotal = (() => {
    const s = bestPr('Squat') ?? 0;
    const b = bestPr('Bench Press') ?? 0;
    const d = bestPr('Deadlift') ?? 0;
    return s > 0 && b > 0 && d > 0 ? s + b + d : null;
  })();

  // Class evolution stage — derive from level
  const classStage: 1 | 2 | 3 =
    user.level >= 25 ? 3 : user.level >= 10 ? 2 : 1;

  // Profile complete — all five frame measurements filled
  const profileComplete =
    user.heightCm != null &&
    user.wristCm != null &&
    user.ankleCm != null &&
    user.forearmLengthCm != null &&
    user.neckCircCm != null;

  // Weigh-in data (count + streak)
  const weighInMeasurements = user.measurements.filter((m) => m.metric === 'WEIGHT');
  const weighInCount = new Set(
    weighInMeasurements.map((m) => localDayKey(new Date(m.recordedAt), tz))
  ).size;
  const weighInStreakData = await getWeighInStreak(userId);
  const weighInStreak = weighInStreakData.current;

  for (const a of all) {
    if (ownedIds.has(a.id)) continue;
    const c = a.criteria as Criteria;
    let ok = false;
    switch (c.kind) {
      case 'workout_count':
        ok = user.workouts.length >= c.gte;
        break;
      case 'pr':
        ok = (bestPr(c.exercise) ?? 0) >= c.gte;
        break;
      case 'relative_pr': {
        const w = user.weightKg ?? 0;
        if (w <= 0) break;
        const target = w * c.multiple;
        const ex =
          c.exercise === 'BENCH' ? 'Bench Press'
          : c.exercise === 'SQUAT' ? 'Squat'
          : 'Deadlift';
        ok = (bestPr(ex) ?? 0) >= target;
        break;
      }
      case 'pl_total_relative': {
        const w = user.weightKg ?? 0;
        if (w <= 0 || plTotal == null) break;
        ok = plTotal >= w * c.multiple;
        break;
      }
      case 'measurement': {
        const v = latest(c.metric);
        if (v == null) break;
        if (c.lte != null) ok = v <= c.lte;
        if (c.gte != null) ok = ok ? ok : v >= c.gte;
        break;
      }
      case 'streak_days':
        ok = streak >= c.gte;
        break;
      case 'party_join':
        ok = !!user.partyMember;
        break;
      case 'raid_victory':
        ok = user.raidContribs.some((c) => c.raid.status === 'VICTORY');
        break;
      case 'leak_kill':
        // The user.prisma query above pre-filters to status: DEFEATED
        // so portalLeaks.length() is the leak-kill count.
        ok = user.portalLeaks.length >= c.gte;
        break;
      case 'boss_kill':
        ok = user.worldBosses?.some((b) => b.defeatedAt != null) ?? false;
        break;
      case 'vo2_max_gte':
        ok = (latest('VO2_MAX') ?? 0) >= c.gte;
        break;
      case 'plank_hold_gte':
        ok = (latest('PLANK_HOLD') ?? 0) >= c.gte;
        break;
      case 'weigh_in_count':
        ok = weighInCount >= c.gte;
        break;
      case 'weigh_in_streak':
        ok = weighInStreak >= c.gte;
        break;
      case 'category_streak': {
        const s = await getCategoryStreak(userId, c.category);
        ok = s.current >= c.gte;
        break;
      }
      case 'prayer_count':
        ok = user.prayerLogs.length >= c.gte;
        break;
      case 'prayer_streak':
        ok = prayerStreak >= c.gte;
        break;
      case 'class_stage':
        ok = classStage >= c.gte;
        break;
      case 'time_of_day_workout': {
        const needed = c.gte ?? 1;
        const matching = user.workouts.filter((w) => {
          const h = new Date(w.performedAt).getHours();
          return h >= c.hourStart && h < c.hourEnd;
        });
        ok = matching.length >= needed;
        break;
      }
      case 'profile_complete':
        ok = profileComplete;
        break;
      case 'quest_world_complete': {
        // worldId is stored in criteria. A world has 5 levels
        // (e.g. 'spire-1' ... 'spire-5'); user has completed the
        // world when all 5 are marked completed.
        const wid = (c as { kind: 'quest_world_complete'; worldId: string }).worldId;
        const completed = user.worldProgress ?? [];
        const levelsForWorld = completed.filter((p) => p.levelId.startsWith(`${wid}-`));
        ok = levelsForWorld.length >= 5 && levelsForWorld.every((p) => p.completed);
        break;
      }
    }
    if (ok) {
      await tx.userAchievement.create({
        data: { userId, achievementId: a.id },
      });
      newlyUnlocked.push(a.key);
    }
  }
  return newlyUnlocked;
}
