import { prisma } from './prisma.js';
import { validateSkillTest, type SkillTestSpec } from './skillTest.js';

/**
 * Map a skill name to the exercise keyword(s) the matching pass
 * should look for in the user's recent workout sets. This is the
 * "v1 approach" — fuzzy match on the skill name (which embeds
 * the exercise label) against the user's actual exercise names.
 *
 * Examples:
 *   "5 Strict Pull-Ups"     → ['pull-up', 'pullup', 'chin-up']
 *   "Bench 1.25×BW Strict"  → ['bench', 'bench press']
 *   "Bodyweight Squat"      → ['squat']
 *   "30s Plank Initiate"    → ['plank']
 *   "Sled Push 100m"        → ['sled']
 *
 * If the skill name doesn't match any keyword, the matching pass
 * skips it (better to under-detect than to false-positive on
 * random skill names). The seed for any new skill family should
 * add an entry here.
 */
const NAME_TO_KEYWORDS: Array<{ keyword: string; aliases: string[] }> = [
  { keyword: 'pull-up', aliases: ['pull-up', 'pullup', 'pull up', 'chin-up', 'chinup', 'chin up'] },
  { keyword: 'push-up', aliases: ['push-up', 'pushup', 'push up', 'pike push-up', 'pike pu', 'incline push-up'] },
  { keyword: 'squat',   aliases: ['squat', 'back squat', 'front squat', 'goblet squat'] },
  { keyword: 'bench',   aliases: ['bench press', 'bench', 'incline bench', 'decline bench'] },
  { keyword: 'plank',   aliases: ['plank', 'side plank', 'plank hold'] },
  { keyword: 'deadlift', aliases: ['deadlift', 'conventional deadlift', 'sumo deadlift', 'trap bar deadlift', 'romanian deadlift'] },
  { keyword: 'press',   aliases: ['overhead press', 'press', 'ohp', 'strict press', 'push press'] },
  { keyword: 'row',     aliases: ['row', 'barbell row', 'pendlay row', 'ring row', 'inverted row'] },
  { keyword: 'carry',   aliases: ['farmer walk', 'farmer carry', 'yoke walk', 'yoke', 'suitcase carry'] },
  { keyword: 'atlas',   aliases: ['atlas stone', 'atlas stones', 'stone'] },
  { keyword: 'sled',    aliases: ['sled push', 'sled', 'prowler', 'sled drag'] },
  { keyword: 'kettlebell', aliases: ['kettlebell', 'kb'] },
  { keyword: 'mace',    aliases: ['mace', 'indian club'] },
  { keyword: 'handstand', aliases: ['handstand', 'wall handstand', 'freestanding handstand', 'handstand hold'] },
  { keyword: 'l-sit',   aliases: ['l-sit', 'v-sit', 'straddle l'] },
  { keyword: 'muscle-up', aliases: ['muscle-up', 'ring muscle-up', 'bar muscle-up', 'strict muscle-up'] },
  { keyword: 'ring row', aliases: ['ring row', 'inverted ring row'] },
  { keyword: 'ring dip', aliases: ['ring dip'] },
  { keyword: 'pike',    aliases: ['pike push-up', 'pike pu', 'elevated pike'] },
  { keyword: 'hspu',    aliases: ['hspu', 'handstand push-up', 'wall hspu', 'free hspu'] },
  { keyword: 'archer',  aliases: ['archer push-up', 'archer pu'] },
  { keyword: 'one-arm', aliases: ['one-arm push-up', 'one-arm pu', 'one arm pu', 'one-arm pull-up', 'one arm pull-up', 'one-arm chin-up'] },
  { keyword: 'lunge',   aliases: ['lunge', 'walking lunge', 'reverse lunge', 'pistol squat'] },
  { keyword: 'crunch',  aliases: ['crunch', 'sit-up', 'sit up', 'hollow', 'hollow body', 'toes-to-bar'] },
  { keyword: 'jump',    aliases: ['jump', 'box jump', 'jump rope', 'burpee', 'squat jump', 'tuck jump'] },
  { keyword: 'wall',    aliases: ['wall sit'] },
];

