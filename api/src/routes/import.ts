import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { WorkoutSource } from '../lib/prisma.js';
import { parseFit, isFitBuffer, type FitImportResult, type FitKind } from '../lib/fit.js';
import { checkAchievements } from '../lib/achievements.js';
import { checkRoutineProgress } from './routine.js';
import { activityTitle } from '../lib/geo.js';
import { importExport, ImportError, validatePayload } from '../lib/import.js';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB — well above any FIT we'll see

const bodyLimit = 60 * 1024 * 1024; // Fastify body limit; pair with our 50MB cap

// Source for a FIT ingest. Mirrors the WorkoutSource enum on the
// Workout row. The FitQuestBridge APK sets `source: 'BRIDGE'` in
// every batch upload so the /import page can separate auto-uploaded
// activities from web drags. Unknown / missing values default to
// WEB (same as the Workout column default) so old clients keep
// working without an explicit field.
const ImportSourceSchema = z.nativeEnum(WorkoutSource).optional();

type CreatedRecord =
  | { kind: 'workout'; id: string; summary: string }
  | { kind: 'measurement'; metric: string; id: string; value: number }
  | { kind: 'daily_log'; id: string; dailyKey: string };

type FileResult = {
  filename: string;
  fitKind: FitKind;
  sourceTimestamp: string | null;
  created: CreatedRecord[];
  skipped: { reason: string }[];
};

