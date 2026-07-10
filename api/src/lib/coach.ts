/**
 * AI Coach library — personality presets, system prompts, and
 * user-context gathering for /coach/* requests.
 *
 * The 5 personalities below map 1:1 to the CoachPersonality Prisma
 * enum (see schema.prisma). Users pick one in /coach (UI selector)
 * or via PATCH /coach/personality; the chosen value lives on
 * `User.coachPersonality` and drives which COACH_SYSTEM_PROMPT
 * variant is sent to callLlm().
 *
 * Design choices:
 * - **Code, not DB.** The 5 personality voices live here so they're
 *   versioned with the codebase and editable without migrations.
 *   v1.0.39 feedback round: the per-personality admin override
 *   concept (`LlmConfig.coachSystemPromptOverrides`) is removed
 *   from the roadmap. There's exactly one canonical system prompt
 *   per personality, versioned in this file. Editing a voice
 *   means a code change + deploy, which is the right cadence
 *   (personality tuning is a product decision, not an admin
 *   config decision).
 * - **Self-contained tone blocks.** Each prompt has a stable
 *   preamble (role + scope + length) then a personality block
 *   (voice). Frontend should show "demoed against minimax-m3" so
 *   users know the model in use; we don't promise voice parity
 *   across other providers yet.
 * - **Context is JSON, not prose.** The user-context block we
 *   compose for the prompt is a compact JSON blob — LLM-friendly
 *   and easy to debug. About 500 tokens max (mode/hearts/recent
 *   workouts/streak/recovery).
 */
import { prisma, type CoachPersonality } from './prisma.js';
import { todayInTz, localMidnightUtc } from './timezone.js';

/// All available personalities, in display order. The UI iterates
/// this to populate the picker; the order here is the order shown.
export const COACH_PERSONALITIES: Array<{
  key: CoachPersonality;
  label: string;
  blurb: string;
  icon: string;
}> = [
  {
    key: 'PRIEST_BODYBUILDER',
    label: 'Priest Bodybuilder',
    blurb: 'Catholic imagery + hypertrophy talk. The default FitQuest voice.',
    icon: '✝',
  },
  {
    key: 'DRILL_SERGEANT',
    label: 'Drill Sergeant',
    blurb: 'Direct, focused, discipline over comfort. No nonsense.',
    icon: '⚔',
  },
  {
    key: 'BOB_ROSS',
    label: 'Gentle (Bob Ross)',
    blurb: 'Soft, affirming, never negative. Tiny happy little sets.',
    icon: '🌲',
  },
  {
    key: 'ZOOMER',
    label: 'Aesthetic / Zyzz Bro',
    blurb: 'Gym-bro subculture. Memes, vibes, we pump.',
    icon: '⚡',
  },
  {
    key: 'GENERIC',
    label: 'Generic',
    blurb: 'Polite, neutral AI health assistant. The safe default.',
    icon: '◆',
  },
];

/// Stable preamble every personality inherits. The personality
/// block is appended below. Length cap: ~350 tokens per prompt
/// (system) + ~500 tokens context (gathered per request).
const COACH_PREAMBLE = `You are the FitQuest AI Coach — a personal training and habit advisor for one user who has chosen you specifically.

Scope: training programming, recovery, sleep, nutrition, and habit consistency. You do NOT replace a doctor, therapist, or registered dietitian. For injury, pain, mental-health crisis, or medical questions, say so plainly and tell the user to see a qualified professional.

Format:
- Short paragraphs (1-3 sentences each). The chat surface renders markdown, so you can use **bold**, _italic_, \`code\`, and lists when they help.
- Concrete numbers and actions beat vague encouragement. "Add 1 set of dead hangs at the end of your next session" beats "consider working on grip strength".
- Never invent numbers about the user. Use ONLY the numbers in the User context block. If a metric is missing, say so.
- When you cite a recovery / readiness call, name the metric (sleep, soreness, RPE) you used.
- Don't pad. If the user's question can be answered in 2 sentences, answer in 2 sentences.
- No emojis unless the user uses them first.
- Don't repeat the user's question back at them.`;

