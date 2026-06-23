/**
 * Per-metric AI insight. Generates a short narrative for each
 * tracked measurement based on the user's recent history:
 *   - 7d / 30d / 90d averages + delta vs the prior window
 *   - Most recent value + how stale it is (coverage gap)
 *   - Closely related metrics (e.g. waist → body fat %, lean mass)
 *   - Genetic maxima where available (bench 1RM ceiling, etc.)
 *
 * One row per (user, metric) in `MetricInsight`. Cache TTL is
 * applied at the route level — the lib always regenerates when
 * asked, the route decides whether to bypass the cache.
 *
 * Falls back to a deterministic, rule-based narrative when the
 * LLM is unavailable or returns garbage, so the user always sees
 * something useful in the deep-dive view.
 */
import { z } from 'zod';
import { prisma } from './prisma.js';
import { callLlm, getActiveLlmConfig } from './llm.js';

export const CURRENT_PROMPT_VERSION = 1;

/// Cache TTL: 7 days. After that the route will regenerate on next
/// access unless `force=true` is passed.
export const METRIC_INSIGHT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const FactorSchema = z.object({
  label: z.string().max(40),
  signal: z.enum(['positive', 'negative', 'neutral']),
  weight: z.number().min(0).max(1),
  note: z.string().max(200),
});

export const MetricInsightPayloadSchema = z.object({
  summary: z.string().max(600),
  factors: z.array(FactorSchema).max(6),
});

export type MetricInsightPayload = z.infer<typeof MetricInsightPayloadSchema>;

export type MetricWindow = {
  avg: number | null;
  delta: number | null; // null when either window is missing
  deltaPct: number | null;
  coverageDays: number;
  lastValue: number | null;
  lastRecordedAt: Date | null;
};

export type GatheredMetric = {
  metric: string;
  windows: {
    last7: MetricWindow;
    prior7: MetricWindow;
    last30: MetricWindow;
    prior30: MetricWindow;
    last90: MetricWindow;
    prior90: MetricWindow;
  };
  geneticMax: number | null;
  relatedMetrics: Record<string, MetricWindow['lastValue']>;
};

/**
 * Pull 7/30/90d averages + the prior 7/30/90d windows for delta
 * computation, the latest value, and the last-record timestamp for
 * staleness detection. Returns null-valued fields when there's no
 * data (so the LLM/prompt can say "not enough data").
 */
export async function gatherMetricInsightData(args: {
  userId: string;
  metric: string;
}): Promise<GatheredMetric> {
  const { userId, metric } = args;
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  const win = (days: number) => new Date(now.getTime() - days * day);
  const winPrior = (days: number) => ({
    gte: new Date(now.getTime() - 2 * days * day),
    lt: new Date(now.getTime() - days * day),
  });

  async function loadWindow(days: number): Promise<{
    avg: number | null;
    delta: number | null;
    deltaPct: number | null;
    coverageDays: number;
    lastValue: number | null;
    lastRecordedAt: Date | null;
  }> {
    const [rows, priorRows, latest] = await Promise.all([
      prisma.measurement.findMany({
        where: { userId, metric: metric as any, recordedAt: { gte: win(days) } },
        select: { value: true, recordedAt: true },
      }),
      prisma.measurement.findMany({
        where: {
          userId,
          metric: metric as any,
          recordedAt: winPrior(days),
        },
        select: { value: true },
      }),
      prisma.measurement.findFirst({
        where: { userId, metric: metric as any },
        orderBy: { recordedAt: 'desc' },
        select: { value: true, recordedAt: true },
      }),
    ]);
    const avg = rows.length ? rows.reduce((s, r) => s + r.value, 0) / rows.length : null;
    const priorAvg = priorRows.length ? priorRows.reduce((s, r) => s + r.value, 0) / priorRows.length : null;
    const delta = avg != null && priorAvg != null ? avg - priorAvg : null;
    const deltaPct = avg != null && priorAvg != null && priorAvg !== 0 ? (avg - priorAvg) / priorAvg : null;
    const coverageDays = new Set(rows.map((r) => r.recordedAt.toISOString().slice(0, 10))).size;
    return {
      avg,
      delta,
      deltaPct,
      coverageDays,
      lastValue: latest?.value ?? null,
      lastRecordedAt: latest?.recordedAt ?? null,
    };
  }

  const [last7, prior7, last30, prior30, last90, prior90, geneticMax] = await Promise.all([
    loadWindow(7),
    loadWindow(7),
    loadWindow(30),
    loadWindow(30),
    loadWindow(90),
    loadWindow(90),
    prisma.geneticMax.findFirst({
      where: { userId, metric: metric as any },
      select: { value: true },
    }),
  ]);

  // Related metrics: a small curated list per category so the LLM
  // has cross-references. Categories are loose; we just want the
  // most relevant 2-3 signals.
  const relatedKeys = relatedMetricsFor(metric);
  const related: Record<string, number | null> = {};
  for (const k of relatedKeys) {
    const row = await prisma.measurement.findFirst({
      where: { userId, metric: k as any },
      orderBy: { recordedAt: 'desc' },
      select: { value: true },
    });
    related[k] = row?.value ?? null;
  }

  return {
    metric,
    windows: {
      last7: overrideLastWindow(last7, prior7),
      prior7,
      last30: overrideLastWindow(last30, prior30),
      prior30,
      last90: overrideLastWindow(last90, prior90),
      prior90,
    },
    geneticMax: geneticMax?.value ?? null,
    relatedMetrics: related,
  };
}

