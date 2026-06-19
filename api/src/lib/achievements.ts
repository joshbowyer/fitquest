import { AchievementCategory, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';
import { getWeighInStreak, getCategoryStreak } from './streaks.js';

type Criteria =
  | { kind: 'workout_count'; gte: number }
  | { kind: 'pr'; exercise: string; gte: number }
  | { kind: 'relative_pr'; exercise: 'BENCH' | 'SQUAT' | 'DEADLIFT'; multiple: number }
  | { kind: 'measurement'; metric: string; lte?: number; gte?: number }
  | { kind: 'streak_days'; gte: number }
  | { kind: 'party_join' }
  | { kind: 'raid_victory' }
  | { kind: 'vo2_max_gte'; gte: number }
  | { kind: 'plank_hold_gte'; gte: number }
  | { kind: 'weigh_in_count'; gte: number }
  | { kind: 'weigh_in_streak'; gte: number }
  | { kind: 'category_streak'; category: string; gte: number };

export const ACHIEVEMENT_DEFS: Array<{
  key: string;
  name: string;
  description: string;
  category: AchievementCategory;
  icon: string;
  criteria: Criteria;
  points: number;
}> = [
  // Consistency
  { key: 'first_workout', name: 'Initiate', description: 'Log your first workout.', category: 'CONSISTENCY', icon: 'medal', criteria: { kind: 'workout_count', gte: 1 }, points: 5 },
  { key: 'ten_workouts', name: 'Apprentice', description: 'Complete 10 workouts.', category: 'CONSISTENCY', icon: 'flame', criteria: { kind: 'workout_count', gte: 10 }, points: 15 },
  { key: 'fifty_workouts', name: 'Adept', description: 'Complete 50 workouts.', category: 'CONSISTENCY', icon: 'flame', criteria: { kind: 'workout_count', gte: 50 }, points: 40 },
  { key: 'hundred_workouts', name: 'Centurion', description: 'Complete 100 workouts.', category: 'CONSISTENCY', icon: 'crown', criteria: { kind: 'workout_count', gte: 100 }, points: 100 },
  { key: 'streak_7', name: 'Weekly Devotion', description: '7-day workout streak.', category: 'CONSISTENCY', icon: 'flame', criteria: { kind: 'streak_days', gte: 7 }, points: 25 },
  { key: 'streak_30', name: 'Iron Will', description: '30-day workout streak.', category: 'CONSISTENCY', icon: 'flame', criteria: { kind: 'streak_days', gte: 30 }, points: 100 },

  // Strength
  { key: 'bench_bw', name: 'Bodyweight Bench', description: 'Bench 1x bodyweight.', category: 'STRENGTH', icon: 'dumbbell', criteria: { kind: 'relative_pr', exercise: 'BENCH', multiple: 1 }, points: 25 },
  { key: 'bench_1.5x', name: 'Above Average', description: 'Bench 1.5x bodyweight.', category: 'STRENGTH', icon: 'dumbbell', criteria: { kind: 'relative_pr', exercise: 'BENCH', multiple: 1.5 }, points: 60 },
  { key: 'bench_2x', name: 'Iron Chest', description: 'Bench 2x bodyweight.', category: 'STRENGTH', icon: 'dumbbell', criteria: { kind: 'relative_pr', exercise: 'BENCH', multiple: 2 }, points: 150 },
  { key: 'squat_2x', name: 'Pillar of Power', description: 'Squat 2x bodyweight.', category: 'STRENGTH', icon: 'dumbbell', criteria: { kind: 'relative_pr', exercise: 'SQUAT', multiple: 2 }, points: 100 },
  { key: 'squat_2.5x', name: 'Pillar of Iron', description: 'Squat 2.5x bodyweight.', category: 'STRENGTH', icon: 'dumbbell', criteria: { kind: 'relative_pr', exercise: 'SQUAT', multiple: 2.5 }, points: 200 },
  { key: 'deadlift_2.5x', name: 'Anchor', description: 'Deadlift 2.5x bodyweight.', category: 'STRENGTH', icon: 'dumbbell', criteria: { kind: 'relative_pr', exercise: 'DEADLIFT', multiple: 2.5 }, points: 150 },
  { key: 'deadlift_3x', name: 'Titan', description: 'Deadlift 3x bodyweight.', category: 'STRENGTH', icon: 'crown', criteria: { kind: 'relative_pr', exercise: 'DEADLIFT', multiple: 3 }, points: 300 },

  // Hypertrophy
  { key: 'bicep_40', name: 'Bicep Mountain', description: 'Bicep circumference >= 40cm.', category: 'HYPERTROPHY', icon: 'arm', criteria: { kind: 'measurement', metric: 'BICEP', gte: 40 }, points: 50 },
  { key: 'bicep_45', name: 'Bicep Peak', description: 'Bicep circumference >= 45cm.', category: 'HYPERTROPHY', icon: 'arm', criteria: { kind: 'measurement', metric: 'BICEP', gte: 45 }, points: 150 },

  // Body comp
  { key: 'ffmi_22', name: 'Built', description: 'FFMI >= 22.', category: 'BODY_COMP', icon: 'body', criteria: { kind: 'measurement', metric: 'FFMI', gte: 22 }, points: 80 },
  { key: 'ffmi_24', name: 'Elite Physique', description: 'FFMI >= 24.', category: 'BODY_COMP', icon: 'crown', criteria: { kind: 'measurement', metric: 'FFMI', gte: 24 }, points: 200 },

  // Endurance
  { key: 'vo2_45', name: 'Cardio Engine', description: 'VO2 max >= 45 ml/kg/min.', category: 'ENDURANCE', icon: 'lung', criteria: { kind: 'vo2_max_gte', gte: 45 }, points: 50 },
  { key: 'vo2_55', name: 'Aerobic Beast', description: 'VO2 max >= 55 ml/kg/min.', category: 'ENDURANCE', icon: 'lung', criteria: { kind: 'vo2_max_gte', gte: 55 }, points: 150 },
  { key: 'sub25_5k', name: 'Sub-25 5K', description: '5K time <= 25:00.', category: 'ENDURANCE', icon: 'shoe', criteria: { kind: 'measurement', metric: 'FIVE_K_TIME', lte: 25 * 60 }, points: 50 },
  { key: 'sub20_5k', name: 'Sub-20 5K', description: '5K time <= 20:00.', category: 'ENDURANCE', icon: 'shoe', criteria: { kind: 'measurement', metric: 'FIVE_K_TIME', lte: 20 * 60 }, points: 150 },

  // Calisthenics
  { key: 'plank_60', name: 'Iron Core', description: 'Plank hold >= 60s.', category: 'CALISTHENICS', icon: 'core', criteria: { kind: 'plank_hold_gte', gte: 60 }, points: 30 },
  { key: 'plank_180', name: 'Plank Master', description: 'Plank hold >= 3 minutes.', category: 'CALISTHENICS', icon: 'core', criteria: { kind: 'plank_hold_gte', gte: 180 }, points: 100 },
  { key: 'lsit_30', name: 'L-Sit Apprentice', description: 'L-sit hold >= 30s.', category: 'CALISTHENICS', icon: 'core', criteria: { kind: 'measurement', metric: 'L_SIT_HOLD', gte: 30 }, points: 60 },

  // Social
  { key: 'first_party', name: 'Band Formed', description: 'Join or create a party.', category: 'SOCIAL', icon: 'shield', criteria: { kind: 'party_join' }, points: 10 },
  { key: 'raid_victory', name: 'Boss Slayer', description: 'Defeat a raid boss with your party.', category: 'SOCIAL', icon: 'sword', criteria: { kind: 'raid_victory' }, points: 100 },

  // Daily weigh-ins
  { key: 'first_weigh_in', name: 'On the Scale', description: 'Log your first daily weigh-in.', category: 'CONSISTENCY', icon: 'scale', criteria: { kind: 'weigh_in_count', gte: 1 }, points: 5 },
  { key: 'weigh_in_week', name: 'Weekly Weigh-In', description: '7-day weigh-in streak.', category: 'CONSISTENCY', icon: 'scale', criteria: { kind: 'weigh_in_streak', gte: 7 }, points: 30 },
  { key: 'weigh_in_fortnight', name: 'Fortnight Vigil', description: '14-day weigh-in streak.', category: 'CONSISTENCY', icon: 'scale', criteria: { kind: 'weigh_in_streak', gte: 14 }, points: 75 },
  { key: 'weigh_in_month', name: 'Iron Routine', description: '30-day weigh-in streak.', category: 'CONSISTENCY', icon: 'scale', criteria: { kind: 'weigh_in_streak', gte: 30 }, points: 200 },

  // Habit tracking
  { key: 'sleep_week', name: 'Well Rested', description: 'Log sleep 7 days in a row.', category: 'CONSISTENCY', icon: 'moon', criteria: { kind: 'category_streak', category: 'SLEEP', gte: 7 }, points: 25 },
  { key: 'sleep_month', name: 'Sleep Architect', description: 'Log sleep 30 days in a row.', category: 'CONSISTENCY', icon: 'moon', criteria: { kind: 'category_streak', category: 'SLEEP', gte: 30 }, points: 150 },
  { key: 'nutrition_week', name: 'Fueled Up', description: 'Log nutrition 7 days in a row.', category: 'CONSISTENCY', icon: 'apple', criteria: { kind: 'category_streak', category: 'NUTRITION', gte: 7 }, points: 25 },
  { key: 'nutrition_month', name: 'Macro Master', description: 'Log nutrition 30 days in a row.', category: 'CONSISTENCY', icon: 'apple', criteria: { kind: 'category_streak', category: 'NUTRITION', gte: 30 }, points: 150 },
  { key: 'wellness_week', name: 'Self-Aware', description: 'Log wellness 7 days in a row.', category: 'CONSISTENCY', icon: 'heart', criteria: { kind: 'category_streak', category: 'WELLNESS', gte: 7 }, points: 25 },
  { key: 'wellness_month', name: 'Mind-Body Sync', description: 'Log wellness 30 days in a row.', category: 'CONSISTENCY', icon: 'heart', criteria: { kind: 'category_streak', category: 'WELLNESS', gte: 30 }, points: 150 },
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
    },
  });
  if (!user) return [];

  const ownedIds = new Set(user.achievements.map((a) => a.achievementId));
  const all = await tx.achievement.findMany();
  const newlyUnlocked: string[] = [];

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
  const days = new Set(user.workouts.map((w) => new Date(w.performedAt).toDateString()));
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toDateString();
    if (days.has(d)) streak++;
    else if (i > 0) break;
  }

  // Weigh-in data (count + streak)
  const weighInMeasurements = user.measurements.filter((m) => m.metric === 'WEIGHT');
  const weighInCount = new Set(
    weighInMeasurements.map((m) => new Date(m.recordedAt).toDateString())
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