// Helper that actually performs the persistence for one parsed FIT.
async function persist(
  userId: string,
  fit: FitImportResult,
  importSource: WorkoutSource = WorkoutSource.WEB,
  sourceFilename: string | null = null,
): Promise<CreatedRecord[]> {
  const created: CreatedRecord[] = [];

  // Pre-fetch a fallback Daily row id so we can attach WORKOUT daily
  // logs (FK requires it). One shared row per file is fine — it's just
  // a structural requirement.
  const fallbackDaily = await prisma.daily.findFirst({
    where: { userId, archived: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (fit.workouts && fit.workouts.length > 0) {
    for (const w of fit.workouts) {
      // FIT totalTimerTime is seconds; Workout.duration is stored as
      // minutes (matches the manual /workouts POST path which uses
      // minutes and the schema doc). Round to the nearest minute so a
      // 92m48s walk reads as 93m in the UI rather than 92.8m with a
      // float showing up everywhere.
      const duration = Math.round(w.durationSec / 60);
      const notes = [
        w.subSport ? `${w.sport}/${w.subSport}` : w.sport,
        w.distanceMeters ? `${(w.distanceMeters / 1000).toFixed(2)} km` : null,
        w.avgHeartRate ? `avg HR ${w.avgHeartRate}` : null,
        w.maxHeartRate ? `max HR ${w.maxHeartRate}` : null,
        w.totalCalories ? `${w.totalCalories} kcal` : null,
        w.avgPower ? `avg ${w.avgPower}W` : null,
        w.normalizedPower ? `NP ${w.normalizedPower}W` : null,
        w.rpe != null ? `RPE ${w.rpe}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      // Map sport -> WorkoutType
      const type =
        w.sport === 'running' || w.sport === 'walking' || w.sport === 'hiking'
          ? 'CARDIO'
          : w.sport === 'cycling' || w.sport === 'swimming'
          ? 'CARDIO'
          : w.sport === 'training' || w.sport === 'strength_training' || w.sport === 'tactical'
          ? 'STRENGTH'
          : w.sport === 'yoga' || w.sport === 'pilates'
          ? 'MOBILITY'
          : 'OTHER';
      // Upsert keyed on the (userId, performedAt) unique index.
      // Previously this was a `create` call — but the recent
      // migration added the unique constraint, so a re-import
      // of the same .fit would fail with P2002 and roll back
      // the whole transaction. Use upsert so re-imports
      // dedupe cleanly. On update, only touch the mutable
      // fields (notes, name, trackJson, sourceFilename,
      // duration). The user's other Workout fields (importSource,
      // type) shouldn't change on re-import.
      const created_row = await prisma.workout.upsert({
        where: {
          userId_performedAt: {
            userId,
            performedAt: w.startTime,
          },
        },
        create: {
          userId,
          type: type as any,
          // Auto-name from location + sport when the track has
          // lat/lng points; falls back to "<Sport>" otherwise.
          // Cached reverse-geocode keeps a 26-file bulk import
          // to 1-2 Nominatim calls when the activities cluster
          // in the same metro area.
          name: await activityTitle(w.sport, w.trackpoints),
          duration,
          notes: `[FIT] ${notes}`,
          importSource,
          sourceFilename,
          performedAt: w.startTime,
          trackJson: (w.trackpoints ?? []) as any,
        },
        update: {
          name: await activityTitle(w.sport, w.trackpoints),
          duration,
          notes: `[FIT] ${notes}`,
          sourceFilename,
          trackJson: (w.trackpoints ?? []) as any,
        },
      });
      // Detect "this is a fresh insert" vs "an update" so the
      // downstream WORKOUT daily log + race-time inference don't
      // re-run for re-imports. Prisma's upsert doesn't return
      // a flag, so we use a createdAt-vs-now heuristic. A re-import
      // of a workout from a few seconds ago would re-run the
      // side effects (harmless but slightly wasteful); anything
      // older counts as a re-import and skips them.
      const ageMs = Date.now() - created_row.createdAt.getTime();
      const isFreshInsert = ageMs < 5000;
      // Mark today's WORKOUT daily complete (if applicable)
      if (fallbackDaily) {
        const daily = await prisma.dailyLog.create({
          data: {
            userId,
            dailyId: fallbackDaily.id,
            dailyKey: 'WORKOUT',
            goldDelta: 10,
            xpDelta: 15,
            loggedAt: w.startTime,
          },
        });
        created.push({
          kind: 'daily_log',
          id: daily.id,
          dailyKey: 'WORKOUT',
        });
      }
      created.push({
        kind: 'workout',
        id: created_row.id,
        summary: `${w.sport} · ${duration}m`,
      });

      // Infer standard race distances from CARDIO activities. We only
      // log when the activity is plausibly a 1mi or 5K effort (by
      // duration) AND the distance is within a margin of the target.
      // Margin = ±20% by default so a 1.05mi run isn't dismissed but a
      // 1.5mi run doesn't get logged as a mile.
      await maybeInferStandardDistance(userId, w, created_row.id);
    }
    await checkAchievements(userId);
    await checkRoutineProgress(userId);
  }

  if (fit.measurements && fit.measurements.length > 0) {
    for (const m of fit.measurements) {
      // Upsert on the unique (userId, metric, recordedAt) tuple so
      // re-importing the same .fit file (or its mirror backup) is a
      // no-op rather than piling up duplicate rows. If a row already
      // exists for this triple, update the value/unit/notes — the
      // FIT file is treated as the source of truth on conflict.
      const created_row = await prisma.measurement.upsert({
        where: {
          userId_metric_recordedAt: {
            userId,
            metric: m.metric as any,
            recordedAt: m.recordedAt,
          },
        },
        create: {
          userId,
          metric: m.metric as any,
          value: m.value,
          unit: unitFor(m.metric),
          notes: m.notes ?? null,
          recordedAt: m.recordedAt,
          sourceFilename,
        },
        update: {
          value: m.value,
          unit: unitFor(m.metric),
          notes: m.notes ?? null,
          sourceFilename,
        },
      });
      created.push({
        kind: 'measurement',
        metric: m.metric,
        id: created_row.id,
        value: m.value,
      });
    }
  }

  return created;
}

function unitFor(metric: string): string {
  switch (metric) {
    case 'SLEEP_HOURS':
      return 'h';
    case 'SLEEP_QUALITY':
      return '/10';
    // SLEEP_ONSET is fractional hours (e.g. 22.5 = 10:30 PM). The
    // chart treats it as unitless clock time, but we record the
    // canonical unit so future "what unit is this?" lookups resolve.
    case 'SLEEP_ONSET':
      return 'h';
    case 'HRV':
      return 'ms';
    case 'RESTING_HR':
      return 'bpm';
    case 'STRESS':
      return '/100';
    case 'BODY_BATTERY':
      return '/100';
    case 'STEPS':
      return '';
    case 'RESPIRATION_RATE':
      return 'brpm';
    case 'VO2_MAX':
      return 'ml/kg/min';
    default:
      return '';
  }
}

export async function importRoutes(app: FastifyInstance) {
  // Configure body limit for this scope
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit },
    (_req, payload, done) => done(null, payload),
  );

  // POST /import — single .fit file (binary body)
  app.post('/', { bodyLimit }, async (req, reply) => {
    const me = await requireUser(req);
    const buf = req.body as Buffer | undefined;
    if (!buf || !Buffer.isBuffer(buf)) {
      return reply.code(400).send({ error: 'Expected .fit binary in request body' });
    }
    if (buf.length > MAX_FILE_BYTES) {
      return reply.code(413).send({ error: `File exceeds ${MAX_FILE_BYTES} bytes` });
    }
    if (!isFitBuffer(buf)) {
      return reply.code(400).send({ error: 'Not a FIT file (bad header)' });
    }
    const fit = parseFit(buf, me.timezone ?? 'UTC');
    // Single-file endpoint accepts ?source=BRIDGE for parity with
    // /batch. We don't expect anyone to use this path with the
    // bridge (it always batches) but keeping the API symmetric
    // means any future client can flag its origin.
    const singleSource = ImportSourceSchema.parse((req.query as any)?.source ?? undefined) ?? WorkoutSource.WEB;
    const created = await persist(me.id, fit, singleSource, 'upload.fit');
    const fileResult: FileResult = {
      filename: 'upload.fit',
      fitKind: fit.kind,
      sourceTimestamp: fit.sourceTimestamp,
      created,
      skipped: fit.skipped ?? [],
    };
    return { files: [fileResult] };
  });

  // POST /import/batch — accepts JSON { files: [{ filename, contentBase64 }] }.
// The frontend reads each File as ArrayBuffer, base64-encodes it, and
// posts them in one request. This is more portable than multipart and
// avoids the @fastify/multipart streaming quirks across versions. We
// re-parse each file as a buffer on the server side and process it.
//
// Optional `source` field ('WEB' | 'BRIDGE' | 'BULK_REPROCESS')
// identifies the ingest surface. Default WEB so old clients keep
// working. The FitQuestBridge APK sets `source: 'BRIDGE'` on every
// batch so the /import page can distinguish auto-uploads.
  app.post('/batch', { bodyLimit }, async (req, reply) => {
    const me = await requireUser(req);
    const body = z.object({
      files: z.array(z.object({
        filename: z.string().min(1).max(200),
        contentBase64: z.string().min(1),
      })).min(1).max(50),
      source: ImportSourceSchema,
    }).parse(req.body);
    const source: WorkoutSource = body.source ?? WorkoutSource.WEB;
    const results: FileResult[] = [];
    for (const f of body.files) {
      try {
        const buf = Buffer.from(f.contentBase64, 'base64');
        if (buf.length > MAX_FILE_BYTES) {
          results.push({
            filename: f.filename,
            fitKind: 'unknown',
            sourceTimestamp: null,
            created: [],
            skipped: [{ reason: `File exceeds ${MAX_FILE_BYTES} bytes` }],
          });
          continue;
        }
        if (!isFitBuffer(buf)) {
          results.push({
            filename: f.filename,
            fitKind: 'unknown',
            sourceTimestamp: null,
            created: [],
            skipped: [{ reason: 'Not a FIT file (bad header)' }],
          });
          continue;
        }
        const fit = parseFit(buf, me.timezone ?? 'UTC');
        const created = await persist(me.id, fit, source, f.filename);
        results.push({
          filename: f.filename,
          fitKind: fit.kind,
          sourceTimestamp: fit.sourceTimestamp,
          created,
          skipped: fit.skipped ?? [],
        });
      } catch (e: any) {
        results.push({
          filename: f.filename,
          fitKind: 'unknown',
          sourceTimestamp: null,
          created: [],
          skipped: [{ reason: `Decode failed: ${e?.message ?? 'unknown'}` }],
        });
      }
    }
    return { files: results };
  });

  // GET /import/summary — recent imports for the UI
  app.get('/summary', async (req) => {
    const me = await requireUser(req);
    const [recentWorkouts, recentSleep, recentSleepOnset, recentHrv] = await Promise.all([
      prisma.workout.findMany({
        where: { userId: me.id, notes: { startsWith: '[FIT]' } },
        orderBy: { performedAt: 'desc' },
        take: 10,
        select: { id: true, name: true, notes: true, performedAt: true, duration: true },
      }),
      prisma.measurement.findMany({
        where: { userId: me.id, metric: 'SLEEP_HOURS' },
        orderBy: { recordedAt: 'desc' },
        take: 7,
        select: { id: true, value: true, recordedAt: true },
      }),
      prisma.measurement.findMany({
        where: { userId: me.id, metric: 'SLEEP_ONSET' },
        orderBy: { recordedAt: 'desc' },
        take: 7,
        select: { id: true, value: true, recordedAt: true },
      }),
      prisma.measurement.findMany({
        where: { userId: me.id, metric: 'HRV' },
        orderBy: { recordedAt: 'desc' },
        take: 7,
        select: { id: true, value: true, recordedAt: true, notes: true },
      }),
    ]);
    return { recentWorkouts, recentSleep, recentSleepOnset, recentHrv };
  });

  // GET /import/bridge-summary — recent FIT files ingested via
  // the FitQuestBridge APK (importSource = BRIDGE). The /import
  // page renders this in a collapsed panel below the existing
  // "Recent imports" block so the user can confirm the bridge is
  // doing its job without mixing it into the manually-imported
  // log.
  //
  // We group by local-date in the user's tz (matching how the
  // /import page renders "Today / Tomorrow" elsewhere) so a
  // bridge batch that uploads several files around midnight
  // doesn't split weirdly across days. The activity names come
  // straight from the Workout row — `notes` is auto-populated by
  // the FIT parser with `<sport>/<subsport> · <distance> · …`.
  app.get('/bridge-summary', async (req) => {
    const me = await requireUser(req);
    const days = Math.max(1, Math.min(60, Number((req.query as any)?.days) || 14));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await prisma.workout.findMany({
      where: {
        userId: me.id,
        importSource: WorkoutSource.BRIDGE,
        performedAt: { gte: since },
      },
      orderBy: { performedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        name: true,
        notes: true,
        performedAt: true,
        duration: true,
      },
    });

    // Group by local-date string. We use Intl.DateTimeFormat so
    // the bucket respects the user's tz (vs. UTC). This is the
    // same pattern the /forecast page uses.
    const tz = me.timezone ?? 'UTC';
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const byDate = new Map<string, {
      date: string;
      count: number;
      totalDurationMin: number;
      items: Array<{ id: string; name: string | null; notes: string | null; performedAt: string; duration: number | null }>;
    }>();
    for (const r of rows) {
      const date = fmt.format(r.performedAt); // YYYY-MM-DD in tz
      const bucket = byDate.get(date) ?? {
        date,
        count: 0,
        totalDurationMin: 0,
        items: [],
      };
      bucket.count += 1;
      bucket.totalDurationMin += r.duration ?? 0;
      bucket.items.push({
        id: r.id,
        name: r.name,
        notes: r.notes,
        performedAt: r.performedAt.toISOString(),
        duration: r.duration,
      });
      byDate.set(date, bucket);
    }
    const groups = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? 1 : -1));

    return {
      days,
      totalCount: rows.length,
      groups,
    };
  });

  // ============================================================
  // POST /import/data — accept a user-export JSON payload and
  // re-create rows under the current user. Distinct from the
  // FIT-import endpoints above: those ingest wearable data,
  // this ingests our own user-data export.
  //
  // Body: { payload: ExportPayload, dryRun?: boolean, wipeFirst?: boolean }
  //
  // Body limit: 64 MB. A real user export with years of workouts
  // + measurements can run 15-30 MB; we leave headroom for big
  // imports. Caps at 64 MB to prevent runaway uploads.
  // ============================================================
  app.post('/data', { bodyLimit: 64 * 1024 * 1024 }, async (req, reply) => {
    const me = await requireUser(req);
    const body = z.object({
      payload: z.unknown(),
      dryRun: z.boolean().optional(),
      wipeFirst: z.boolean().optional(),
    }).parse(req.body);
    try {
      validatePayload(body.payload);
    } catch (e) {
      if (e instanceof ImportError) {
        return reply.code(400).send({ error: e.message });
      }
      throw e;
    }
    const result = await importExport(me.id, body.payload as any, {
      dryRun: body.dryRun,
      wipeFirst: body.wipeFirst,
    });
    return reply.send(result);
  });

  // GET /import/bridge-history — every bridge-uploaded item
  // the user has, across all three tables (Workout, Measurement,
  // DailyLog), grouped by sourceFilename. The Import page
  // renders this in a collapsed-by-default panel so the user can
  // see exactly which .fit files the bridge has uploaded
  // (including pure-sleep, pure-HRV, monitor-only files that
  // never produced a Workout row).
  //
  // If a row has sourceFilename IS NULL (legacy bridge uploads
  // before the sourceFilename migration), it's grouped under
  // "(unknown filename)" so it still surfaces in the list.
  app.get('/bridge-history', async (req) => {
    const me = await requireUser(req);
    const userId = me.id;

    // Three parallel reads, one per table. All filtered to
    // importSource = BRIDGE (well — Measurement + DailyLog don't
    // carry importSource; the bridge is the only writer that
    // sets sourceFilename on those tables, so the filename
    // filter alone is sufficient).
    const [workoutRows, measurementRows, dailyLogRows] = await Promise.all([
      prisma.workout.findMany({
        where: { userId, importSource: WorkoutSource.BRIDGE },
        orderBy: { performedAt: 'desc' },
        select: { id: true, name: true, notes: true, performedAt: true, duration: true, sourceFilename: true },
      }),
      prisma.measurement.findMany({
        where: { userId, sourceFilename: { not: null } },
        orderBy: { recordedAt: 'desc' },
        select: { id: true, metric: true, value: true, unit: true, recordedAt: true, sourceFilename: true, notes: true },
      }),
      prisma.dailyLog.findMany({
        where: { userId, sourceFilename: { not: null } },
        orderBy: { loggedAt: 'desc' },
        select: { id: true, dailyKey: true, loggedAt: true, sourceFilename: true, goldDelta: true, xpDelta: true },
      }),
    ]);

    // Normalize all rows into a single shape keyed by the
    // originating table. Union'd before grouping so a file
    // that produced 1 workout + 3 measurements + 2 daily-logs
    // shows all 6 rows under the same filename.
    type Item =
      | { kind: 'workout'; id: string; name: string | null; duration: number | null; performedAt: string; notes: string | null }
      | { kind: 'measurement'; id: string; metric: string; value: number; unit: string; recordedAt: string; notes: string | null }
      | { kind: 'daily_log'; id: string; dailyKey: string; loggedAt: string; goldDelta: number; xpDelta: number };
    const all: Array<{ filename: string; ts: string; item: Item }> = [];
    for (const w of workoutRows) {
      all.push({
        filename: w.sourceFilename ?? '(unknown)',
        ts: w.performedAt.toISOString(),
        item: { kind: 'workout', id: w.id, name: w.name, duration: w.duration, performedAt: w.performedAt.toISOString(), notes: w.notes },
      });
    }
    for (const m of measurementRows) {
      all.push({
        filename: m.sourceFilename ?? '(unknown)',
        ts: m.recordedAt.toISOString(),
        item: { kind: 'measurement', id: m.id, metric: m.metric, value: m.value, unit: m.unit, recordedAt: m.recordedAt.toISOString(), notes: m.notes },
      });
    }
    for (const d of dailyLogRows) {
      all.push({
        filename: d.sourceFilename ?? '(unknown)',
        ts: d.loggedAt.toISOString(),
        item: { kind: 'daily_log', id: d.id, dailyKey: d.dailyKey, loggedAt: d.loggedAt.toISOString(), goldDelta: d.goldDelta, xpDelta: d.xpDelta },
      });
    }

    // Group by filename.
    type FileGroup = {
      filename: string;
      firstAt: string;
      lastAt: string;
      counts: { workout: number; measurement: number; daily_log: number };
      items: Item[];
    };
    const byFile = new Map<string, FileGroup>();
    for (const { filename, ts, item } of all) {
      let g = byFile.get(filename);
      if (!g) {
        g = { filename, firstAt: ts, lastAt: ts, counts: { workout: 0, measurement: 0, daily_log: 0 }, items: [] };
        byFile.set(filename, g);
      }
      g.items.push(item);
      g.counts[item.kind] += 1;
      if (ts > g.lastAt) g.lastAt = ts;
      if (ts < g.firstAt) g.firstAt = ts;
    }
    // Newest file first.
    const files = Array.from(byFile.values()).sort((a, b) =>
      b.lastAt.localeCompare(a.lastAt),
    );
    const totalItems = all.length;
    return { totalFiles: files.length, totalItems, files };
  });
}
/**
 * Infer a 1-mile or 5K time from an imported CARDIO activity. We
 * compare the activity's distance to the target distance, allowing a
 * ±20% margin so that "ran a touch over a mile" still counts as a
 * mile (rounding-by-watch is common) but "ran a 5K loop plus an extra
 * mile warm-up" doesn't get mis-logged as a 5K.
 *
 * We only log when:
 *  - sport is running-like (run, walk, hike, trail)
 *  - duration is plausibly a race effort (4-15 min for 1mi, 14-50 min for 5K)
 *  - the inferred time would be FASTER than the user's existing best
 *    (so we don't pollute the dashboard with slower times)
 */
async function maybeInferStandardDistance(
  userId: string,
  w: { sport: string; subSport?: string; distanceMeters?: number; durationSec: number; startTime: Date },
  workoutId: string,
): Promise<void> {
  if (w.distanceMeters == null || w.distanceMeters <= 0) return;
  if (w.durationSec < 60) return; // ignore ultra-short

  const runningLike = ['running', 'walking', 'hiking', 'trail_running'];
  if (!runningLike.includes(w.sport)) return;

  const targets: Array<{
    metric: 'ONE_MILE_TIME' | 'FIVE_K_TIME';
    meters: number;
    margin: number; // fraction
    minSec: number;
    maxSec: number;
  }> = [
    { metric: 'ONE_MILE_TIME', meters: 1609.34, margin: 0.20, minSec: 4 * 60, maxSec: 15 * 60 },
    { metric: 'FIVE_K_TIME',    meters: 5000,    margin: 0.20, minSec: 14 * 60, maxSec: 50 * 60 },
  ];

  for (const t of targets) {
    const low = t.meters * (1 - t.margin);
    const high = t.meters * (1 + t.margin);
    if (w.distanceMeters < low || w.distanceMeters > high) continue;
    if (w.durationSec < t.minSec || w.durationSec > t.maxSec) continue;

    // Only log if it's faster than the user's existing best.
    const existing = await prisma.measurement.findFirst({
      where: { userId, metric: t.metric },
      orderBy: { value: 'asc' },
    });
    if (existing && existing.value <= w.durationSec) continue;

    await prisma.measurement.create({
      data: {
        userId,
        metric: t.metric,
        value: w.durationSec,
        unit: 's',
        notes: `Inferred from FIT activity ${workoutId.slice(-6)} (${(w.distanceMeters / t.meters).toFixed(2)}× target distance)`,
        recordedAt: w.startTime,
      },
    });
  }
}
