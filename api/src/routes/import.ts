import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { parseFit, isFitBuffer, type FitImportResult, type FitKind } from '../lib/fit.js';
import { checkAchievements } from '../lib/achievements.js';
import { checkRoutineProgress } from './routine.js';

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
      const duration = w.durationSec;
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
          name: `FIT import: ${w.sport}`,
          duration,
          notes: `[FIT] ${notes}`,
          performedAt: w.startTime,
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
        summary: `${w.sport} · ${Math.round(duration / 60)}m`,
      });
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
}