/// Per-personality voice blocks. Each adds the persona + a couple
/// of voice-marker examples to lock the tone in.
const PERSONALITY_BLOCKS: Record<CoachPersonality, string> = {
  PRIEST_BODYBUILDER: `
Your voice: a parish priest who also deadlifts. Catholic / monastic imagery mixed with hypertrophy. You speak of yoke and burden and stewardship of the body as a gift. You're warm, never preachy, never shaming. You find the small mercy in the data point.

Example voice:
- "Your shoulders are a yoke — load them and reap."
- "Seven hours is enough. The body keeps accounts more carefully than we do; pay the debt or compound the interest."
- "Begin where you are. The first pull-up is in the doorway — five of those are worth more than a missed session at the gym."`,

  DRILL_SERGEANT: `
Your voice: direct, focused, no-fluff. You sound like a Drill Sergeant who actually cares about the troops — discipline, not toxic. You use imperative verbs. You do not coddle.

Example voice:
- "Three sets, last set to failure. Stop when form breaks. Log it."
- "You missed two days. That's done. Tomorrow, get up, get in, get under the bar. Excuses don't recover the streak."
- "Hearts at four means your body is asking for rest. Take the rest day. Show up harder on the other side."`,

  BOB_ROSS: `
Your voice: extremely soft, affirming, never negative. You are Bob Ross crossed with Mr. Rogers — a gentle guide who finds the small good in every data point. You never say "you failed" or "you missed". You say "we'll add a little happy little set" or "tomorrow's a fresh canvas".

Example voice:
- "We'll just add a little happy little 3 sets of 5 here — and any time you make a mistake, it's just a happy little accident."
- "Look at that — you moved 100kg total volume this week. Isn't that beautiful?"
- "Some weeks the body just isn't ready, and that's alright. We'll just let it rest and paint something gentle tomorrow."`,

  ZOOMER: `
Your voice: gym-bro subculture / Zyzz-bro energy. Subcultural slang ("aesthetic", "we pump", "shrek", "withers the rec", "frame", "PR"). Light, motivational, never mean. Memes are welcome when they fit.

Example voice:
- "Aesthetic. We pump. We shrek the deadlift. The wither begins."
- "Bro cooked this week — 4 sessions, no skipped days, frame is improving."
- "You're on a 3-day streak. Don't let the streak die. Touch some iron today. Even 20 minutes counts."`,

  GENERIC: `
Your voice: a polite, neutral AI personal-health assistant. No persona. No memes. No religious imagery. Just clear, evidence-informed coaching with sensible defaults.

Example voice:
- "Based on your last 7 days, you've averaged 2.3 workouts and about 7h of sleep. A reasonable next step is to keep both steady and add one short mobility session."
- "Your RHR is up 4 bpm vs your 30-day baseline — could be under-recovery, dehydration, or just a short-term blip. Worth watching for another week before changing anything."
- "If you're feeling pain in a specific movement, pause it and substitute a similar pattern with less load."`,
};

/// Compose the full SYSTEM_PROMPT for a personality. Preamble +
/// personality block + a small footer about the FitQuest world so
/// the coach doesn't invent workouts / skills that don't exist.
export function coachSystemPrompt(p: CoachPersonality): string {
  const personality = PERSONALITY_BLOCKS[p] ?? PERSONALITY_BLOCKS.GENERIC;
  return `${COACH_PREAMBLE}

PERSONALITY:
${personality}

WORLD CONTEXT:
- FitQuest has 6 classes (PHANTOM / JUGGERNAUT / SCOUT / BERSERKER / TRACER / ORACLE). The user's class is in the context block.
- Skill tree, raid, breach, and boss-fight systems exist but you don't need to recite them. Only reference them when the user's question is about them.
- Casual mode = no penalty for missed workouts, hearts are visual-only. Hardcore mode = graduated heart multiplier on XP/gold. Mode is in the context block.
- The user is talking to you across multiple turns in a single session. Don't ask them to repeat what they already told you this session — read the recent conversation if the API supplies it. (v1 doesn't supply prior turns; the user rephrases each request.)`;
}

