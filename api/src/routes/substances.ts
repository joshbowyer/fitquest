import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SubstanceCategory } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { lastSundayMidnightUtc, todayInTz } from '../lib/timezone.js';

// ============================================================================
// Substance log — one-shot events (NOT a daily checklist).
// Each row is a single consumption: "I had 2 cups of coffee at 9am",
// "I smoked 3 cigarettes this evening", "I drank 1 beer with dinner".
// The form field captures the specific delivery (cigarette, vape, zyn,
// hookah, etc.) which has different recovery/sleep/lung impact.
// ============================================================================

const SubstanceCreateSchema = z.object({
  category: z.nativeEnum(SubstanceCategory),
  /// Free-form form key. Common values per category:
  ///   NICOTINE:    cigarette, vape, zyn, hookah, cigar, chew
  ///   CAFFEINE:    coffee, tea, energy_drink, pre_workout, soda
  ///   ALCOHOL:     beer, wine, spirits, seltzer, cider
  ///   ELECTROLYTE: lmnt, salt_capsule, liquid_iv, coconut_water
  form: z.string().min(1).max(40),
  /// Optional quantity + unit (drinks, mg, pouches, scoops).
  amount: z.number().positive().max(1000).optional().nullable(),
  unit: z.string().max(20).optional().nullable(),
  /// Free-form context. "pre-workout 1h before lift", "with dinner",
  /// "social, 3 over the evening".
  context: z.string().max(200).optional().nullable(),
  /// When it happened. Defaults to now. Lets the user back-fill.
  loggedAt: z.string().datetime().optional(),
});

export async function substanceRoutes(app: FastifyInstance) {
  // GET /substances — recent events (last 30 days by default).
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const q = z
      .object({
        days: z.coerce.number().int().min(1).max(365).default(30),
        category: z.nativeEnum(SubstanceCategory).optional(),
      })
      .parse(req.query);
    const since = new Date();
    since.setDate(since.getDate() - q.days);
    const where: any = { userId: me.id, loggedAt: { gte: since } };
    if (q.category) where.category = q.category;
    const items = await prisma.substanceLog.findMany({
      where,
      orderBy: { loggedAt: 'desc' },
      take: 500,
    });
    return { items };
  });

  // GET /substances/summary — last 7 days rolled up, per (category, form)
  // for the morning report and Insights page.
  app.get('/summary', async (req) => {
    const me = await requireUser(req);
    const days = 7;
    const since = new Date();
    since.setDate(since.getDate() - days);
    const logs = await prisma.substanceLog.findMany({
      where: { userId: me.id, loggedAt: { gte: since } },
      orderBy: { loggedAt: 'desc' },
    });
    type Bucket = {
      category: string;
      form: string;
      count: number;
      lastLoggedAt: string;
    };
    const buckets = new Map<string, Bucket>();
    for (const l of logs) {
      const key = `${l.category}:${l.form}`;
      const cur = buckets.get(key);
      if (cur) {
        cur.count += 1;
        if (l.loggedAt.getTime() > new Date(cur.lastLoggedAt).getTime()) {
          cur.lastLoggedAt = l.loggedAt.toISOString();
        }
      } else {
        buckets.set(key, {
          category: l.category,
          form: l.form,
          count: 1,
          lastLoggedAt: l.loggedAt.toISOString(),
        });
      }
    }
    return { items: Array.from(buckets.values()), days };
  });

  // POST /substances
  app.post('/', async (req) => {
    const me = await requireUser(req);
    const body = SubstanceCreateSchema.parse(req.body);
    const log = await prisma.substanceLog.create({
      data: {
        userId: me.id,
        category: body.category,
        form: body.form,
        amount: body.amount ?? null,
        unit: body.unit ?? null,
        context: body.context ?? null,
        loggedAt: body.loggedAt ? new Date(body.loggedAt) : new Date(),
        // Direct POST /substances is always a user-initiated tap
        // on a substance chip — tag it MANUAL explicitly. The
        // schema has @default("MANUAL") so this is technically
        // redundant for storage, but it future-proofs against the
        // default ever changing (e.g. if we ever add a non-MANUAL
        // default for some bulk-import path) and makes the intent
        // obvious at the call site.
        source: 'MANUAL',
      },
    });
    // Fire home-base penances on every substance log:
    //   - substance_checkin: +2 (honest reckoning, baseline)
    //   - substance_free_day: +5 (only when no alcohol today)
    //   - substance_overuse: -20 (only when HARDCORE caps exceeded)
    // The overuse check pulls from the Hardcore cap helper in mode.ts
    // so the threshold is consistent with the morning-report
    // riskFlags. substance_free_day is best-effort — it skips when
    // the user has logged alcohol within the last 24h.
    const { firePenance, firePenances } = await import('../lib/penance.js');
    const fires: Array<{
      key: 'substance_checkin' | 'substance_free_day' | 'substance_overuse';
      source: 'substance_log';
    }> = [{ key: 'substance_checkin', source: 'substance_log' }];
    if (body.category === 'ALCOHOL') {
      // Check whether this log pushes them past the HARDCORE
      // weekly cap (5 drinks) — same threshold the morning report
      // uses. We skip the DB query when the user isn't in Hardcore.
      if (me.mode === 'HARDCORE') {
        // Most recent Sunday at local midnight in the user's tz —
        // matches the morning-report heart-loss cron. Was previously
        // server-local Sunday (= UTC), off by up to a day for non-UTC
        // users (e.g. NYC user logging drinks Sun 10pm EDT counted as
        // last week's drinks).
        const startOfWeek = lastSundayMidnightUtc(me.timezone ?? null);
        const weekCount = await prisma.substanceLog.count({
          where: {
            userId: me.id,
            category: 'ALCOHOL',
            loggedAt: { gte: startOfWeek },
          },
        });
        if (weekCount > 5) {
          fires.push({ key: 'substance_overuse', source: 'substance_log' });
        }
      }
    }
    await firePenances(me.id, fires);
    return { log };
  });

  // DELETE /substances/:id
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = req.params.id;
    const existing = await prisma.substanceLog.findUnique({ where: { id } });
    if (!existing || existing.userId !== me.id) {
      return reply.code(404).send({ error: 'Log not found' });
    }
    await prisma.substanceLog.delete({ where: { id } });
    return { ok: true };
  });