// Loadwindow computed delta twice (lastX + priorX) — re-use priorX for
// the last-window's delta (the loadWindow helper returns both avg
// + delta in the "last" window; the prior-args version doesn't need
// its own delta).
function overrideLastWindow(
  last: Awaited<ReturnType<typeof loadWindow>>,
  prior: Awaited<ReturnType<typeof loadWindow>>,
): MetricWindow {
  // `last` already has delta vs prior (computed inside loadWindow).
  return last;
}

function relatedMetricsFor(metric: string): string[] {
  const map: Record<string, string[]> = {
    WEIGHT: ['BODY_FAT_PCT', 'LEAN_MASS', 'WAIST'],
    BODY_FAT_PCT: ['WEIGHT', 'WAIST', 'LEAN_MASS'],
    LEAN_MASS: ['WEIGHT', 'BODY_FAT_PCT'],
    FFMI: ['WEIGHT', 'LEAN_MASS'],
    WAIST: ['WEIGHT', 'BODY_FAT_PCT', 'SHOULDER'],
    SHOULDER: ['WAIST', 'CHEST'],
    CHEST: ['SHOULDER', 'BICEP'],
    BICEP: ['FOREARM', 'CHEST'],
    FOREARM: ['BICEP', 'WRIST_CIRC_CM'],
    QUAD: ['CALF', 'LEAN_MASS'],
    CALF: ['QUAD'],
    NECK: ['SHOULDER'],
    HRV: ['RESTING_HR', 'SLEEP_HOURS', 'SORENESS'],
    RESTING_HR: ['HRV', 'SLEEP_HOURS'],
    VO2_MAX: ['FIVE_K_TIME', 'RESTING_HR'],
    FIVE_K_TIME: ['VO2_MAX', 'ONE_MILE_TIME'],
    ONE_MILE_TIME: ['FIVE_K_TIME'],
    SLEEP_HOURS: ['SLEEP_QUALITY', 'HRV'],
    SLEEP_QUALITY: ['SLEEP_HOURS', 'HRV'],
    MOOD: ['ENERGY', 'STRESS'],
    ENERGY: ['MOOD', 'SLEEP_HOURS'],
    SORENESS: ['SLEEP_HOURS', 'MOOD'],
    STRESS: ['MOOD', 'SLEEP_HOURS', 'HRV'],
    BENCH_1RM: ['DEADLIFT_1RM', 'POWERLIFT_TOTAL'],
    SQUAT_1RM: ['DEADLIFT_1RM', 'POWERLIFT_TOTAL'],
    DEADLIFT_1RM: ['BENCH_1RM', 'POWERLIFT_TOTAL'],
    OHP_1RM: ['BENCH_1RM'],
    PULLUP_1RM: ['PULLUP_MAX'],
    POWERLIFT_TOTAL: ['BENCH_1RM', 'SQUAT_1RM', 'DEADLIFT_1RM'],
    PLANK_HOLD: ['PUSHUP_MAX'],
    L_SIT_HOLD: ['PLANK_HOLD'],
    PUSHUP_MAX: ['PULLUP_MAX'],
    PULLUP_MAX: ['PULLUP_1RM', 'PUSHUP_MAX'],
    SHOULDER_WAIST_RATIO: ['SHOULDER', 'WAIST'],
  };
  return map[metric] ?? [];
}