/// Default personality for new users (no preference set yet). The
/// roadmap lists the default as PRIEST_BODYBUILDER ("the default
/// FitQuest voice") — when the user opens /coach for the first
/// time, they'll see a personality picker with PRIEST_BODYBUILDER
/// pre-selected.
export const DEFAULT_COACH_PERSONALITY: CoachPersonality = 'PRIEST_BODYBUILDER';

/// Resolve the user's effective personality. Prefers the user's
/// column if set; falls back to DEFAULT_COACH_PERSONALITY. Used by
/// /coach GET (meta) and POST (chat) so the server never has to
/// know what "default" means at the route layer.
export function effectivePersonality(stored: CoachPersonality | null | undefined): CoachPersonality {
  return stored ?? DEFAULT_COACH_PERSONALITY;
}

// =============================================================================
// User context — what the coach knows about the user per request
// =============================================================================
//
// Compact JSON block (~500 tokens) the LLM sees before the user's
// message. Goal: enough to ground advice in real numbers, not so
// much that we blow the context budget. We compute lazily on every
// chat request so the coach always sees fresh data — at the cost
// of a few small DB reads per message. Acceptable trade for v1
// since chat is user-initiated (not high-frequency).
//
// The same pattern is used by morningReport.ts (gatherReportData)
// and spiritualDirector.ts (gatherUserState); this is the coach's
// leaner cousin — only what the coach is likely to USE in a chat
// turn.

// =============================================================================
// User context — what the coach knows about the user per request
// =============================================================================
//
// Compact JSON block (~1500-2000 tokens in typical use) the LLM sees
// before the user's message. Goal: enough to ground advice in real
// numbers AND to let the coach answer "what was my last squat?" or
// "how much caffeine did I have today?" without making the user paste
// it in. We compute lazily on every chat request so the coach always
// sees fresh data — at the cost of a handful of small DB reads per
// message. Acceptable trade for v1 since chat is user-initiated (not
// high-frequency).
//
// Pattern parallels morningReport.ts (gatherReportData) and
// spiritualDirector.ts (gatherUserState); this is the coach's fuller
// cousin — every LLM-facing route reads a different slice of the
// same world, so we keep this file's context shape distinct from
// theirs (no shared types — duplication is cheap, bad coupling is not).

export type CoachRecentWorkout = {
  id: string;
  performedAt: string;        // ISO
  type: string;               // WorkoutType enum value
  durationSec: number | null;  // seconds
  exerciseCount: number;
  totalSets: number;           // completed sets across all exercises
  topExercises: Array<{        // top 3 exercises by total volume
    name: string;
    setCount: number;
    topSet: { reps: number; weight: number } | null;
  }>;
};

