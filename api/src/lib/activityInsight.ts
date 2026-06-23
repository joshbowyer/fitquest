/**
 * Per-activity AI insight. Generates a short coaching analysis of a
 * single workout using:
 *   - The workout's exercises + sets + RPE + duration
 *   - Recent HRV / sleep / soreness / mood context (last 3-7d)
 *   - Recent volume for the same exercises (so we can spot PRs and
 *     deload-needed regressions)
 *
 * The first call per workout creates and caches a row in
 * `ActivityInsight`. Re-calling without `force` returns the cached
 * version. The frontend exposes a "Regenerate" button that passes
 * `force=true` — useful when the user logged HRV or sleep after the
 * first generation.
 *
 * Confidence is reported as 'low' | 'medium' | 'high' so the UI
 * can dim the panel if context is thin (e.g. user just signed up
 * and has no HRV history).
 */
import { z } from 'zod';
import { prisma } from './prisma.js';
import { callLlm, getActiveLlmConfig, type LlmConfig } from './llm.js';

export type RecoveryLoad = 'light' | 'normal' | 'rest';
export type Confidence = 'low' | 'medium' | 'high';

export type InsightFactor = {
  label: string;
  signal: 'positive' | 'negative' | 'neutral';
  weight: number;
  note: string;
};

export const FactorSchema = z.object({
  label: z.string().max(40),
  signal: z.enum(['positive', 'negative', 'neutral']),
  weight: z.number().min(0).max(1),
  note: z.string().max(200),
});

export const InsightPayloadSchema = z.object({
  summary: z.string().max(600),
  qualityScore: z.number().int().min(1).max(10),
  recoveryLoad: z.enum(['light', 'normal', 'rest']),
  confidence: z.enum(['low', 'medium', 'high']),
  factors: z.array(FactorSchema).max(8),
});

export const CURRENT_PROMPT_VERSION = 1;

export type InsightPayload = z.infer<typeof InsightPayloadSchema>;

type GatheredContext = {
  workout: {
    type: string;
    name: string | null;
    durationMin: number | null;
    performedAt: string;
    exercises: Array<{
      name: string;
      sets: Array<{ reps: number; weight: number | null; rpe: number | null; skipped: boolean }>;
    }>;
    setVolume: number;
    avgRpe: number | null;
  };
  context: {
    sleepHours7d: number | null;
    sleepQuality7d: number | null;
    hrv7d: number | null;
    hrvPrior7d: number | null;
    sorenessLatest: number | null;
    moodLatest: number | null;
    energyLatest: number | null;
    stressLatest: number | null;
    weightsLogged7d: number;
    workoutsLast7d: number;
    daysSinceLastSession: number | null;
    exerciseHistory: Record<string, { bestWeight: number; bestReps: number; sessions: number }>;
  };
};

/**
 * Gather the data the LLM will see. Pulls from the workout + the
 * user's recent metrics + their history on the same exercises.
 */