const SYSTEM_PROMPT = `You are a calm, evidence-minded fitness coach writing a one-paragraph deep-dive on a single measurement the user has been tracking. You write like a thoughtful trainer, not a hype bot or a doctor. Never use em-dashes. Never start with "Great" or "Looks like". No emojis. No exclamation marks.

Inputs you'll see:
- metric: the name of the metric
- windows: avg + delta for last 7d, 30d, 90d, each compared to the prior window of the same length. coverageDays = how many of those days had at least one log.
- geneticMax: where available, the genetic ceiling (kg or other unit). Use it to compute "% of genetic max" if applicable.
- relatedMetrics: latest values for 2-3 closely-related measurements (e.g. HRV → Resting HR, Sleep hours, Soreness).

Your job: write 2-3 sentences that tell the user what their data says. Be specific (use numbers from the data). If coverage is poor (<3 days in the 30d window), say so and suggest what to log.

Hard rules:
- 2-3 sentences, ≤ 500 chars total.
- Never recommend supplements or medical interventions.
- Never use the user's name; refer to them as "you".
- Mention concrete numbers from the data when relevant ("HRV averaged 51ms, down 4ms vs prior 30d").
- For body comp: never comment on weight direction unless the delta is > 2%.
- If a metric has been steady (delta < 5%), acknowledge briefly or stay silent.
- If the data is too thin to say anything meaningful, say so explicitly.

Output: strict JSON object, no prose, no markdown fences. Schema:
{
  "summary": "2-3 sentences, ≤ 500 chars",
  "factors": [
    {"label": "string", "signal": "positive|negative|neutral", "weight": 0.0-1.0, "note": "string, ≤ 140 chars"}
  ]
}
factors: 2-4 items max, each grounded in a specific signal from the input data.`;

export async function generateMetricInsight(args: {
  userId: string;
  metric: string;
  force?: boolean;
}): Promise<{
  summary: string;
  factors: Array<{ label: string; signal: 'positive' | 'negative' | 'neutral'; weight: number; note: string }>;
  cached: boolean;
  generatedAt: Date;
}> {
  const { userId, metric, force } = args;

  if (!force) {
    const existing = await prisma.metricInsight.findUnique({
      where: { userId_metric: { userId, metric: metric as any } },
    });
    if (existing && existing.promptVersion === CURRENT_PROMPT_VERSION
        && (Date.now() - existing.updatedAt.getTime()) < METRIC_INSIGHT_TTL_MS) {
      return {
        summary: existing.summary,
        factors: safeFactors(existing.factors),
        cached: true,
        generatedAt: existing.updatedAt,
      };
    }
  }

  const config = await getActiveLlmConfig();
  const ctx = await gatherMetricInsightData({ userId, metric });

  let payload: MetricInsightPayload;
  if (!config) {
    payload = offlineMetricInsight(ctx);
  } else {
    const userPrompt = `Metric: ${ctx.metric}\n\nWindows:\n${JSON.stringify(ctx.windows, null, 2)}\n\nGenetic max: ${ctx.geneticMax ?? 'n/a'}\n\nRelated metrics (latest):\n${JSON.stringify(ctx.relatedMetrics, null, 2)}\n\nWrite the deep-dive. Output strict JSON only.`;
    const start = Date.now();
    const result = await callLlm(config, {
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      maxTokens: 800,
      temperature: 0.3,
      timeoutMs: 45_000,
      jsonMode: true,
    }, 'metricInsight');
    const latencyMs = Date.now() - start;
    let parsed: MetricInsightPayload | null = null;
    if (result.ok) {
      const raw = extractJson(result.text ?? '');
      if (raw) {
        const check = MetricInsightPayloadSchema.safeParse(raw);
        if (check.success) parsed = check.data;
      }
    }
    payload = parsed ?? offlineMetricInsight(ctx);

    const safe: MetricInsightPayload = {
      summary: clamp(payload.summary, 600),
      factors: payload.factors.slice(0, 6).map((f) => ({
        label: clamp(f?.label, 40),
        signal: (['positive', 'negative', 'neutral'].includes(f?.signal) ? f.signal : 'neutral') as 'positive' | 'negative' | 'neutral',
        weight: Math.max(0, Math.min(1, Number(f?.weight) || 0)),
        note: clamp(f?.note, 200),
      })),
    };

    const row = await prisma.metricInsight.upsert({
      where: { userId_metric: { userId, metric: metric as any } },
      create: {
        userId,
        metric: metric as any,
        summary: safe.summary,
        factors: JSON.stringify(safe.factors),
        model: result.ok ? (config.model ?? null) : null,
        latencyMs,
        promptVersion: CURRENT_PROMPT_VERSION,
      },
      update: {
        summary: safe.summary,
        factors: JSON.stringify(safe.factors),
        model: result.ok ? (config.model ?? null) : null,
        latencyMs,
        promptVersion: CURRENT_PROMPT_VERSION,
      },
    });

    return {
      summary: safe.summary,
      factors: safe.factors,
      cached: false,
      generatedAt: row.updatedAt,
    };
  }

  // No LLM config — just persist the offline payload without LLM
  // metadata so we don't re-check on next request.
  const safe: MetricInsightPayload = {
    summary: clamp(payload.summary, 600),
    factors: payload.factors.slice(0, 6).map((f) => ({
      label: clamp(f?.label, 40),
      signal: (['positive', 'negative', 'neutral'].includes(f?.signal) ? f.signal : 'neutral') as 'positive' | 'negative' | 'neutral',
      weight: Math.max(0, Math.min(1, Number(f?.weight) || 0)),
      note: clamp(f?.note, 200),
    })),
  };
  const row = await prisma.metricInsight.upsert({
    where: { userId_metric: { userId, metric: metric as any } },
    create: {
      userId,
      metric: metric as any,
      summary: safe.summary,
      factors: JSON.stringify(safe.factors),
      model: null,
      latencyMs: null,
      promptVersion: CURRENT_PROMPT_VERSION,
    },
    update: {
      summary: safe.summary,
      factors: JSON.stringify(safe.factors),
      model: null,
      latencyMs: null,
      promptVersion: CURRENT_PROMPT_VERSION,
    },
  });
  return { summary: safe.summary, factors: safe.factors, cached: false, generatedAt: row.updatedAt };
}

