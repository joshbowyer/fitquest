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
import { callLlm, getActiveLlmConfig, type LlmConfig } from './llm.js';
import { computeRecovery } from './recovery.js';
import { tickHearts, hardcoreSubstanceCapReason, HARDCORE_SUBSTANCE_CAPS } from './mode.js';
import { setVolumeKg } from './exerciseVolume.js';
import { detectPlateaus, type Plateau } from './plateau.js';
import { buildMacroNudges, type MacroNudgesResult } from './macroNudges.js';
import {
  buildSleepOverlapReport,
  summarizeForLlm,
  type SleepOverlapReport,
} from './sleepCorrelation.js';
import {
  buildBodyBatteryReport,
  summarizeBbForLlm,
  type BodyBatteryReport,
} from './bodyBatteryCorrelation.js';
import {
  lowConfidenceBodyFatFlag,
  type MeasurementSource,
} from './measurementSource.js';

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
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { weightKg: true } });
  const userWeightKg = me?.weightKg ?? 0;
  const last = await prisma.workout.findMany({
    where: { userId, performedAt: { gte: since7 } },
    select: {
      type: true,
      duration: true,
      exercises: {
        select: {
          name: true,
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
    select: { type: true, duration: true, exercises: { select: { name: true, sets: { select: { weight: true, reps: true } } } } },
  });
  const sum = (xs: typeof last) => {
    const vol = xs.reduce(
      (s, w) =>
        s + w.exercises.reduce((ss, ex) => ss + ex.sets.reduce((sss, st) => sss + setVolumeKg(st, ex.name, userWeightKg), 0), 0),
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
    coverageDays: 0,
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

/**
 * Counts of substances relevant to the Hardcore cap rules. Caffeine
 * counts use a 24h window (rolling); alcohol counts use a 7d window.
 * Counts are number of substance log rows in the window — the
 * SubstanceLog model doesn't enforce unit (a beer == a spirit ==
 * a glass of wine), which is intentional: the cap flags
 * "you logged too many drinks this week" and lets the user
 * decide whether that's accurate.
 */
async function substanceCountsDomain(
  userId: string,
  since1d: Date,
  since7d: Date,
): Promise<{ caffeineLast24h: number; alcoholLast7d: number; caffeineAllLast7d: number }> {
  const [caffeine24h, alcohol7d, caffeine7d] = await Promise.all([
    prisma.substanceLog.count({
      where: { userId, category: 'CAFFEINE', loggedAt: { gte: since1d } },
    }),
    prisma.substanceLog.count({
      where: { userId, category: 'ALCOHOL', loggedAt: { gte: since7d } },
    }),
    prisma.substanceLog.count({
      where: { userId, category: 'CAFFEINE', loggedAt: { gte: since7d } },
    }),
  ]);
  return {
    caffeineLast24h: caffeine24h,
    alcoholLast7d: alcohol7d,
    caffeineAllLast7d: caffeine7d,
  };
}

/**
 * Recent body-fat readings with their measurement source. Used by
 * the LLM to fold confidence into the recovery/coaching prose
 * (e.g. "your latest 10.5% reading was from calipers — confidence
 * ±2%, so don't read too much into it"). Also feeds the
 * low-confidence flag in the UI.
 */
async function bodyFatSourcesDomain(
  userId: string,
  since7: Date,
): Promise<
  Array<{
    recordedAt: string;
    bodyFatPct: number;
    source: MeasurementSource | null;
  }>
> {
  const rows = await prisma.measurement.findMany({
    where: {
      userId,
      metric: 'BODY_FAT_PCT',
      recordedAt: { gte: since7 },
    },
    select: { value: true, recordedAt: true, source: true },
    orderBy: { recordedAt: 'desc' },
  });
  return rows.map((r) => ({
    recordedAt: r.recordedAt.toISOString(),
    bodyFatPct: r.value,
    source: r.source as MeasurementSource | null,
  }));
}

/**
 * Routine streak state — for the "missed-week reset" penalty and
 * the streak label on the dashboard. We don't write here; this
 * is read-only.
 */
async function streakDomain(userId: string): Promise<{
  currentStreak: number;
  lastCompletedWeek: string | null;
  brokenThisWeek: boolean;
}> {
  const routine = await prisma.routine.findUnique({ where: { userId } });
  if (!routine) return { currentStreak: 0, lastCompletedWeek: null, brokenThisWeek: false };

  const now = new Date();
  const monday = (() => {
    const d = new Date(now);
    const day = d.getUTCDay();
    // 0 = Sunday, 1 = Monday, ...
    const offset = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + offset);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  })();

  const weekKey = monday.toISOString().slice(0, 10);
  const lastKey = routine.lastCompletedWeek;
  // "Broken this week" = the user has a streak from before this
  // week but didn't complete last week. We compute: if lastKey is
  // before the previous Monday, the streak is stale.
  if (!lastKey) {
    return { currentStreak: 0, lastCompletedWeek: null, brokenThisWeek: false };
  }
  const last = new Date(lastKey + 'T00:00:00Z');
  const prevMonday = new Date(monday);
  prevMonday.setUTCDate(monday.getUTCDate() - 7);
  const brokenThisWeek = last.getTime() < prevMonday.getTime();
  return {
    currentStreak: routine.currentStreak,
    lastCompletedWeek: lastKey,
    brokenThisWeek,
  };
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
  // Hardcore-mode context. The LLM sees these so it can fold
  // penalty-aware coaching into its sections (e.g. "skip caffeine
  // this afternoon — you're already at the 24h cap"). The actual
  // Penalties array surfaced to the UI is computed deterministically
  // (see buildPenalties) so the LLM can't lie or miss one.
  mode: 'CASUAL' | 'HARDCORE';
  hearts: number;
  streak: Awaited<ReturnType<typeof streakDomain>>;
  substanceCounts: Awaited<ReturnType<typeof substanceCountsDomain>>;
  // Anti-staleness + correlation payloads. These are surfaced
  // deterministically to the UI (UI doesn't ask the LLM to invent
  // plateau warnings or sleep correlations — the engines decide).
  // The LLM does see summarized versions in the SYSTEM_PROMPT so
  // it can fold numbers into the prose sections naturally.
  plateaus: Plateau[];
  nudges: MacroNudgesResult;
  sleepOverlap: SleepOverlapReport;
  bodyBattery: BodyBatteryReport;
  bodyFatSources: Array<{
    recordedAt: string;
    bodyFatPct: number;
    source: MeasurementSource | null;
  }>;
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
  const since1d = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      class: true, level: true, xp: true, ordained: true, timezone: true,
      mode: true, hearts: true,
    },
  });
  const recovery = await computeRecovery(userId);
  const tz = opts.timezone ?? me?.timezone ?? 'UTC';

  // Run the deterministic engines in parallel. None of these touch
  // each other so we save wall time vs. serial calls. The LLM call
  // below waits for all of them.
  const [
    sleep, sleepQuality, hrv, weight, bodyFat, workouts, habits, supplements, spiritual,
    substanceCounts, streak, plateaus, nudges, sleepOverlap, bodyBattery, bodyFatSources,
  ] = await Promise.all([
    metricDomain(userId, 'SLEEP_HOURS', since7, since14),
    metricDomain(userId, 'SLEEP_QUALITY', since7, since14),
    metricDomain(userId, 'HRV', since7, since14),
    metricDomain(userId, 'WEIGHT', since7, since14),
    metricDomain(userId, 'BODY_FAT_PCT', since7, since14),
    workoutsDomain(userId, since7, since14),
    habitsDomain(userId, since7, since14),
    supplementsDomain(userId, since7),
    spiritualDomain(userId, since7),
    substanceCountsDomain(userId, since1d, since7),
    streakDomain(userId),
    detectPlateaus(userId, now),
    buildMacroNudges(userId, now, tz),
    buildSleepOverlapReport(userId, tz, 14, now),
    buildBodyBatteryReport(userId, tz, 14, now),
    bodyFatSourcesDomain(userId, since7),
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
    mode: me?.mode === 'HARDCORE' ? 'HARDCORE' : 'CASUAL',
    // Tick hearts on gather so the count in the payload matches
    // what the dashboard would see right now. No-op for Casual
    // (returns 5).
    hearts: me ? await tickHearts(me.id) : 5,
    streak,
    substanceCounts,
    plateaus,
    nudges,
    sleepOverlap,
    bodyBattery,
    bodyFatSources,
  };
}

// ---- LLM call ----

const SYSTEM_PROMPT = `You are the user's quiet, sharp fitness coach in a self-hosted RPG-style training app. You are NOT a hype-bot, NOT a doctor, NOT a therapist. You write like a thoughtful trainer who actually reads the numbers.

Your job: read the structured data the user logged in the last 7 days (versus the prior 7) and produce a short morning briefing. Tone: direct, concrete, not clinical. Never use em-dashes. Never start with "Great" or "Looks like". If a metric was steady, say so briefly or stay silent — do not invent patterns.

The payload also includes deterministic engines that already produced their own arrays:
- plateaus: anti-staleness warnings (NO_PR_RECENT, ONE_RM_REGRESSION, VOLUME_REGRESSION, WEIGHT_FLATLINE, METRIC_FLATLINE). Surfaced in UI directly; do not duplicate them in your prose.
- nudges: positive observations + warnings (caffeine pre-workout, late caffeine, creatine gap, hydration, substance-sleep overlap). Surfaced in UI directly.
- sleepOverlap: substances taken within 8h before sleep onset, by category. Surfaced in UI; you may fold one concrete stat into the recovery section.
- bodyBattery: body battery vs sleep onset/quality/duration/substances. Surfaced in UI; you may fold one concrete stat into the recovery section.
- bodyFatSources: latest body-fat readings with their measurement method (DEXA / BodPod / calipers / BIA / visual / MANUAL). Mention confidence only if it's relevant.

Hard rules:
- Each section ≤ 2 sentences, ≤ 220 characters.
- If a domain has no data (coverageDays: 0), the field MUST be an empty string. Do not fabricate.
- If a domain is steady (delta < 5%), the field should be empty or one short acknowledgment.
- Risk flags: only call out things that are actually present in the data. Empty array if all clear. Don't repeat plateaus or nudges here — they're surfaced in their own UI rows.
- Never use the user's real name; refer to them as "you".
- Never recommend specific supplements or medical interventions.
- Mention concrete numbers from the data when relevant ("HRV averaged 52ms, down 6 from prior 7d").
- For spiritual: do not preach. If the user logged prayers, note it warmly. If not, stay silent (the user opted into this section).
- For weight: never comment on weight gain/loss direction unless it's a clear trend (>2% delta). Body comp is sensitive.
- Hardcore mode (payload.mode === 'HARDCORE'): when hearts are low or substance caps exceeded, fold a short, direct acknowledgement into the recovery or nutrition section (e.g. "skip caffeine this afternoon — you're already at the cap"). Stay concrete, not preachy. The actual penalty ledger is computed server-side, so don't try to enumerate it; just acknowledge the most important one.

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

/**
 * Parse a JSON column into a typed array. Items that don't pass
 * the type predicate are dropped (corrupt-row safety). Empty on
 * any error so the dashboard never crashes on bad JSON.
 */
function parseJsonArray<T>(
  raw: string | null | undefined,
  predicate: (x: any) => T | null,
): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(predicate).filter((x): x is T => x !== null);
  } catch {
    return [];
  }
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

// ---- Penalty ledger (Hardcore mode) ----

export type Penalty = {
  /** Short tag for grouping + icon picking. */
  label: string;
  /** "warn" = advisory, "scold" = penalty active. UI picks colour. */
  severity: 'warn' | 'scold';
  /** Human-readable note (≤ 200 chars). */
  note: string;
};

/**
 * Build the deterministic Hardcore-mode penalty array for the
 * today's report. Returns [] for Casual users — penalties only
 * surface when the user has opted in.
 *
 * Heuristics (each can produce one entry):
 *  - hearts === 0          → "Hearts depleted" (scold)
 *  - hearts ≤ 2            → "Hearts low" (warn)
 *  - caffeine > cap/24h    → "Caffeine cap exceeded" (scold if >=2x, warn otherwise)
 *  - alcohol > cap/7d      → "Alcohol cap exceeded" (scold)
 *  - streak broken this week → "Streak broken" (warn, only when streak > 0)
 *
 * Deterministic so the user gets the same panel regardless of which
 * model LLM-generated the surrounding sections.
 */
export function buildPenalties(payload: ReportPayload): Penalty[] {
  if (payload.mode === 'CASUAL') return [];
  const out: Penalty[] = [];

  if (payload.hearts <= 0) {
    out.push({
      label: 'Hearts',
      severity: 'scold',
      note: '0 hearts. XP, gold, and raid damage are halved until a heart regenerates (~8h).',
    });
  } else if (payload.hearts <= 2) {
    out.push({
      label: 'Hearts',
      severity: 'warn',
      note: `${payload.hearts} hearts remaining. Try to log a workout today — HeartLoss flag is now active.`,
    });
  } else if (payload.hearts < 5) {
    out.push({
      label: 'Hearts',
      severity: 'warn',
      note: `${payload.hearts}/5 hearts. ${5 - payload.hearts} more heart(s) before you're back to full.`,
    });
  }

  const { caffeineLast24h, alcoholLast7d } = payload.substanceCounts;
  if (caffeineLast24h > HARDCORE_SUBSTANCE_CAPS.caffeinePerDay) {
    const overshoot = caffeineLast24h - HARDCORE_SUBSTANCE_CAPS.caffeinePerDay;
    out.push({
      label: 'Caffeine',
      severity: overshoot >= HARDCORE_SUBSTANCE_CAPS.caffeinePerDay ? 'scold' : 'warn',
      note: `${caffeineLast24h} espressos in the last 24h (cap ${HARDCORE_SUBSTANCE_CAPS.caffeinePerDay}). HRV credit reduced.`,
    });
  }
  if (alcoholLast7d > HARDCORE_SUBSTANCE_CAPS.alcoholPerWeek) {
    const overshoot = alcoholLast7d - HARDCORE_SUBSTANCE_CAPS.alcoholPerWeek;
    out.push({
      label: 'Alcohol',
      severity: overshoot >= HARDCORE_SUBSTANCE_CAPS.alcoholPerWeek ? 'scold' : 'warn',
      note: `${alcoholLast7d} drinks in the last 7 days (cap ${HARDCORE_SUBSTANCE_CAPS.alcoholPerWeek}). Weekly XP multiplier reduced.`,
    });
  }

  if (payload.streak.brokenThisWeek && payload.streak.currentStreak > 0) {
    out.push({
      label: 'Streak',
      severity: 'warn',
      note: `Missed last week's routine — your ${payload.streak.currentStreak}-week streak just reset to 0.`,
    });
  }

  return out;
}

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
  /** Hardcore-mode penalty ledger. Empty array for Casual users or
   *  when there are no active penalties. Built deterministically
   *  from the gather payload — never from LLM output. */
  penalties: Penalty[];
  /** Anti-staleness warnings from the plateau detector. Empty when
   *  the user has no recent activity regression. Surfaced in its
   *  own UI row. */
  plateaus: Plateau[];
  /** Macro/timing warnings from buildMacroNudges. Empty when none
   *  triggered. Surfaced in its own UI row. */
  nudges: import('./macroNudges.js').Nudge[];
  /** Positive observations ("hit your water target 6/7 days").
   *  Surfaced alongside nudges. */
  positiveNudges: import('./macroNudges.js').Nudge[];
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
    penalties: string | null;
    plateaus: string | null;
    nudges: string | null;
    positiveNudges: string | null;
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
  let penalties: Penalty[] = [];
  try {
    if (row.penalties) {
      const parsed = JSON.parse(row.penalties);
      if (Array.isArray(parsed)) {
        penalties = parsed.filter((p: any) =>
          p && typeof p.label === 'string' &&
          (p.severity === 'warn' || p.severity === 'scold') &&
          typeof p.note === 'string',
        );
      }
    }
  } catch {}
  // Parse plateaus + nudges from their JSON columns. Defensive
  // fall-back to empty arrays so a corrupt row never breaks the
  // dashboard.
  const plateaus: Plateau[] = parseJsonArray<Plateau>(row.plateaus, (p) =>
    p && typeof p.kind === 'string' && typeof p.label === 'string' &&
    (p.severity === 'warn' || p.severity === 'scold') && typeof p.note === 'string'
      ? p
      : null,
  );
  const nudges = parseJsonArray<import('./macroNudges.js').Nudge>(row.nudges, (n) =>
    n && typeof n.kind === 'string' && typeof n.label === 'string' &&
    (n.severity === 'positive' || n.severity === 'warn') && typeof n.note === 'string'
      ? n
      : null,
  );
  const positiveNudges = parseJsonArray<import('./macroNudges.js').Nudge>(row.positiveNudges, (n) =>
    n && typeof n.kind === 'string' && typeof n.label === 'string' &&
    (n.severity === 'positive' || n.severity === 'warn') && typeof n.note === 'string'
      ? n
      : null,
  );
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
    penalties,
    plateaus,
    nudges,
    positiveNudges,
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
        penalties: '[]',
        model: null,
        latencyMs: null,
      },
      update: { updatedAt: new Date() },
    });
    return rowToResult(stub, false);
  }

  const config = await getActiveLlmConfig();
  if (!config) {
    // Store a stub row so we don't re-check on every dashboard load.
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
        penalties: '[]',
        model: null,
        latencyMs: null,
      },
      update: { updatedAt: new Date() },
    });
    return rowToResult(stub, false);
  }

  const payload = await gatherReportData(userId, { timezone: user?.timezone });
  // Surface the sleep-substance overlap + body battery correlation
  // summaries to the LLM so it can fold concrete numbers into the
  // recovery/coaching prose. The raw reports are already in the
  // payload (and persisted indirectly via plateaus + nudges), but
  // a short summary string is easier for smaller models to read.
  const sleepOverlapSummary = summarizeForLlm(payload.sleepOverlap);
  const bodyBatterySummary = summarizeBbForLlm(payload.bodyBattery);
  const lowConfFlag = lowConfidenceBodyFatFlag(payload.bodyFatSources as any);
  const dataJson = JSON.stringify(payload, null, 2);
  const userPrompt = `Today's date: ${date}\nUser profile: ${JSON.stringify(payload.user)}\n\nLast 7 days vs prior 7 days:\n\n${dataJson}\n\nSleep-substance overlap summary:\n${sleepOverlapSummary}\n\nBody battery correlation summary:\n${bodyBatterySummary}\n\n${lowConfFlag ? 'Note: latest body-fat readings came from low-confidence sources (visual or BIA).' : ''}\n\nWrite the morning briefing. Output strict JSON only.`;

  const result = await callLlm(config, {
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    // 1500 tokens is enough for 6 short sections + the risk_flags array.
    // Minimax M2.5 burns ~600 tokens on internal thinking before
    // producing the actual JSON.
    maxTokens: 1500,
    temperature: 0.4,
    timeoutMs: 60_000,
    // Force JSON. Minimax respects it; smaller Ollama models
    // that ignore the system prompt still return parseable JSON
    // because of the response_format constraint.
    jsonMode: true,
  }, 'morningReport');

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
  // Build the Hardcore-mode penalty ledger deterministically from
  // the gather payload. Empty for Casual users. The LLM never gets
  // to decide what's a penalty.
  const penalties = buildPenalties(payload);

  const saved = await prisma.morningReport.upsert({
    where: { userId_date: { userId, date } },
    create: {
      userId,
      date,
      ...fields,
      riskFlags: JSON.stringify(flags),
      penalties: JSON.stringify(penalties),
      // Anti-staleness plateaus + macro nudges are surfaced in
      // their own UI rows; persist them so the dashboard renders
      // them on first paint without re-running the engines.
      plateaus: JSON.stringify(payload.plateaus),
      nudges: JSON.stringify(payload.nudges.warnings),
      positiveNudges: JSON.stringify(payload.nudges.positive),
      model: result.model || config.model,
      latencyMs: result.latencyMs,
    },
    update: {
      ...fields,
      riskFlags: JSON.stringify(flags),
      penalties: JSON.stringify(penalties),
      plateaus: JSON.stringify(payload.plateaus),
      nudges: JSON.stringify(payload.nudges.warnings),
      positiveNudges: JSON.stringify(payload.nudges.positive),
      model: result.model || config.model,
      latencyMs: result.latencyMs,
      updatedAt: new Date(),
    },
  });

  return rowToResult(saved, false);
}
