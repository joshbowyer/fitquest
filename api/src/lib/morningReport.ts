/**
 * Morning report engine.
 *
 * Generates a per-user, per-day LLM-driven summary of the last 7 days
 * vs. the prior 7 days, broken out by domain. The output lands in a
 * `MorningReport` row keyed on (userId, date) so the dashboard can
 * pull it instantly and we don't re-LLM every page load.
 *
 * Trigger flow:
 *   - First /me after 5am local (in the web auth refresh path, future)
 *   - Gadgetbridge sync (future — for now, manual + the 5am hook)
 *   - User hits "Regenerate" button on the dashboard card
 *
 * Data we feed the LLM (computed server-side, no PII leakage beyond
 * the user's own data — this is a single-tenant self-hosted app):
 *   - Sleep: avg hours + quality (7d vs prior 7d)
 *   - HRV: avg ms
 *   - Body comp: avg weight, avg body fat
 *   - Workouts: count, total volume, total minutes, by type
 *   - Habits: net +/- deltas
 *   - Supplements: adherence %
 *   - Spiritual: prayers logged, days hit
 *   - Recovery score (existing)
 *
 * Output: structured JSON with one short string per domain + a
 * risk_flags array. If the LLM returns anything other than valid
 * JSON, we fall back to a stub report so the dashboard never breaks.
 */

import { prisma } from './prisma.js';
import { callLlm, type LlmConfig } from './llm.js';
import { computeRecovery } from './recovery.js';

type DateStr = string; // YYYY-MM-DD in user's timezone

// ---- Aggregation ----

type Domain = {
  /** Average of the metric in the last 7 days. null if not enough data. */
  last7: number | null;
  /** Average in the prior 7 days. null if not enough data. */
  prior7: number | null;
  /** % delta from prior to last. null if either side missing. */
  deltaPct: number | null;
  /** Number of days with data in the last 7d window. */
  coverageDays: number;
};

function pctDelta(last: number | null, prior: number | null): number | null {
  if (last == null || prior == null || prior === 0) return null;
  return Math.round(((last - prior) / Math.abs(prior)) * 100);
}

async function metricDomain(
  userId: string,
  metric: string,
  since7: Date,
  since14: Date,
): Promise<Domain> {
  const last = await prisma.measurement.findMany({
    where: { userId, metric: metric as any, recordedAt: { gte: since7 } },
    select: { value: true, recordedAt: true },
  });
  const prior = await prisma.measurement.findMany({
    where: {
      userId,
      metric: metric as any,
      recordedAt: { gte: since14, lt: since7 },
    },
    select: { value: true },
  });
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  return {
    last7: avg(last.map((m) => m.value)),
    prior7: avg(prior.map((m) => m.value)),
    deltaPct: pctDelta(avg(last.map((m) => m.value)), avg(prior.map((m) => m.value))),
    coverageDays: new Set(last.map((m) => m.recordedAt.toISOString().slice(0, 10))).size,
  };
}

async function workoutsDomain(userId: string, since7: Date, since14: Date) {
  const last = await prisma.workout.findMany({
    where: { userId, performedAt: { gte: since7 } },
    select: {
      type: true,
      duration: true,
      exercises: {
        select: {
          sets: {
            where: { completed: true, skipped: false },
            select: { weight: true, reps: true },
          },
        },
      },
    },
  });
  const prior = await prisma.workout.findMany({
    where: { userId, performedAt: { gte: since14, lt: since7 } },
    select: { type: true, duration: true, exercises: { select: { sets: { select: { weight: true, reps: true } } } } },
  });
  const sum = (xs: typeof last) => {
    const vol = xs.reduce(
      (s, w) =>
        s + w.exercises.reduce((ss, ex) => ss + ex.sets.reduce((sss, st) => sss + (st.weight ?? 0) * (st.reps ?? 0), 0), 0),
      0,
    );
    const min = xs.reduce((s, w) => s + (w.duration ?? 0), 0) / 60;
    const byType: Record<string, number> = {};
    for (const w of xs) byType[w.type] = (byType[w.type] ?? 0) + 1;
    return { count: xs.length, volume: vol, minutes: min, byType };
  };
  const l = sum(last);
  const p = sum(prior);
  return {
    last7: l,
    prior7: p,
    deltaPct: pctDelta(l.volume, p.volume),
    coverageDays: new Set(),
  };
}