/**
 * Given a skill name, return the list of exercise-name keywords
 * that should count toward unlocking it. Returns [] if the name
 * doesn't match any known family — the matching pass skips such
 * skills rather than false-positiving.
 */
export function exerciseKeywordsForSkillName(skillName: string): string[] {
  const lower = skillName.toLowerCase();
  for (const { keyword, aliases } of NAME_TO_KEYWORDS) {
    if (lower.includes(keyword)) {
      return aliases;
    }
  }
  return [];
}

function exerciseNameMatchesKeywords(exerciseName: string, keywords: string[]): boolean {
  const lower = exerciseName.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

type WorkoutForMatch = {
  id: string;
  name: string | null;
  performedAt: Date;
  exercises: Array<{
    id: string;
    name: string;
    sets: Array<{
      id: string;
      reps: number | null;
      weight: number | null;
      duration: number | null;
    }>;
  }>;
};

export type MatchedSet = {
  workoutId: string;
  workoutName: string | null;
  workoutDate: Date;
  exerciseId: string;
  exerciseName: string;
  setId: string;
  reps: number | null;
  weight: number | null;
  duration: number | null;
};

export type EligibleSkill = {
  skillId: string;
  skillName: string;
  branch: string | null;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  blurb: string | null;
  test: SkillTestSpec;
  matchedSet: MatchedSet;
};

/**
 * Check whether a single set satisfies a skill's test threshold.
 * Returns true if the user's reps/weight/duration on this set meet
 * or exceed the threshold for the test's metric.
 *
 * Pure function — no DB, no I/O. Used both by the live matching
 * pass and (potentially) by future debugging tools.
 */
export function setSatisfiesSkill(
  set: { reps: number | null; weight: number | null; duration: number | null },
  test: SkillTestSpec,
  userBodyweightKg: number,
): boolean {
  const submitted: Record<string, number | undefined> = {
    reps: set.reps ?? undefined,
    weight_kg: set.weight ?? undefined,
    duration_sec: set.duration ?? undefined,
  };
  return validateSkillTest(test, submitted, userBodyweightKg).ok;
}

/**
 * Find the first set in a workout that satisfies a skill's test
 * (if any). Returns the matched set + the workout context, or
 * null if no set in the workout matches. Doesn't care about
 * "have we already inserted a pending row" — the caller's
 * idempotent insert handles dedup.
 */
export function findMatchingSetInWorkout(
  workout: WorkoutForMatch,
  skill: { id: string; name: string; test: SkillTestSpec | null },
  userBodyweightKg: number,
): MatchedSet | null {
  if (!skill.test) return null;
  const keywords = exerciseKeywordsForSkillName(skill.name);
  if (keywords.length === 0) return null;
  for (const ex of workout.exercises) {
    if (!exerciseNameMatchesKeywords(ex.name, keywords)) continue;
    for (const set of ex.sets) {
      if (setSatisfiesSkill(set, skill.test, userBodyweightKg)) {
        return {
          workoutId: workout.id,
          workoutName: workout.name,
          workoutDate: workout.performedAt,
          exerciseId: ex.id,
          exerciseName: ex.name,
          setId: set.id,
          reps: set.reps,
          weight: set.weight,
          duration: set.duration,
        };
      }
    }
  }
  return null;
}

/**
 * The matching pass: walk all the user's locked skills, walk all
 * their recent workouts, find the first matching set per skill.
 * Returns a list of EligibleSkill entries, one per (skill, workout,
 * set) that meets the threshold.
 *
 * Idempotent at the DB level: the caller (route handler) inserts
 * a PendingSkillUnlock row per entry, with a unique constraint on
 * (userId, skillId, workoutId, matchedSetId). Re-running the pass
 * after a workout update won't create duplicate inbox rows.
 */
export async function findEligibleSkillUnlocks(
  userId: string,
  userBodyweightKg: number,
  lookbackDays = 60,
): Promise<EligibleSkill[]> {
  // Fetch all locked skills for the user's class. The page already
  // filters by className; we do the same here so the server-side
  // pass doesn't return skills the user can't see.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { class: true },
  });
  if (!user?.class) return [];

  // Locked skills = the ones the user hasn't already unlocked. We
  // pull the full unlocked set first to avoid an N+1 query.
  const [allSkills, unlockedRows] = await Promise.all([
    prisma.skill.findMany({
      where: { className: user.class },
      select: {
        id: true,
        name: true,
        branch: true,
        tier: true,
        blurb: true,
        test: true,
        prerequisites: true,
      },
    }),
    prisma.userSkill.findMany({
      where: { userId },
      select: { skillId: true },
    }),
  ]);
  const unlockedIds = new Set(unlockedRows.map((r) => r.skillId));
  const lockedSkills = allSkills.filter((s) => !unlockedIds.has(s.id) && s.test);

  if (lockedSkills.length === 0) return [];

  // Pull all recent workouts with their sets. We need the full
  // nested set tree because the matching function reads
  // exercise.name + set.{reps, weight, duration}.
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const workouts = await prisma.workout.findMany({
    where: { userId, performedAt: { gte: since } },
    orderBy: { performedAt: 'desc' },
    select: {
      id: true,
      name: true,
      performedAt: true,
      exercises: {
        select: {
          id: true,
          name: true,
          sets: {
            select: {
              id: true,
              reps: true,
              weight: true,
              duration: true,
            },
          },
        },
      },
    },
  });

  // Pre-resolve set ids the user already has PENDING inbox rows
  // for, so we don't fire the same unlock twice in one matching
  // pass. (The unique constraint catches it on insert too, but
  // skipping here saves a round-trip per dup.)
  const pending = await prisma.pendingSkillUnlock.findMany({
    where: { userId, status: 'PENDING' },
    select: { skillId: true, workoutId: true, matchedSetId: true },
  });
  const pendingSet = new Set(
    pending.map((p) => `${p.skillId}|${p.workoutId}|${p.matchedSetId}`),
  );

  // The matching pass should only surface skills the user is
  // *eligible* to unlock — not ones still gated by prereqs.
  // We compute the unlocked-name set from unlockedIds (we have
  // the ids, not the names) so we need to map them.
  const allSkillNames = new Map(allSkills.map((s) => [s.id, s.name]));
  const unlockedNames = new Set(
    Array.from(unlockedIds)
      .map((id) => allSkillNames.get(id))
      .filter((n): n is string => Boolean(n)),
  );

  const out: EligibleSkill[] = [];
  for (const skill of lockedSkills) {
    const test = skill.test as unknown as SkillTestSpec | null;
    if (!test) continue;
    // Prereq gate: T1 skills have no prereqs (and even when they
    // do, we treat the prereq list as authoritative). Skip skills
    // whose prerequisites include anything not yet unlocked.
    const unmetPrereqs = (skill.prerequisites ?? []).filter(
      (name: string) => !unlockedNames.has(name),
    );
    if (unmetPrereqs.length > 0) continue;
    for (const workout of workouts) {
      const key = `${skill.id}|${workout.id}`;
      // Cheap per-skill check: skip if we already have a PENDING
      // row for this (skill, workout) pair (we'd have to dig
      // into sets to be exact, but most of the time a workout
      // matches at most one set per skill).
      if (pendingSet.has(`${key}|__any__`)) continue;
      const matched = findMatchingSetInWorkout(
        workout as unknown as WorkoutForMatch,
        { id: skill.id, name: skill.name, test },
        userBodyweightKg,
      );
      if (!matched) continue;
      // Dedupe against pending rows. The unique constraint also
      // catches this on insert, but skipping here is cheaper.
      const dedupeKey = `${skill.id}|${workout.id}|${matched.setId}`;
      if (pendingSet.has(dedupeKey)) continue;
      pendingSet.add(dedupeKey);
      out.push({
        skillId: skill.id,
        skillName: skill.name,
        branch: skill.branch,
        tier: skill.tier as 'TIER_1' | 'TIER_2' | 'TIER_3',
        blurb: skill.blurb,
        test,
        matchedSet: matched,
      });
      // One inbox row per (skill, workout) — don't surface the
      // same skill eligible from multiple workouts in the same
      // pass. Break to the next skill.
      break;
    }
  }
  return out;
}