export async function gatherInsightContext(userId: string, workoutId: string): Promise<GatheredContext | null> {
  const w = await prisma.workout.findUnique({
    where: { id: workoutId },
    include: {
      exercises: {
        include: {
          sets: { orderBy: { order: 'asc' } },
        },
      },
    },
  });
  if (!w || w.userId !== userId) return null;

  const since7 = new Date(w.performedAt.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since14 = new Date(w.performedAt.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [
    sleepRows,
    sleepQualityRows,
    hrvLast,
    hrvPrior,
    sorenessRows,
    moodRows,
    energyRows,
    stressRows,
    weightRows,
    workoutsLast7d,
    lastSession,
  ] = await Promise.all([
    prisma.measurement.findMany({
      where: { userId, metric: 'SLEEP_HOURS', recordedAt: { gte: since7, lte: w.performedAt } },
      select: { value: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'SLEEP_QUALITY', recordedAt: { gte: since7, lte: w.performedAt } },
      select: { value: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'HRV', recordedAt: { gte: since7, lte: w.performedAt } },
      select: { value: true },
    }),
    prisma.measurement.findMany({
      where: {
        userId,
        metric: 'HRV',
        recordedAt: { gte: since14, lt: since7 },
      },
      select: { value: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'SORENESS', recordedAt: { lte: w.performedAt } },
      orderBy: { recordedAt: 'desc' },
      take: 3,
      select: { value: true, recordedAt: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'MOOD', recordedAt: { lte: w.performedAt } },
      orderBy: { recordedAt: 'desc' },
      take: 3,
      select: { value: true, recordedAt: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'ENERGY', recordedAt: { lte: w.performedAt } },
      orderBy: { recordedAt: 'desc' },
      take: 3,
      select: { value: true, recordedAt: true },
    }),
    prisma.measurement.findMany({
      where: { userId, metric: 'STRESS', recordedAt: { lte: w.performedAt } },
      orderBy: { recordedAt: 'desc' },
      take: 3,
      select: { value: true, recordedAt: true },
    }),
    prisma.measurement.count({
      where: { userId, metric: 'WEIGHT', recordedAt: { gte: since7, lte: w.performedAt } },
    }),
    prisma.workout.count({
      where: { userId, performedAt: { gte: since7, lt: w.performedAt } },
    }),
    prisma.workout.findFirst({
      where: { userId, performedAt: { lt: w.performedAt } },
      orderBy: { performedAt: 'desc' },
      select: { performedAt: true },
    }),
  ]);

  const exerciseNames = w.exercises.map((e) => e.name).filter(Boolean);
  const exerciseHistory: Record<string, { bestWeight: number; bestReps: number; sessions: number }> = {};
  if (exerciseNames.length > 0) {
    // Find prior sets for these exercises (best weight per exercise
    // + session count) so the LLM can spot PRs and overtraining.
    // Note: `Set` doesn't carry userId directly; we filter via
    // exercise → workout → userId.
    const priorSets = await prisma.set.findMany({
      where: {
        exercise: {
          name: { in: exerciseNames },
          workout: { userId, performedAt: { lt: w.performedAt } },
        },
        completed: true,
        skipped: false,
      },
      include: {
        exercise: { select: { name: true, workout: { select: { id: true } } } },
      },
    });
    for (const s of priorSets) {
      const name = s.exercise.name;
      if (!exerciseHistory[name]) {
        exerciseHistory[name] = { bestWeight: 0, bestReps: 0, sessions: 0 };
      }
      if ((s.weight ?? 0) > exerciseHistory[name].bestWeight) {
        exerciseHistory[name].bestWeight = s.weight ?? 0;
      }
      if ((s.reps ?? 0) > exerciseHistory[name].bestReps) {
        exerciseHistory[name].bestReps = s.reps ?? 0;
      }
    }
    // Session count: distinct workout ids per exercise.
    for (const name of Object.keys(exerciseHistory)) {
      const ids = new Set(
        priorSets.filter((s) => s.exercise.name === name).map((s) => s.exercise.workout.id),
      );
      exerciseHistory[name].sessions = ids.size;
    }
  }

  // Compute set-volume (sum of weight × reps) and avg RPE.
  let setVolume = 0;
  let rpeSum = 0;
  let rpeCount = 0;
  for (const ex of w.exercises) {
    for (const s of ex.sets) {
      if (s.completed && !s.skipped) {
        setVolume += (s.weight ?? 0) * (s.reps ?? 0);
        if (s.rpe != null) {
          rpeSum += s.rpe;
          rpeCount += 1;
        }
      }
    }
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const lastOf = <T extends { recordedAt: Date }>(xs: T[]): number | null => {
    if (xs.length === 0) return null;
    // already ordered desc by recordedAt
    return xs[0].value;
  };
  const daysSinceLastSession = lastSession
    ? Math.round((w.performedAt.getTime() - lastSession.performedAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  return {
    workout: {
      type: w.type,
      name: w.name,
      durationMin: w.duration,
      performedAt: w.performedAt.toISOString(),
      exercises: w.exercises.map((ex) => ({
        name: ex.name,
        sets: ex.sets.map((s) => ({
          reps: s.reps,
          weight: s.weight,
          rpe: s.rpe,
          skipped: !!s.skipped,
        })),
      })),
      setVolume,
      avgRpe: rpeCount > 0 ? rpeSum / rpeCount : null,
    },
    context: {
      sleepHours7d: avg(sleepRows.map((r) => r.value)),
      sleepQuality7d: avg(sleepQualityRows.map((r) => r.value)),
      hrv7d: avg(hrvLast.map((r) => r.value)),
      hrvPrior7d: avg(hrvPrior.map((r) => r.value)),
      sorenessLatest: lastOf(sorenessRows),
      moodLatest: lastOf(moodRows),
      energyLatest: lastOf(energyRows),
      stressLatest: lastOf(stressRows),
      weightsLogged7d: weightRows,
      workoutsLast7d,
      daysSinceLastSession,
      exerciseHistory,
    },
  };
}

const SYSTEM_PROMPT = `You are a calm, evidence-minded training coach reading a single workout log plus the user's recent recovery context. You write like a thoughtful trainer, not a hype bot or a doctor. Never use em-dashes. Never start with "Great" or "Looks like". No emojis. No exclamation marks.

Inputs you'll see:
- workout: type, duration, exercises with sets/reps/weight/RPE, total set-volume, average RPE
- context: last 7d sleep hours + quality, HRV (last 7d vs prior 7d), most recent soreness/mood/energy/stress (1-10), how many weigh-ins in the last 7d, how many other workouts, days since last session, history on each exercise (best weight/reps/sessions)

Your job: score this session and explain why in structured JSON.

Quality score (1-10):
- 8-10: high-output session with good context (sleep ≥7h, HRV stable or rising, low soreness) AND average RPE 7-9 (not a grinder). Volume is reasonable for the user's recent frequency.
- 5-7: solid but with at least one yellow flag — sleep <6.5h, HRV dropped ≥10% vs prior 7d, soreness ≥6, RPE ≥9.5 average (CNS grind), or unusually high volume vs history.
- 1-4: red flags stacked — poor sleep + HRV crash + high soreness + RPE grind, OR volume so high it suggests poor planning.

Recovery load recommendation:
- "rest": next session should be skipped or replaced with walking/mobility. Use when score ≤4 OR two or more red flags stack.
- "light": next session should be a deload — bodyweight, mobility, or 50% volume. Use when score 5-6.
- "normal": proceed as planned. Use when score ≥7.

Confidence:
- "high": HRV data + sleep data + ≥2 weeks of exercise history on the same lifts.
- "medium": at least HRV or sleep, plus some exercise history.
- "low": only the workout itself. Acknowledge the limits in summary.

Factors: array of 2-6 items, each {label, signal: positive|negative|neutral, weight: 0..1, note}.
- label: short, e.g. "Sleep", "HRV trend", "RPE", "Volume vs history", "Soreness", "Days since last session"
- signal: positive = supports a good session, negative = risk, neutral = context
- weight: 0..1 importance
- note: ≤ 140 chars, concrete number when possible

Output strict JSON, no prose, no markdown fences. Schema:
{
  "summary": "2-4 sentences, ≤ 500 chars",
  "qualityScore": 1-10 int,
  "recoveryLoad": "light" | "normal" | "rest",
  "confidence": "low" | "medium" | "high",
  "factors": [
    {"label": "string", "signal": "positive|negative|neutral", "weight": 0.0-1.0, "note": "string"}
  ]
}`;

/**
 * Compute insight, returning the cached row if it exists (unless
 * force=true). On cache miss, gather context, call LLM, persist.
 */
export async function generateActivityInsight(args: {
  userId: string;
  workoutId: string;
  force?: boolean;
}): Promise<{
  insight: {
    id: string;
    workoutId: string;
    summary: string;
    qualityScore: number;
    recoveryLoad: RecoveryLoad;
    confidence: Confidence;
    factors: InsightFactor[];
    model: string | null;
    latencyMs: number | null;
    promptVersion: number;
    createdAt: Date;
    updatedAt: Date;
  };
  cached: boolean;
}> {
  const { userId, workoutId, force } = args;

  if (!force) {
    const existing = await prisma.activityInsight.findUnique({
      where: { workoutId },
    });
    if (existing && existing.promptVersion === CURRENT_PROMPT_VERSION) {
      return {
        insight: rowToInsight(existing),
        cached: true,
      };
    }
  }

  const config = await getActiveLlmConfig();
  if (!config) {
    throw new Error('LLM not configured');
  }

  const ctx = await gatherInsightContext(userId, workoutId);
  if (!ctx) {
    throw new Error('Workout not found');
  }

  const userPrompt = `Workout:\n${JSON.stringify(ctx.workout, null, 2)}\n\nRecent context (window aligned to the workout's performedAt):\n${JSON.stringify(ctx.context, null, 2)}\n\nScore this session. Output strict JSON only.`;

  const start = Date.now();
  const result = await callLlm(config, {
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    maxTokens: 1200,
    temperature: 0.3,
    timeoutMs: 60_000,
    jsonMode: true,
  }, 'activityInsight');
  const latencyMs = Date.now() - start;

  let parsed: InsightPayload | null = null;
  if (result.ok) {
    const raw = extractJson(result.text ?? '');
    if (raw) {
      const check = InsightPayloadSchema.safeParse(raw);
      if (check.success) parsed = check.data;
    }
  }

  // Offline fallback if the LLM fails or returns garbage: build a
  // conservative score from whatever context we have so the user
  // still gets *something* instead of an error.
  if (!parsed) {
    parsed = offlineFallback(ctx);
  }

  // Clamp defensively
  const safe = {
    summary: clamp(parsed.summary, 600),
    qualityScore: clampInt(parsed.qualityScore, 1, 10),
    recoveryLoad: parsed.recoveryLoad as RecoveryLoad,
    confidence: parsed.confidence as Confidence,
    factors: parsed.factors.slice(0, 8).map((f: any) => ({
      label: clamp(f?.label, 40),
      signal: (['positive', 'negative', 'neutral'].includes(f?.signal) ? f.signal : 'neutral') as InsightFactor['signal'],
      weight: Math.max(0, Math.min(1, Number(f?.weight) || 0)),
      note: clamp(f?.note, 200),
    })),
  };

  const row = await prisma.activityInsight.upsert({
    where: { workoutId },
    create: {
      userId,
      workoutId,
      summary: safe.summary,
      qualityScore: safe.qualityScore,
      recoveryLoad: safe.recoveryLoad,
      confidence: safe.confidence,
      factors: JSON.stringify(safe.factors),
      model: result.ok ? (config.model ?? null) : null,
      latencyMs,
      promptVersion: CURRENT_PROMPT_VERSION,
    },
    update: {
      summary: safe.summary,
      qualityScore: safe.qualityScore,
      recoveryLoad: safe.recoveryLoad,
      confidence: safe.confidence,
      factors: JSON.stringify(safe.factors),
      model: result.ok ? (config.model ?? null) : null,
      latencyMs,
      promptVersion: CURRENT_PROMPT_VERSION,
    },
  });

  return { insight: rowToInsight(row), cached: false };
}

function rowToInsight(row: any) {
  return {
    id: row.id,
    workoutId: row.workoutId,
    summary: row.summary,
    qualityScore: row.qualityScore,
    recoveryLoad: row.recoveryLoad as RecoveryLoad,
    confidence: row.confidence as Confidence,
    factors: safeJsonArray(row.factors),
    model: row.model,
    latencyMs: row.latencyMs,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeJsonArray(s: string | null): InsightFactor[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function offlineFallback(ctx: GatheredContext): InsightPayload {
  // Conservative rule-based score from raw context. Used only when
  // the LLM fails so the panel still shows something useful.
  const { workout, context } = ctx;
  let score = 7;
  const factors: InsightFactor[] = [];

  if (context.hrv7d != null && context.hrvPrior7d != null && context.hrvPrior7d > 0) {
    const delta = (context.hrv7d - context.hrvPrior7d) / context.hrvPrior7d;
    if (delta < -0.1) {
      score -= 2;
      factors.push({
        label: 'HRV trend',
        signal: 'negative',
        weight: 0.4,
        note: `HRV down ${(delta * 100).toFixed(0)}% vs prior 7d.`,
      });
    } else if (delta > 0.1) {
      score += 1;
      factors.push({
        label: 'HRV trend',
        signal: 'positive',
        weight: 0.3,
        note: `HRV up ${(delta * 100).toFixed(0)}% vs prior 7d.`,
      });
    }
  }

  if (context.sleepHours7d != null && context.sleepHours7d < 6.5) {
    score -= 1;
    factors.push({
      label: 'Sleep',
      signal: 'negative',
      weight: 0.3,
      note: `Sleep averaged ${context.sleepHours7d.toFixed(1)}h in last 7d.`,
    });
  }

  if (workout.avgRpe != null && workout.avgRpe >= 9) {
    score -= 1;
    factors.push({
      label: 'RPE',
      signal: 'negative',
      weight: 0.3,
      note: `Average RPE ${workout.avgRpe.toFixed(1)} — high CNS load.`,
    });
  }

  if (context.sorenessLatest != null && context.sorenessLatest >= 7) {
    score -= 1;
    factors.push({
      label: 'Soreness',
      signal: 'negative',
      weight: 0.2,
      note: `Most recent soreness ${context.sorenessLatest}/10.`,
    });
  }

  if (factors.length === 0) {
    factors.push({
      label: 'Limited context',
      signal: 'neutral',
      weight: 1,
      note: 'LLM unavailable; scored from raw metrics only.',
    });
  }

  score = clampInt(score, 1, 10);
  return {
    summary: offlineSummary(workout),
    qualityScore: score,
    recoveryLoad: score <= 4 ? 'rest' : score <= 6 ? 'light' : 'normal',
    confidence: 'low',
    factors,
  };
}

/**
 * Build a human-readable summary that reflects the workout's actual
 * structure. Strength / hypertrophy / calisthenics sessions report
 * exercise count + total set volume + average RPE. Cardio sessions
 * report duration + distance (if present). Mobility / other sessions
 * fall back to a generic note.
 */
function offlineSummary(workout: GatheredContext['workout']): string {
  const dur = workout.durationMin;
  const durStr = dur != null && dur > 0 ? `${dur}min ` : '';
  const type = (workout.type || '').toUpperCase();
  if (type === 'CARDIO') {
    return `Offline analysis: ${durStr}cardio session.`;
  }
  if (type === 'MOBILITY' || type === 'OTHER') {
    return `Offline analysis: ${durStr}${type.toLowerCase()} session.`;
  }
  // Strength / hypertrophy / calisthenics.
  const ex = workout.exercises.length;
  const vol = workout.setVolume;
  const rpe = workout.avgRpe != null ? `, avg RPE ${workout.avgRpe.toFixed(1)}` : '';
  return `Offline analysis: ${ex} exercise${ex === 1 ? '' : 's'}, ${vol.toFixed(0)} kg total volume${rpe}.`;
}

export function extractJson(text: string): any | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Strip ```json fences if present
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch { /* fall through */ }
  }
  // Strip leading "Here is the JSON:" prose
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first === -1 || last === -1) return null;
  const candidate = trimmed.slice(first, last + 1);
  try { return JSON.parse(candidate); } catch { return null; }
}

export function clamp(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export function clampInt(n: unknown, min: number, max: number): number {
  const num = Number(n);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, Math.round(num)));
}