async function habitsDomain(userId: string, since7: Date, since14: Date) {
  const [last, prior] = await Promise.all([
    prisma.habitLog.findMany({
      where: { userId, loggedAt: { gte: since7 } },
      include: { habit: { select: { direction: true } } },
    }),
    prisma.habitLog.findMany({
      where: { userId, loggedAt: { gte: since14, lt: since7 } },
      include: { habit: { select: { direction: true } } },
    }),
  ]);
  // HabitLog.delta is already signed (+1 for positive check, -1 for
  // negative check). The Habit.direction is just a UI label.
  const net = (xs: typeof last) => xs.reduce((s, l) => s + l.delta, 0);
  const lastNet = net(last);
  const priorNet = net(prior);
  return {
    last7: lastNet,
    prior7: priorNet,
    deltaPct: pctDelta(lastNet, priorNet),
    coverageDays: new Set(last.map((l) => l.loggedAt.toISOString().slice(0, 10))).size,
  };
}

async function supplementsDomain(userId: string, since7: Date) {
  // SupplementLog uses takenAt, not loggedAt.
  const logs = await prisma.supplementLog.findMany({
    where: { userId, takenAt: { gte: since7 } },
  });
  const days = new Set(logs.map((l) => l.takenAt.toISOString().slice(0, 10))).size;
  return { daysLogged: days, total: logs.length, adherencePct: Math.round((days / 7) * 100) };
}

async function spiritualDomain(userId: string, since7: Date) {
  const [prayers, customs] = await Promise.all([
    prisma.prayerLog.findMany({
      where: { userId, loggedAt: { gte: since7 } },
      select: { type: true, durationMin: true, loggedAt: true },
    }),
    prisma.dailyLog.findMany({
      where: { daily: { category: 'SPIRITUAL' }, userId, loggedAt: { gte: since7 } },
      select: { loggedAt: true },
    }),
  ]);
  const days = new Set(
    [...prayers.map((p) => p.loggedAt.toISOString().slice(0, 10)), ...customs.map((c) => c.loggedAt.toISOString().slice(0, 10))],
  ).size;
  return {
    prayerCount: prayers.length,
    customDays: customs.length,
    daysHit: days,
    totalMinutes: prayers.reduce((s, p) => s + (p.durationMin ?? 0), 0),
  };
}

export type ReportPayload = {
  generatedAt: string; // ISO
  user: { class: string | null; level: number; xp: number; ordained: boolean };
  sleep: Domain;
  sleepQuality: Domain;
  hrv: Domain;
  weight: Domain;
  bodyFat: Domain;
  workouts: Awaited<ReturnType<typeof workoutsDomain>>;
  habits: Awaited<ReturnType<typeof habitsDomain>>;
  supplements: Awaited<ReturnType<typeof supplementsDomain>>;
  spiritual: Awaited<ReturnType<typeof spiritualDomain>>;
  recovery: { score: number | null; trend: number | null };
};