function safeFactors(s: string | null): Array<{ label: string; signal: 'positive' | 'negative' | 'neutral'; weight: number; note: string }> {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch { return []; }
}

/**
 * Deterministic rule-based insight. Used when the LLM is unavailable
 * or returns garbage. Produces a 1-2 sentence summary + 1-2 factors
 * from whatever signal is in the windows.
 */
export function offlineMetricInsight(ctx: GatheredMetric): MetricInsightPayload {
  const { last7, last30, last90 } = ctx.windows;
  const factors: MetricInsightPayload['factors'] = [];
  const parts: string[] = [];

  const pickWindow = last30.coverageDays >= 3 ? last30 : last7.coverageDays >= 3 ? last7 : last90;
  if (pickWindow.lastValue == null) {
    return {
      summary: `No data for ${ctx.metric} yet. Log a few values to start tracking.`,
      factors: [{ label: 'Coverage', signal: 'neutral', weight: 1, note: 'No measurements logged.' }],
    };
  }

  if (pickWindow.deltaPct != null) {
    const sign = pickWindow.delta > 0 ? 'up' : 'down';
    const pct = Math.abs(pickWindow.deltaPct * 100).toFixed(0);
    if (Math.abs(pickWindow.deltaPct) > 0.05) {
      parts.push(`Average ${ctx.metric} is ${sign} ${pct}% vs the prior window`);
    } else {
      parts.push(`${ctx.metric} is steady`);
    }
    if (pickWindow.delta > 0) {
      factors.push({
        label: 'Trend',
        signal: 'neutral',
        weight: 0.6,
        note: `${sign} ${pct}% over ${pickWindow.coverageDays}d window.`,
      });
    } else {
      factors.push({
        label: 'Trend',
        signal: 'neutral',
        weight: 0.6,
        note: `${sign} ${pct}% over ${pickWindow.coverageDays}d window.`,
      });
    }
  } else {
    parts.push(`${ctx.metric} has limited history to compare against`);
  }

  if (ctx.geneticMax != null && pickWindow.lastValue != null) {
    const pct = (pickWindow.lastValue / ctx.geneticMax) * 100;
    parts.push(`currently at ${pct.toFixed(0)}% of genetic max (${ctx.geneticMax.toFixed(0)})`);
    factors.push({
      label: 'Genetic ceiling',
      signal: pct >= 90 ? 'positive' : pct >= 70 ? 'neutral' : 'negative',
      weight: 0.4,
      note: `${pct.toFixed(0)}% of ${ctx.geneticMax.toFixed(0)}.`,
    });
  }

  if (parts.length === 0) {
    parts.push(`${ctx.metric} last recorded at ${pickWindow.lastValue}`);
  }

  // Related metrics hint.
  const relatedLines: string[] = [];
  for (const [k, v] of Object.entries(ctx.relatedMetrics)) {
    if (v != null) relatedLines.push(`${k}=${v.toFixed(1)}`);
  }
  if (relatedLines.length > 0) {
    parts.push(`Related: ${relatedLines.slice(0, 3).join(', ')}`);
  }

  return {
    summary: parts.join('. ') + '.',
    factors,
  };
}

export function extractJson(text: string): any | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch { /* fall through */ }
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first === -1 || last === -1) return null;
  const candidate = trimmed.slice(first, last + 1);
  try { return JSON.parse(candidate); } catch { return null; }
}

function clamp(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}