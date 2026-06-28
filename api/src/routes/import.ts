import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { parseFit, isFitBuffer, type FitImportResult, type FitKind } from '../lib/fit.js';
import { checkAchievements } from '../lib/achievements.js';
import { checkRoutineProgress } from './routine.js';
import { activityTitle } from '../lib/geo.js';
import { importExport, ImportError, validatePayload } from '../lib/import.js';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB — well above any FIT we'll see

const bodyLimit = 60 * 1024 * 1024; // Fastify body limit; pair with our 50MB cap

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
      const created_row = await prisma.workout.create({
        data: {
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
          performedAt: w.startTime,
          trackJson: (w.trackpoints ?? []) as any,
        },
      });
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
      const created_row = await prisma.measurement.create({
        data: {
          userId,
          metric: m.metric as any,
          value: m.value,
          unit: unitFor(m.metric),
          notes: m.notes ?? null,
          recordedAt: m.recordedAt,
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
    const fit = parseFit(buf);
    const created = await persist(me.id, fit);
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
  app.post('/batch', { bodyLimit }, async (req, reply) => {
    const me = await requireUser(req);
    const body = z.object({
      files: z.array(z.object({
        filename: z.string().min(1).max(200),
        contentBase64: z.string().min(1),
      })).min(1).max(50),
    }).parse(req.body);
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
        const fit = parseFit(buf);
        const created = await persist(me.id, fit);
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
    const [recentWorkouts, recentSleep, recentHrv] = await Promise.all([
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
        where: { userId: me.id, metric: 'HRV' },
        orderBy: { recordedAt: 'desc' },
        take: 7,
        select: { id: true, value: true, recordedAt: true, notes: true },
      }),
    ]);
    return { recentWorkouts, recentSleep, recentHrv };
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
