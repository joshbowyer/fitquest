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
 * - **Code, not DB.** Prompts live here so they're versioned with
 *   the codebase and editable without migrations. The roadmap item
 *   `LlmConfig.coachSystemPromptOverrides` (admin-side overrides
 *   keyed by personality) is the next step — when that ships, this
 *   file becomes the FALLBACK and the admin override wins.
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

export type CoachContext = {
  user: {
    username: string;
    class: string | null;
    level: number;
    xp: number;
    mode: 'CASUAL' | 'HARDCORE';
    hearts: number;
    ordained: boolean;
  };
  timing: {
    userToday: string;          // YYYY-MM-DD in user's tz
    serverNowIso: string;        // full ISO for age-of-data math
  };
  last7Days: {
    workoutCount: number;
    workoutMinutes: number;
    workoutTypes: string[];      // distinct workout.type values
    prCount: number;             // PRs hit in last 7d
    avgSleepHours: number | null;
  };
  routine: {
    currentStreak: number;
    longestStreak: number;
    weeklyGoal: number;
    thisWeekCount: number;
  };
  recovery: {
    todayScore: number | null;   // 0..100, null if no recent data
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
    },
  });
  if (!me) {
    throw new Error('user_not_found');
  }

  const tz = me.timezone ?? null;
  const now = new Date();
  const userToday = todayInTz(tz, now);
  const sevenAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Parallel fetch: workouts + a sleep summary + the routine
  // state + today's recovery. Recovery is its own module so we
  // skip if it throws — the coach works fine with `null` recovery.
  const [workouts, routine, recoveryScore] = await Promise.all([
    prisma.workout.findMany({
      where: { userId, performedAt: { gte: sevenAgo } },
      select: { type: true, duration: true },
    }),
    prisma.routine.findUnique({
      where: { userId },
      select: { currentStreak: true, longestStreak: true, weeklyGoal: true },
    }),
    (async () => {
      try {
        const { computeRecovery } = await import('./recovery.js');
        const r = await computeRecovery(userId);
        return r.score;
      } catch {
        return null;
      }
    })(),
  ]);

  // PRs in last 7d — cheap count. We don't fetch PR rows because
  // the count is enough for "any PRs this week?" questions.
  const prCount = await prisma.pr.count({
    where: { userId, achievedAt: { gte: sevenAgo } },
  });

  // Sleep avg for last 7d. Measurement rows are tagged with the
  // user's tz (see recovery.ts); we average the last 7 by day.
  const sleepRows = await prisma.measurement.findMany({
    where: { userId, metric: 'SLEEP_HOURS' as any, recordedAt: { gte: sevenAgo } },
    select: { value: true },
  });
  const avgSleep = sleepRows.length > 0
    ? Math.round((sleepRows.reduce((s, r) => s + r.value, 0) / sleepRows.length) * 10) / 10
    : null;

  // Routine this-week count — duplicate of morningReport's
  // streakDomain but cheap enough to inline.
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
    },
    timing: {
      userToday,
      serverNowIso: now.toISOString(),
    },
    last7Days: {
      workoutCount: workouts.length,
      workoutMinutes: workouts.reduce((s, w) => s + (w.duration ?? 0), 0),
      workoutTypes: Array.from(new Set(workouts.map((w) => w.type))).sort(),
      prCount,
      avgSleepHours: avgSleep,
    },
    routine: {
      currentStreak: routine?.currentStreak ?? 0,
      longestStreak: routine?.longestStreak ?? 0,
      weeklyGoal: routine?.weeklyGoal ?? 3,
      thisWeekCount,
    },
    recovery: {
      todayScore: recoveryScore,
    },
  };
}