function todayInTz(timezone: string | null): DateStr {
  // Returns YYYY-MM-DD in the user's timezone. Server default = UTC.
  const tz = timezone || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function gatherReportData(
  userId: string,
  opts: { timezone?: string | null } = {},
): Promise<ReportPayload> {
  const now = new Date();
  const since7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { class: true, level: true, xp: true, ordained: true, timezone: true },
  });
  const recovery = await computeRecovery(userId);

  const [sleep, sleepQuality, hrv, weight, bodyFat, workouts, habits, supplements, spiritual] =
    await Promise.all([
      metricDomain(userId, 'SLEEP_HOURS', since7, since14),
      metricDomain(userId, 'SLEEP_QUALITY', since7, since14),
      metricDomain(userId, 'HRV', since7, since14),
      metricDomain(userId, 'WEIGHT', since7, since14),
      metricDomain(userId, 'BODY_FAT_PCT', since7, since14),
      workoutsDomain(userId, since7, since14),
      habitsDomain(userId, since7, since14),
      supplementsDomain(userId, since7),
      spiritualDomain(userId, since7),
    ]);

  return {
    generatedAt: now.toISOString(),
    user: {
      class: me?.class ?? null,
      level: me?.level ?? 1,
      xp: me?.xp ?? 0,
      ordained: me?.ordained ?? false,
    },
    sleep,
    sleepQuality,
    hrv,
    weight,
    bodyFat,
    workouts,
    habits,
    supplements,
    spiritual,
    recovery: { score: recovery.score, trend: null },
  };
}

// ---- LLM call ----

const SYSTEM_PROMPT = `You are the user's quiet, sharp fitness coach in a self-hosted RPG-style training app. You are NOT a hype-bot, NOT a doctor, NOT a therapist. You write like a thoughtful trainer who actually reads the numbers.

Your job: read the structured data the user logged in the last 7 days (versus the prior 7) and produce a short morning briefing. Tone: direct, concrete, not clinical. Never use em-dashes. Never start with "Great" or "Looks like". If a metric was steady, say so briefly or stay silent — do not invent patterns.

Hard rules:
- Each section ≤ 2 sentences, ≤ 220 characters.
- If a domain has no data (coverageDays: 0), the field MUST be an empty string. Do not fabricate.
- If a domain is steady (delta < 5%), the field should be empty or one short acknowledgment.
- Risk flags: only call out things that are actually present in the data. Empty array if all clear.
- Never use the user's real name; refer to them as "you".
- Never recommend specific supplements or medical interventions.
- Mention concrete numbers from the data when relevant ("HRV averaged 52ms, down 6 from prior 7d").
- For spiritual: do not preach. If the user logged prayers, note it warmly. If not, stay silent (the user opted into this section).
- For weight: never comment on weight gain/loss direction unless it's a clear trend (>2% delta). Body comp is sensitive.

Output: strict JSON object, no prose, no markdown fences. Schema:
{
  "general": "string or empty",
  "sleep": "string or empty",
  "training": "string or empty",
  "recovery": "string or empty",
  "nutrition": "string or empty",
  "spiritual": "string or empty",
  "risk_flags": ["string", "string"]
}`;

function extractJson(text: string): any | null {
  // Robust extractor: handles ```json fences, leading prose, and
  // trailing commentary. Returns parsed object or null.
  const trimmed = text.trim();
  // Try direct parse first
  try {
    return JSON.parse(trimmed);
  } catch {}
  // Try stripping ```json fences
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence && fence[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {}
  }
  // Try finding the first { ... last } span
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {}
  }
  return null;
}

function clamp(s: string | null | undefined, max: number): string {
  if (!s) return '';
  const t = String(s).trim();
  if (t.length <= max) return t;
  // Trim to last sentence boundary within the limit
  const slice = t.slice(0, max);
  const lastDot = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
  return (lastDot > 40 ? slice.slice(0, lastDot + 1) : slice) + '…';
}

const EMPTY_FALLBACK = {
  general: '',
  sleep: '',
  training: '',
  recovery: '',
  nutrition: '',
  spiritual: '',
  risk_flags: [] as string[],
};

// ---- Public API ----

