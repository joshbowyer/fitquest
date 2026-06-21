/**
 * Spiritual director engine.
 *
 * For each user, on each day:
 *   1. Fetch today's USCCB Mass readings (cached in UsccbDailyReading).
 *   2. Gather a thin slice of the user's recent state (last 3 days:
 *      sleep, recovery, prayer log count, current injuries/skips).
 *   3. Send the LLM a structured prompt asking for a short
 *      reflection that connects the Gospel to the user's state.
 *   4. Cache the result on SpiritualReflection keyed on (user, date).
 *
 * Tone rules in the prompt are intentionally strict. Back-and-forth
 * on them belongs here.
 */

import { prisma } from './prisma.js';
import { callLlm, type LlmConfig } from './llm.js';
import { getDailyReading } from './usccb.js';

// ============================================================================
// PROMPT — edit me
// ============================================================================
//
// The system prompt sets the persona. The user prompt injects the Gospel
// + a thin slice of the user's state. The model is told to return
// strict JSON.
//
// TONE GUIDELINES (used in current draft):
//   - Spiritual director, not preacher. The user is the agent.
//   - Never moralize. Never shame. Never quote scripture at the user
//     as a weapon. The Gospel is a mirror, not a hammer.
//   - Acknowledge what the user is actually carrying (sleep, injuries,
//     streaks, mood) and connect it to the day's passage gently.
//   - When the user is doing well, name it. When they're struggling,
//     name the struggle without diagnosing.
//   - 2-3 sentences for the reflection. ≤ 320 characters total.
//   - Patron suggestion is OPTIONAL and only when there's a real
//     connection (name day, struggle match). Never generic.
//   - The reflection must stand on its own — it will be shown in
//     the /spiritual page above the dailies. It should not require
//     context to understand.
//   - The user is opted in to this section. They logged prayers.
//     Trust them. Don't preach.
//   - If the Gospel and the user's state don't connect, name the
//     dissonance honestly ("the Gospel says X; you said you logged
//     4h of sleep last night — that contrast is worth sitting with")
//     rather than forcing a fit.
//   - Language: English, plain. No "thou" / "thee" / KJV. No Latin
//     unless the user uses it first.
//   - Never use the word "should." Use "you might" / "consider" /
//     "what if" / "it could be worth".
//
// If you change the system prompt, keep the JSON schema stable so the
// parser doesn't break.

const SPIRITUAL_SYSTEM_PROMPT = `You are a spiritual director for a self-hosted RPG-style fitness app's user. They are an adult. They are also a Catholic (or at least Catholic-adjacent: the app surfaces the daily USCCB Mass readings and they have explicitly logged prayers). You are speaking privately to them, not to an audience.

You are NOT:
- A preacher. Do not moralize.
- A doctor or therapist. Do not diagnose. Do not treat sleep loss, depression, anxiety, or injury as spiritual problems.
- A theologian. Do not cite Church documents by name. Do not invoke councils, encyclicals, or canon law.
- A motivational speaker. Do not use the word "should." Do not say "you've got this" or "believe in yourself."

You ARE:
- A spiritual director in the Ignatian tradition: a person who helps another person notice what God is already doing in their ordinary life, without imposing a frame on it.
- Brief. 2-3 sentences for the reflection. No padding.
- Concrete. Name the actual passage and the actual state. Avoid abstractions like "this passage speaks to us about trust" — point at the specific words.
- Honest. If the Gospel and the user's state are dissonant, name that. Don't force a lesson.
- Warm without sentimentality. No exclamation marks. No "Beloved," no "Dear one."

The user has a 3-day view of their own state passed in. You may reference one concrete detail (e.g. "logged 5h of sleep" or "missed prayer twice") — never more than one. You do NOT need to reference their state if the passage speaks for itself.

Patron saint suggestion: include only when there's a real connection (the saint's feast day is the same date; the saint is a patron of the user's current struggle; the passage evokes the saint directly). If no real connection, set the field to an empty string. Never suggest a patron just to fill the field.

Output strict JSON, no prose, no markdown fences. Schema:
{
  "reflection": "2-3 sentences, ≤ 320 characters total, no newlines",
  "patronSuggestion": "Saint's name, OR empty string"
}`;

const SPIRITUAL_USER_PROMPT_TEMPLATE = (data: {
  date: string;
  liturgicalInfo: string;
  gospelRef: string;
  gospel: string;
  userState: {
    class: string | null;
    level: number;
    ordained: boolean;
    sleepLast3Avg: number | null;
    recoveryScore: number | null;
    recentPrayerCount: number;
    recentSkipCount: number;
    recentWorkoutCount: number;
  };
}) => `Today: ${data.date}
Liturgical: ${data.liturgicalInfo}

Gospel (${data.gospelRef}):
${data.gospel}

User state (last 3 days):
- Class: ${data.userState.class ?? 'unclassed'} L${data.userState.level}
- Ordained: ${data.userState.ordained ? 'yes' : 'no'}
- Sleep avg: ${data.userState.sleepLast3Avg != null ? `${data.userState.sleepLast3Avg.toFixed(1)}h` : 'no data'}
- Recovery score: ${data.userState.recoveryScore ?? 'no data'}/100
- Workouts logged: ${data.userState.recentWorkoutCount}
- Prayers logged: ${data.userState.recentPrayerCount}
- Skipped sets (with reason): ${data.userState.recentSkipCount}

Write a 2-3 sentence reflection connecting (or contrasting) the Gospel with the user's state. Return strict JSON.`;

function extractJson(text: string): any | null {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence && fence[1]) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(trimmed.slice(first, last + 1)); } catch {}
  }
  return null;
}

function clamp(s: string, max: number): string {
  if (!s) return '';
  const t = String(s).trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const lastDot = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
  return (lastDot > 60 ? slice.slice(0, lastDot + 1) : slice) + '…';
}