// ============================================================================
// GET /substances/trend?days=N — per-day count per category for
// the line chart. Returns [{ day, caffeine, alcohol, nicotine,
// electrolyte }] sorted oldest-first, one row per day (zeros for
// "didn't consume" days). Each line is a count of logs, not
// weighted by amount — the chart's purpose is "did I / how many
// times" rather than "what dose" (the units differ across
// categories: drinks vs mg vs puffs, so a single shared y-axis
// unit would be misleading).
// ============================================================================
app.get('/trend', async (req) => {
  const me = await requireUser(req);
  const q = z
    .object({ days: z.coerce.number().int().min(1).max(90).default(14) })
    .parse(req.query);
  const tz = me.timezone ?? 'UTC';
  const today = new Date();
  const dayKeys: string[] = [];
  for (let i = q.days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    dayKeys.push(todayInTz(tz, d));
  }
  // Pull the rows for the window. Use the older of (i=days-1 ago) as
  // the lower bound; for safety add 1d buffer.
  const since = new Date(today.getTime() - (q.days + 1) * 86_400_000);
  const logs = await prisma.substanceLog.findMany({
    where: { userId: me.id, loggedAt: { gte: since } },
    select: { category: true, loggedAt: true },
  });
  type Cat = 'CAFFEINE' | 'ALCOHOL' | 'NICOTINE' | 'ELECTROLYTE';
  const empty = (): Record<Cat, number> => ({
    CAFFEINE: 0, ALCOHOL: 0, NICOTINE: 0, ELECTROLYTE: 0,
  });
  const buckets = new Map<string, Record<Cat, number>>(
    dayKeys.map((k) => [k, empty()]),
  );
  for (const l of logs) {
    const day = todayInTz(tz, l.loggedAt);
    if (!buckets.has(day)) continue;
    const cat = l.category as Cat;
    buckets.get(day)![cat] += 1;
  }
  return {
    days: dayKeys.map((day) => ({ day, ...buckets.get(day)! })),
  };
});
}