export type MorningReportResult = {
  id: string;
  userId: string;
  date: string;
  general: string;
  sleep: string;
  training: string;
  recovery: string;
  nutrition: string;
  spiritual: string;
  riskFlags: string[];
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
    general: string | null;
    sleep: string | null;
    training: string | null;
    recovery: string | null;
    nutrition: string | null;
    spiritual: string | null;
    riskFlags: string | null;
    model: string | null;
    latencyMs: number | null;
    createdAt: Date;
  },
  cached: boolean,
): MorningReportResult {
  let flags: string[] = [];
  try {
    if (row.riskFlags) {
      const parsed = JSON.parse(row.riskFlags);
      if (Array.isArray(parsed)) flags = parsed.map((x) => String(x));
    }
  } catch {}
  return {
    id: row.id,
    userId: row.userId,
    date: row.date,
    general: row.general ?? '',
    sleep: row.sleep ?? '',
    training: row.training ?? '',
    recovery: row.recovery ?? '',
    nutrition: row.nutrition ?? '',
    spiritual: row.spiritual ?? '',
    riskFlags: flags,
    model: row.model,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt.toISOString(),
    cached,
  };
}

/**
 * Get today's morning report. Generates a new one if none exists OR
 * if the existing one is missing a field. Returns the existing row
 * if it has all 6 fields populated.
 */
export async function getOrGenerateToday(
  userId: string,
  opts: { force?: boolean; timezone?: string | null } = {},
): Promise<MorningReportResult | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const date = todayInTz(opts.timezone ?? user?.timezone ?? null);

  if (!opts.force) {
    const existing = await prisma.morningReport.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (existing && existing.general !== null) {
      return rowToResult(existing, true);
    }
  }

  // No LlmConfig saved / disabled — return empty so the dashboard
  // doesn't show a stale card. The /admin page should already be
  // hinting at the missing config.
  const cfg = await prisma.llmConfig.findFirst();
  if (!cfg || !cfg.enabled) {
    // Store a row with all-null fields so we don't re-check on every
    // dashboard load. TTL: until the user enables the config.
    const stub = await prisma.morningReport.upsert({
      where: { userId_date: { userId, date } },
      create: {
        userId,
        date,
        general: '',
        sleep: '',
        training: '',
        recovery: '',
        nutrition: '',
        spiritual: '',
        riskFlags: '[]',
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

  const payload = await gatherReportData(userId, { timezone: user?.timezone });
  const dataJson = JSON.stringify(payload, null, 2);
  const userPrompt = `Today's date: ${date}\nUser profile: ${JSON.stringify(payload.user)}\n\nLast 7 days vs prior 7 days:\n\n${dataJson}\n\nWrite the morning briefing. Output strict JSON only.`;

  const result = await callLlm(config, {
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    // 1500 tokens is enough for 6 short sections + the risk_flags array.
    // Minimax M2.5 burns ~600 tokens on internal thinking before
    // producing the actual JSON.
    maxTokens: 1500,
    temperature: 0.4,
    timeoutMs: 60_000,
  });

  let parsed = result.ok ? extractJson(result.text ?? '') : null;
  if (!parsed || typeof parsed !== 'object') {
    parsed = EMPTY_FALLBACK;
  }

  // Defensive clamping on every field
  const fields = {
    general: clamp(parsed.general, 240),
    sleep: clamp(parsed.sleep, 220),
    training: clamp(parsed.training, 220),
    recovery: clamp(parsed.recovery, 220),
    nutrition: clamp(parsed.nutrition, 220),
    spiritual: clamp(parsed.spiritual, 220),
  };
  const flags = Array.isArray(parsed.risk_flags)
    ? parsed.risk_flags.map((x: any) => clamp(String(x), 140)).filter(Boolean).slice(0, 5)
    : [];

  const saved = await prisma.morningReport.upsert({
    where: { userId_date: { userId, date } },
    create: {
      userId,
      date,
      ...fields,
      riskFlags: JSON.stringify(flags),
      model: result.model || config.model,
      latencyMs: result.latencyMs,
    },
    update: {
      ...fields,
      riskFlags: JSON.stringify(flags),
      model: result.model || config.model,
      latencyMs: result.latencyMs,
      updatedAt: new Date(),
    },
  });

  return rowToResult(saved, false);
}
