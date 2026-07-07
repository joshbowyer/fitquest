/**
 * Vitals ingestion endpoint. The primary consumer is the Gadgetbridge
 * FitQuest auto-sync (see docs/GB_FITQUEST_SYNC.md) which posts
 * time-series health data (steps, HR, stress, body battery, sleep,
 * HRV, SpO2, ...) into this endpoint. We also accept a
 * `?since=...` query for cursor-based polling so the GB client
 * can do incremental sync without re-uploading old data.
 *
 * Storage contract:
 *   - Each sample becomes a `Measurement` row keyed on
 *     (userId, metric, recordedAt). The unique index added in
 *     v1.0.34 makes this idempotent — re-posting the same
 *     timestamp upserts (and we skip the write on no change).
 *   - `kind` must be one of the `Measurement` `metric` enum
 *     values (see api/prisma/schema.prisma's `Measurement`).
 *     Free-text would let typos through, so we validate against
 *     the known set. If you need a new metric type, add it to
 *     the enum first.
 *   - `unit` is informational — recorded on the row but not used
 *     for any conversion. We don't try to normalize units (e.g.
 *     "min" vs "minutes" — pass them through, the client knows
 *     what it sent).
 *
 * GET /vitals?since=ISO returns the user's existing samples
 * (for cursor reconciliation). Currently the cursor is
 * "everything since the timestamp" — not paginated. The expected
 * caller pattern is: "I've synced up to T, give me everything
 * after T" and then re-POST to advance the server's view of the
 * client cursor. (We could also just upsert on POST and treat GET
 * as a debugging endpoint; keeping the GET anyway for ops use.)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';

/// Sample shape sent by the GB client. The server side does
/// NO conversion / unit normalization — whatever the client
/// sends is what gets stored.
const sampleSchema = z.object({
  ts: z.string().datetime(),  // ISO 8601, e.g. "2026-04-06T15:11:00.000Z"
  value: z.number(),         // metric-specific
});

const vitalsSchema = z.object({
  kind: z.string().min(1).max(64),
  unit: z.string().max(32).optional(),
  samples: z.array(sampleSchema).min(1).max(1000),
  /// Optional source tag (e.g. "gadgetbridge", "garmin-connect")
  /// — recorded on each row's notes for debug visibility.
  source: z.string().max(32).optional(),
});

const getQuerySchema = z.object({
  since: z.string().datetime().optional(),
  kind: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});

/// Validate that `kind` is a known Measurement metric enum value.
/// The Measurement.metric enum is large (BODY_BATTERY, STEPS, HRV,
/// SLEEP_HOURS, VO2_MAX, ...) — we list the names explicitly here
/// to catch typos in the GB client at upload time instead of
/// letting Prisma throw a 500. The set is duplicated from the
/// schema (we could `import { Measurement }` and iterate
/// `Object.values(Measurement)`, but `Measurement` is the TypeScript
/// type, not the runtime enum — Prisma's runtime enum is on the
/// generated client which we don't import in this file).
const KNOWN_METRICS: ReadonlySet<string> = new Set<string>([
  'WEIGHT', 'BODY_FAT_PCT', 'WAIST', 'NECK', 'SHOULDER', 'CHEST', 'CALF', 'FOREARM', 'QUAD',
  'ONE_MILE_TIME', 'FIVE_K_TIME',
  'RESTING_HR', 'HRV', 'SLEEP_HOURS', 'SLEEP_QUALITY', 'SLEEP_ONSET',
  'WATER_ML', 'MOOD', 'ENERGY', 'SORENESS', 'STRESS',
  'CAFFEINE', 'ALCOHOL', 'NICOTINE', 'ELECTROLYTE',
  'NECK_CIRC', 'HEIGHT', 'BMI', 'LEAN_MASS', 'BODY_WATER',
  'VO2_MAX', 'DEAD_HANG', 'L_SIT', 'PLANK', 'DEADLIFT_1RM',
  'BENCH_1RM', 'SQUAT_1RM', 'OHP_1RM',
  'STEPS', 'RESPIRATION_RATE', 'SPO2', 'BODY_BATTERY', 'HEART_RATE',
]);

export async function vitalsRoutes(app: FastifyInstance) {
  // POST /vitals — batched ingestion
  app.post('/', async (req, reply) => {
    const me = await requireUser(req);
    const body = vitalsSchema.parse(req.body);
    if (!KNOWN_METRICS.has(body.kind)) {
      return reply.code(400).send({
        error: 'unknown_metric',
        kind: body.kind,
        hint: `Add this kind to the Measurement enum in prisma/schema.prisma and run migrate, then update KNOWN_METRICS in routes/vitals.ts.`,
      });
    }

    // Build the upsert array. We don't do a single
    // prisma.measurement.createMany because we need upsert
    // (re-posts from a GB client that crashed mid-sync should
    // not duplicate). Postgres 9.5+ doesn't have INSERT ... ON
    // CONFLICT DO NOTHING in a single statement, so loop + upsert
    // in a single transaction. The Measurement unique index is
    // (userId, metric, recordedAt) — established in v1.0.34.
    const source = body.source ?? 'gadgetbridge';
    const notePrefix = source === 'gadgetbridge' ? '' : `src=${source}; `;
    let created = 0;
    let updated = 0;
    await prisma.$transaction(async (tx) => {
      for (const sample of body.samples) {
        const recordedAt = new Date(sample.ts);
        // Compose a small note for the row: just the source tag,
        // since per-sample value annotations would bloat the table.
        const notes = source === 'gadgetbridge' ? null : `src=${source}`;
        const existing = await tx.measurement.findUnique({
          where: {
            userId_metric_recordedAt: {
              userId: me.id,
              metric: body.kind as any,
              recordedAt,
            },
          },
          select: { value: true },
        });
        if (existing && existing.value === sample.value) {
          // Same value — skip the write (avoids touching
          // updatedAt on every re-sync of unchanged data).
          continue;
        }
        await tx.measurement.upsert({
          where: {
            userId_metric_recordedAt: {
              userId: me.id,
              metric: body.kind as any,
              recordedAt,
            },
          },
          create: {
            userId: me.id,
            metric: body.kind as any,
            value: sample.value,
            unit: body.unit ?? '',
            notes,
            recordedAt,
          },
          update: {
            value: sample.value,
            unit: body.unit ?? '',
            notes,
          },
        });
        if (existing) updated++;
        else created++;
      }
    });

    return {
      kind: body.kind,
      received: body.samples.length,
      created,
      updated,
    };
  });

  // GET /vitals?since=...&kind=...&limit=...
  // Cursor reconciliation. Returns the user's existing samples
  // since `since` (or the last 7 days if no `since`) optionally
  // filtered by kind. Used by GB to recover after a crash, and
  // by the web /admin panels for debugging.
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const q = getQuerySchema.parse(req.query ?? {});
    const where: any = { userId: me.id };
    if (q.kind) where.metric = q.kind;
    if (q.since) where.recordedAt = { gte: new Date(q.since) };
    else {
      // Default: last 7 days. Avoids a "select everything"
      // runaway if a user has years of synced data.
      const sevenAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      where.recordedAt = { gte: sevenAgo };
    }
    const rows = await prisma.measurement.findMany({
      where,
      orderBy: { recordedAt: 'asc' },
      take: q.limit,
      select: {
        metric: true,
        value: true,
        unit: true,
        recordedAt: true,
        notes: true,
      },
    });
    return {
      samples: rows.map((r) => ({
        kind: r.metric as string,
        value: r.value,
        unit: r.unit,
        ts: r.recordedAt.toISOString(),
        notes: r.notes,
      })),
    };
  });
}