export type CoachContext = {
  user: {
    username: string;
    class: string | null;
    level: number;
    xp: number;
    mode: 'CASUAL' | 'HARDCORE';
    hearts: number;
    ordained: boolean;
    goal: string | null;        // cut / maintain / bulk
    heightCm: number | null;
    weightKg: number | null;
    bodyFatPct: number | null;
  };
  timing: {
    userToday: string;          // YYYY-MM-DD in user's tz
    userYesterday: string;
    serverNowIso: string;
  };
  routine: {
    currentStreak: number;
    longestStreak: number;
    weeklyGoal: number;
    thisWeekCount: number;       // Mon-anchored local week
    lastCompletedWeek: string | null;
  };
  recovery: {
    todayScore: number | null;   // 0..100, null if no recent data
  };
  last7Days: {
    workoutCount: number;
    workoutMinutes: number;
    workoutTypes: string[];
    prCount: number;
    avgSleepHours: number | null;
    sleepByDay: Array<{ day: string; hours: number | null }>; // 7 entries, oldest first
  };
  recentWorkouts: CoachRecentWorkout[];     // last 5, newest first
  recentPrs: Array<{
    exercise: string;
    value: number;
    type: string;                // 'ONE_RM' | 'HOLD'
    achievedAt: string;          // ISO
  }>;                              // last 5, newest first
  measurements: {
    // Latest WEIGHT + BODY_FAT_PCT entries (the two the coach is
    // most likely to be asked about). Empty arrays if the user
    // hasn't logged either. Trending not derived — coach can do the
    // math from the rows itself if asked.
    latestWeight: { value: number; recordedAt: string } | null;
    latestBodyFat: { value: number; recordedAt: string } | null;
    // Last 14 WEIGHT rows so the coach can spot trends ("you've
    // been gaining about 0.3kg/week").
    weightTrend14d: Array<{ value: number; recordedAt: string }>;
  };
  substances: {
    /// Per-category counts for the relevant windows. Null = no
    /// logs in that window (treat as "0" in copy).
    caffeineToday: number;
    caffeineThisWeek: number;     // last 7 days
    alcoholThisWeek: number;
    nicotineThisWeek: number;
    electrolyteThisWeek: number;
  };
  habits: {
    /// Last 5 habit logs (any direction) with enough info for the
    /// coach to say "you ticked Stretch (POSITIVE) on Tuesday".
    recent: Array<{
      habitName: string;
      direction: 'POSITIVE' | 'NEGATIVE';
      delta: number;              // +1 / -1
      goldDelta: number;
      xpDelta: number;
      loggedAt: string;
    }>;
    /// Last 7 days count per direction.
    positiveCount7d: number;
    negativeCount7d: number;
  };
  dailies: {
    /// Yesterday's per-daily completion record so the coach can
    /// reference "you missed your morning check-in Tuesday" without
    /// the user pasting the dailies log.
    yesterdayCompletion: Array<{
      dailyKey: string;
      completed: boolean;
      goldDelta: number;
      xpDelta: number;
    }>;
    /// Last 7 days — aggregate completion rate so the coach can
    /// say "you hit 4 of 7 this week".
    completionRate7d: { completed: number; planned: number };
  };
  nutrition: {
    /// Today's totals so the coach can spot "you've only eaten
    /// 800 kcal by 5pm". Null fields = no meals logged today.
    todayCalories: number | null;
    todayProteinG: number | null;
    todayCarbG: number | null;
    todayFatG: number | null;
    todayMealCount: number;
    /// Yesterday's same numbers for "you ate X yesterday" prompts.
    yesterdayCalories: number | null;
  };
  pendingSkills: {
    /// Matches found by the workout-matching pass but not yet
    /// claimed. The coach can prompt "you unlocked a Squat 5×5 PR
    /// yesterday — want to claim it?" without the user asking.
    count: number;
    recent: Array<{
      skillName: string;
      className: string;
      tier: string;
      matchedAt: string;
    }>;                          // last 3
  };
};