// ---- Public API ----

export type SpiritualReflection = {
  id: string;
  userId: string;
  date: string;
  gospelRef: string;
  gospelText: string;
  liturgicalInfo: string;
  reflection: string;
  patronSuggestion: string;
  model: string | null;
  latencyMs: number | null;
  createdAt: string;
  cached: boolean;
};

function rowToResult(
  row: {
    id: string;
    userId: string;
    date: string;
    gospelRef: string | null;
    gospelText: string | null;
    liturgicalInfo: string | null;
    reflection: string;
    patronSuggestion: string | null;
    model: string | null;
    latencyMs: number | null;
    createdAt: Date;
  },
  cached: boolean,
): SpiritualReflection {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date,
    gospelRef: row.gospelRef ?? '',
    gospelText: row.gospelText ?? '',
    liturgicalInfo: row.liturgicalInfo ?? '',
    reflection: row.reflection,
    patronSuggestion: row.patronSuggestion ?? '',
    model: row.model,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt.toISOString(),
    cached,
  };
}

function todayInTz(timezone: string | null): string {
  const tz = timezone || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function gatherUserState(userId: string) {
  const now = Date.now();
  const since3 = new Date(now - 3 * 24 * 60 * 60 * 1000);
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { class: true, level: true, ordained: true, timezone: true },
  });
  const [sleepLogs, recovery, prayers, skipSets, workouts] = await Promise.all([
    prisma.measurement.findMany({
      where: { userId, metric: 'SLEEP_HOURS', recordedAt: { gte: since3 } },
      select: { value: true },
    }),
    prisma.prayerLog.count({ where: { userId, loggedAt: { gte: since3 } } }),
    prisma.set.count({
      where: {
        skipped: true,
        exercise: { workout: { userId, performedAt: { gte: since3 } } },
      },
    }),
    prisma.workout.count({ where: { userId, performedAt: { gte: since3 } } }),
  ]);
  const sleepLast3Avg = sleepLogs.length
    ? sleepLogs.reduce((s, l) => s + l.value, 0) / sleepLogs.length
    : null;
  // Recovery score: we already have computeRecovery(). Lazy-import to
  // avoid circular deps (recovery.ts imports prisma).
  let recoveryScore: number | null = null;
  try {
    const { computeRecovery } = await import('./recovery.js');
    const r = await computeRecovery(userId);
    recoveryScore = r.score;
  } catch {
    // If recovery fails (no data), just leave null.
  }
  return {
    class: me?.class ?? null,
    level: me?.level ?? 1,
    ordained: me?.ordained ?? false,
    sleepLast3Avg,
    recoveryScore,
    recentPrayerCount: prayers,
    recentSkipCount: skipSets,
    recentWorkoutCount: workouts,
  };
}

export async function getOrGenerateReflection(
  userId: string,
  opts: { force?: boolean } = {},
): Promise<SpiritualReflection | null> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const date = todayInTz(me?.timezone ?? null);

  if (!opts.force) {
    const existing = await prisma.spiritualReflection.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (existing) return rowToResult(existing, true);
  }

  // No USCCB reading for this date (likely too old for the feed window
  // or feed unreachable). Return null so the UI shows "no reading
  // available" rather than fabricating one.
  const reading = await getDailyReading(date);
  if (!reading || !reading.gospel) {
    return null;
  }

  // No LLM configured / disabled — return a stub that surfaces the
  // Gospel but no reflection, so the page still has something to show.
  const cfg = await prisma.llmConfig.findFirst();
  if (!cfg || !cfg.enabled) {
    const stub = await prisma.spiritualReflection.upsert({
      where: { userId_date: { userId, date } },
      create: {
        userId,
        date,
        gospelRef: reading.gospelRef,
        gospelText: reading.gospel,
        liturgicalInfo: reading.liturgicalInfo,
        reflection: '',
        patronSuggestion: '',
        model: null,
        latencyMs: null,
      },
      update: { updatedAt: new Date() },
    });
    return rowToResult(stub, false);
  }

  const config: LlmConfig = {
    provider: cfg.provider as LlmConfig['provider'],
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    enabled: cfg.enabled,
    systemPrompt: cfg.systemPrompt,
  };
  const userState = await gatherUserState(userId);
  const userPrompt = SPIRITUAL_USER_PROMPT_TEMPLATE({
    date,
    liturgicalInfo: reading.liturgicalInfo,
    gospelRef: reading.gospelRef,
    gospel: reading.gospel,
    userState,
  });

  const result = await callLlm(config, {
    system: SPIRITUAL_SYSTEM_PROMPT,
    prompt: userPrompt,
    maxTokens: 600,
    temperature: 0.5,
    timeoutMs: 60_000,
  });

  const parsed = result.ok ? extractJson(result.text ?? '') : null;
  const reflection = clamp(parsed?.reflection ?? '', 320);
  const patronSuggestion = clamp(parsed?.patronSuggestion ?? '', 80);

  const saved = await prisma.spiritualReflection.upsert({
    where: { userId_date: { userId, date } },
    create: {
      userId,
      date,
      gospelRef: reading.gospelRef,
      gospelText: reading.gospel,
      liturgicalInfo: reading.liturgicalInfo,
      reflection,
      patronSuggestion,
      model: result.model || config.model,
      latencyMs: result.latencyMs,
    },
    update: {
      gospelRef: reading.gospelRef,
      gospelText: reading.gospel,
      liturgicalInfo: reading.liturgicalInfo,
      reflection,
      patronSuggestion,
      model: result.model || config.model,
      latencyMs: result.latencyMs,
      updatedAt: new Date(),
    },
  });

  return rowToResult(saved, false);
}