export async function gatherCoachContext(userId: string): Promise<CoachContext> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      username: true,
      class: true,
      level: true,
      xp: true,
      mode: true,
      hearts: true,
      ordained: true,
      timezone: true,
      goal: true,
      heightCm: true,
      weightKg: true,
      bodyFatPct: true,
    },
  });
  if (!me) {
    throw new Error('user_not_found');
  }

  const tz = me.timezone ?? null;
  const now = new Date();
  const userToday = todayInTz(tz, now);
  const userYesterday = todayInTz(
    tz,
    new Date(localMidnightUtc(userToday, tz ?? 'UTC').getTime() - 12 * 60 * 60 * 1000),
  );
  const sevenAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // ── Window boundaries (local-tz) ───────────────────────────────────
  const todayStart = localMidnightUtc(userToday, tz ?? 'UTC');
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const yesterdayStart = localMidnightUtc(userYesterday, tz ?? 'UTC');
  const yesterdayEnd = new Date(yesterdayStart.getTime() + 24 * 60 * 60 * 1000);

  // ── Parallel fetches (kept small + scoped to the coach's likely
  //    questions; the full morningReport context is 10× this size) ──

  // Phase 1: the cheap stuff all at once.
  const [
    routine,
    substanceLast7d,
    measurementsSleep,
    measurementsWeight,
    measurementsBodyFat,
    measurementsWeight14d,
    substanceYesterdayToday,
    prs,
    pendingUnlocks,
    mealsToday,
    mealsYesterday,
  ] = await Promise.all([
    prisma.routine.findUnique({
      where: { userId },
      select: {
        currentStreak: true,
        longestStreak: true,
        weeklyGoal: true,
        lastCompletedWeek: true,
      },
    }),
    // Substance counts — groupBy over the last 7d window. Cast
    // category to the enum so Prisma narrows the result type.
    prisma.substanceLog.groupBy({
      by: ['category'],
      where: { userId, loggedAt: { gte: sevenAgo } },
      _count: { _all: true },
    }),
    // Sleep rows (last 7d) — for both avg and per-night series.
    prisma.measurement.findMany({
      where: { userId, metric: 'SLEEP_HOURS' as any, recordedAt: { gte: sevenAgo } },
      select: { value: true, recordedAt: true },
      orderBy: { recordedAt: 'asc' },
    }),
    // Latest weight + a 14-day trend. Latest is "the most recent row".
    prisma.measurement.findFirst({
      where: { userId, metric: 'WEIGHT' as any },
      orderBy: { recordedAt: 'desc' },
      select: { value: true, recordedAt: true },
    }),
    prisma.measurement.findFirst({
      where: { userId, metric: 'BODY_FAT_PCT' as any },
      orderBy: { recordedAt: 'desc' },
      select: { value: true, recordedAt: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'WEIGHT' as any, recordedAt: { gte: fourteenAgo } },
      select: { value: true, recordedAt: true },
      orderBy: { recordedAt: 'asc' },
    }),
    // Caffeine specifically bucketed to yesterday + today (the
    // capped-window caffeine bug we fixed in morningReport.ts is
    // repeated here intentionally — the coach needs both views).
    prisma.substanceLog.groupBy({
      by: ['category'],
      where: { userId, loggedAt: { gte: yesterdayStart, lt: todayEnd } },
      _count: { _all: true },
    }),
    // Recent PRs (last 5). achievementDate ordering.
    prisma.pr.findMany({
      where: { userId },
      orderBy: { achievedAt: 'desc' },
      take: 5,
      select: { exercise: true, value: true, type: true, achievedAt: true },
    }),
    // Pending skill unlocks (matched but not claimed).
    prisma.pendingSkillUnlock.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 3,
      include: { skill: { select: { name: true, className: true, tier: true } } },
    }),
    prisma.mealEntry.aggregate({
      where: { userId, loggedAt: { gte: todayStart, lt: todayEnd } },
      _sum: {
        servings: true,
      },
      _count: { _all: true },
    }),
    prisma.mealEntry.aggregate({
      where: { userId, loggedAt: { gte: yesterdayStart, lt: yesterdayEnd } },
      _sum: { servings: true },
      _count: { _all: true },
    }),
  ]);

  // Pending skill count (separate query — the take:3 above gives us
  // the recent list but not the total).
  const pendingSkillCount = await prisma.pendingSkillUnlock.count({
    where: { userId },
  });

  // ── Compute recovery today (best-effort; module throws if data
  //    missing — coach works fine with null) ─────────────────────
  let recoveryScore: number | null = null;
  try {
    const { computeRecovery } = await import('./recovery.js');
    const r = await computeRecovery(userId);
    recoveryScore = r.score;
  } catch {
    recoveryScore = null;
  }

  // ── Recent workouts (last 5, newest first) — this is the heaviest
  //    query: includes exercises + sets to summarize "top exercises
  //    by volume" per workout. Limited to 5 to keep the prompt bounded. ──
  const recentWorkoutRows = await prisma.workout.findMany({
    where: { userId },
    orderBy: { performedAt: 'desc' },
    take: 5,
    include: {
      exercises: {
        select: {
          name: true,
          sets: {
            where: { completed: true },
            select: { reps: true, weight: true },
          },
        },
      },
    },
  });
  const recentWorkouts: CoachRecentWorkout[] = recentWorkoutRows.map((w) => {
    const exerciseSummaries = w.exercises.map((ex) => {
      const completedSets = ex.sets;
      const totalSets = completedSets.length;
      // "top set" = the set with the highest volume (reps × weight).
      // For bodyweight exercises where weight is null, fall back to
      // reps alone.
      let topSet: { reps: number; weight: number } | null = null;
      let topVolume = -1;
      for (const s of completedSets) {
        const w = s.weight ?? 0;
        const v = s.reps * (w > 0 ? w : 1);
        if (v > topVolume) {
          topVolume = v;
          topSet = { reps: s.reps, weight: s.weight ?? 0 };
        }
      }
      return { name: ex.name, setCount: totalSets, topSet };
    });
    // Top 3 exercises by set count (proxy for "what was this session
    // really about"). The coach can ask "what did I squat" and the
    // answer is right there.
    const topExercises = [...exerciseSummaries]
      .sort((a, b) => b.setCount - a.setCount)
      .slice(0, 3);
    const totalSets = exerciseSummaries.reduce((s, e) => s + e.setCount, 0);
    return {
      id: w.id,
      performedAt: w.performedAt.toISOString(),
      type: w.type,
      durationSec: w.durationSec,
      exerciseCount: w.exercises.length,
      totalSets,
      topExercises,
    };
  });

  // ── Last 7d counts derived from the workouts subset (not a second
  //    workout.findMany) ───────────────────────────────────────────
  const recent7dWorkouts = recentWorkoutRows.filter(
    (w) => w.performedAt >= sevenAgo,
  );
  const last7Days = {
    workoutCount: recent7dWorkouts.length,
    workoutMinutes: Math.round(recent7dWorkouts.reduce(
      (s, w) => s + (w.durationSec ?? 0),
      0,
    ) / 60),
    workoutTypes: Array.from(new Set(recent7dWorkouts.map((w) => w.type))).sort(),
    prCount: prs.filter((p) => p.achievedAt >= sevenAgo).length,
    avgSleepHours: measurementsSleep.length > 0
      ? Math.round(
          (measurementsSleep.reduce((s, r) => s + r.value, 0) / measurementsSleep.length) * 10,
        ) / 10
      : null,
    // Per-night sleep series for the last 7 LOCAL days (oldest
    // first). Bucketed by local-date so a 1am Monday sleep logs as
    // Sunday's row (see morningReport.ts for the same convention).
    sleepByDay: buildSleepByDaySeries(measurementsSleep, sevenAgo, userToday, tz),
  };

  // ── Habits ────────────────────────────────────────────────────────
  const habitRows = await prisma.habitLog.findMany({
    where: { userId, loggedAt: { gte: sevenAgo } },
    orderBy: { loggedAt: 'desc' },
    take: 5,
    include: { habit: { select: { name: true, direction: true } } },
  });
  const positiveCount7d = await prisma.habitLog.count({
    where: {
      userId,
      loggedAt: { gte: sevenAgo },
      habit: { direction: 'POSITIVE' as any },
    },
  });
  const negativeCount7d = await prisma.habitLog.count({
    where: {
      userId,
      loggedAt: { gte: sevenAgo },
      habit: { direction: 'NEGATIVE' as any },
    },
  });
  const habits = {
    recent: habitRows.map((h) => ({
      habitName: h.habit.name,
      direction: h.habit.direction as 'POSITIVE' | 'NEGATIVE',
      delta: h.delta,
      goldDelta: h.goldDelta,
      xpDelta: h.xpDelta,
      loggedAt: h.loggedAt.toISOString(),
    })),
    positiveCount7d,
    negativeCount7d,
  };

  // ── Dailies (yesterday's per-daily status + 7d completion rate) ──
  const dailyLogsYesterday = await prisma.dailyLog.findMany({
    where: {
      userId,
      loggedAt: { gte: yesterdayStart, lt: yesterdayEnd },
    },
    select: { dailyKey: true, goldDelta: true, xpDelta: true },
  });
  const dailyLogs7d = await prisma.dailyLog.findMany({
    where: { userId, loggedAt: { gte: sevenAgo } },
    select: { dailyKey: true },
  });
  const activeDailyCount = await prisma.daily.count({
    where: { userId, archived: false },
  });
  // "Planned" = unique dailyKeys the user has touched in the last
  // 7d OR the active-daily count if they've never used the system.
  // Either way it's a denominator — exact value doesn't matter for
  // coaching copy ("you hit 4/7").
  const plannedDailyKeyCount = new Set(dailyLogs7d.map((l) => l.dailyKey)).size
    || activeDailyCount;
  const dailies = {
    yesterdayCompletion: dailyLogsYesterday.map((l) => ({
      dailyKey: l.dailyKey,
      completed: true,
      goldDelta: l.goldDelta,
      xpDelta: l.xpDelta,
    })),
    // Include the configured but-not-yesterday'd dailies too, so
    // the coach can see "you missed your 'Water' daily yesterday".
    // For v1 we just surface the yesterday logs — the "planned but
    // missed" list can come from a `configuredKeys - loggedKeys`
    // diff that the route could compute on demand if asked.
    completionRate7d: {
      completed: new Set(dailyLogs7d.map((l) => l.dailyKey)).size,
      planned: Math.max(plannedDailyKeyCount, 1),
    },
  };

  // ── Substances ────────────────────────────────────────────────────
  // The two groupBy queries above give us 7d totals (caffeine/alcohol/
  // nicotine/electrolyte) and yesterday+today combined. We split
  // caffeine from the yesterday groupBy into "today" vs "yesterday"
  // by re-bucketing on the local-day key for each row. (groupBy
  // doesn't directly bucket by local-day since the enum groupBy is
  // cheaper; we accept the second pass for caffeine only.)
  const yesterdayTodayCaffeineRows = await prisma.substanceLog.findMany({
    where: {
      userId,
      category: 'CAFFEINE',
      loggedAt: { gte: yesterdayStart, lt: todayEnd },
    },
    select: { loggedAt: true },
  });
  const todayStartMs = todayStart.getTime();
  const todayEndMs = todayEnd.getTime();
  let caffeineToday = 0;
  for (const r of yesterdayTodayCaffeineRows) {
    const ms = r.loggedAt.getTime();
    if (ms >= todayStartMs && ms < todayEndMs) caffeineToday++;
  }
  const countByCat = (cat: string) =>
    substanceLast7d.find((c) => c.category === cat)?._count?._all ?? 0;
  const substances = {
    caffeineToday,
    caffeineThisWeek: countByCat('CAFFEINE'),
    alcoholThisWeek: countByCat('ALCOHOL'),
    nicotineThisWeek: countByCat('NICOTINE'),
    electrolyteThisWeek: countByCat('ELECTROLYTE'),
  };

  // ── Nutrition: today's meal totals. Sum of (servings × FoodItem
  //    macros) per mealEntry. mealEntry.servings is a multiplier on
  //    the underlying FoodItem's calories/protein/carb/fat. We do
  //    the join here because MealEntry doesn't carry the macros
  //    directly — they're on the joined FoodItem.
  const nutrition = await aggregateNutrition(mealsToday, mealsYesterday, userId, todayStart, todayEnd, yesterdayStart, yesterdayEnd);

  // ── Pending skills (already loaded) ───────────────────────────────
  const pendingSkills = {
    count: pendingSkillCount,
    recent: pendingUnlocks.map((u) => ({
      skillName: u.skill.name,
      className: u.skill.className,
      tier: u.skill.tier,
      matchedAt: u.createdAt.toISOString(),
    })),
  };

  // ── Routine this-week count (Mon-anchored local week) ───────────
  let thisWeekCount = 0;
  if (routine) {
    const weekStart = localMidnightUtc(userToday, tz ?? 'UTC');
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    thisWeekCount = await prisma.workout.count({
      where: { userId, performedAt: { gte: weekStart, lt: weekEnd } },
    });
  }

  return {
    user: {
      username: me.username,
      class: me.class,
      level: me.level,
      xp: me.xp,
      mode: (me.mode as 'CASUAL' | 'HARDCORE') ?? 'CASUAL',
      hearts: me.hearts,
      ordained: me.ordained,
      goal: me.goal,
      heightCm: me.heightCm,
      weightKg: me.weightKg,
      bodyFatPct: me.bodyFatPct,
    },
    timing: {
      userToday,
      userYesterday,
      serverNowIso: now.toISOString(),
    },
    routine: {
      currentStreak: routine?.currentStreak ?? 0,
      longestStreak: routine?.longestStreak ?? 0,
      weeklyGoal: routine?.weeklyGoal ?? 3,
      thisWeekCount,
      lastCompletedWeek: routine?.lastCompletedWeek ?? null,
    },
    recovery: { todayScore: recoveryScore },
    last7Days,
    recentWorkouts,
    recentPrs: prs.map((p) => ({
      exercise: p.exercise,
      value: p.value,
      type: p.type,
      achievedAt: p.achievedAt.toISOString(),
    })),
    measurements: {
      latestWeight: measurementsWeight
        ? { value: measurementsWeight.value, recordedAt: measurementsWeight.recordedAt.toISOString() }
        : null,
      latestBodyFat: measurementsBodyFat
        ? { value: measurementsBodyFat.value, recordedAt: measurementsBodyFat.recordedAt.toISOString() }
        : null,
      weightTrend14d: measurementsWeight14d.map((m) => ({
        value: m.value,
        recordedAt: m.recordedAt.toISOString(),
      })),
    },
    substances,
    habits,
    dailies,
    nutrition,
    pendingSkills,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/// Bucket sleep rows by local-day key (oldest first) for the last
/// `days` local days, filling missing days with null. The morning
/// report uses the same convention — see streakDomain in morningReport.ts.
function buildSleepByDaySeries(
  sleepRows: Array<{ value: number; recordedAt: Date }>,
  sevenAgo: Date,
  userToday: string,
  tz: string | null,
): Array<{ day: string; hours: number | null }> {
  // Build day-key → value map from the rows (last value per day wins).
  const byDay = new Map<string, number>();
  for (const r of sleepRows) {
    if (r.recordedAt < sevenAgo) continue;
    const key = todayInTz(tz, r.recordedAt);
    byDay.set(key, r.value);
  }
  // Walk the 7-day window from sevenAgo's local-day up to userToday.
  const out: Array<{ day: string; hours: number | null }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(localMidnightUtc(userToday, tz ?? 'UTC').getTime() - i * 24 * 60 * 60 * 1000);
    const key = todayInTz(tz, d);
    out.push({ day: key, hours: byDay.get(key) ?? null });
  }
  return out;
}

/// Compute today's + yesterday's meal-totals. MealEntry carries
/// `servings` (a multiplier) + a FK to FoodItem (which has the
/// per-serving macros). The aggregate we did above only returned
/// `_count` + `_sum.servings`; we need the actual FoodItem join to
/// sum calories/protein/carb/fat. Cheap because the mealEntry set
/// per day is small.
async function aggregateNutrition(
  _mealsTodayAgg: { _sum: { servings: number | null }; _count: { _all: number } },
  _mealsYesterdayAgg: { _sum: { servings: number | null }; _count: { _all: number } },
  userId: string,
  todayStart: Date,
  todayEnd: Date,
  yesterdayStart: Date,
  yesterdayEnd: Date,
): Promise<CoachContext['nutrition']> {
  const sumMacros = async (from: Date, to: Date) => {
    const rows = await prisma.mealEntry.findMany({
      where: { userId, loggedAt: { gte: from, lt: to } },
      select: {
        servings: true,
        food: {
          select: {
            calories: true,
            proteinG: true,
            carbG: true,
            fatG: true,
          },
        },
      },
    });
    let cal = 0;
    let pro = 0;
    let carb = 0;
    let fat = 0;
    let count = 0;
    for (const r of rows) {
      const s = r.servings ?? 1;
      cal += r.food.calories * s;
      pro += r.food.proteinG * s;
      carb += r.food.carbG * s;
      fat += r.food.fatG * s;
      count++;
    }
    return {
      calories: count > 0 ? Math.round(cal) : null,
      proteinG: count > 0 ? Math.round(pro) : null,
      carbG: count > 0 ? Math.round(carb) : null,
      fatG: count > 0 ? Math.round(fat) : null,
      mealCount: count,
    };
  };
  const today = await sumMacros(todayStart, todayEnd);
  const yesterday = await sumMacros(yesterdayStart, yesterdayEnd);
  return {
    todayCalories: today.calories,
    todayProteinG: today.proteinG,
    todayCarbG: today.carbG,
    todayFatG: today.fatG,
    todayMealCount: today.mealCount,
    yesterdayCalories: yesterday.calories,
  };
}