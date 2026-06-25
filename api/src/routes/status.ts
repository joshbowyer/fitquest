import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import type { BodyPart } from '../lib/prisma.js';

/**
 * Per-body-part recovery score (0-100).
 *
 * Recovery model: 100 = fully recovered, 0 = completely maxed.
 * Computed from:
 *  - hours since last worked (longer = more recovered)
 *  - cumulative volume/intensity in last 48h (more = less recovered)
 *  - average pain logged in last 7 days (more = less recovered)
 *
 * The constants are tuned by feel — formal exercise science
 * recovery models vary wildly by training age, sleep, nutrition.
 */
const HALF_LIFE_HOURS = 36;            // how long until half-recovered
const PAIN_PENALTY = 6;                // each pain point subtracts this much
const VOLUME_PER_SET = 2;              // recovery points per set
const VOLUME_PER_KG = 0.3;             // recovery points per kg lifted
const VOLUME_PER_MIN = 0.5;            // recovery points per minute of cardio

export async function statusRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const me = await requireUser(req);

    const now = Date.now();

    // 1. Recent workouts with exercises + sets
    const sinceDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const workouts = await prisma.workout.findMany({
      where: { userId: me.id, performedAt: { gte: sinceDate } },
      include: {
        exercises: {
          include: {
            sets: true,
          },
        },
      },
      orderBy: { performedAt: 'desc' },
    });

    // 2. Recent pain logs
    const painLogs = await prisma.painLog.findMany({
      where: { userId: me.id, loggedAt: { gte: new Date(now - 14 * 24 * 60 * 60 * 1000) } },
    });

    // 3. Aggregate muscle volume by body part. Each set
    // contributes to each muscle in the exercise's musclesWorked
    // list. Volume = sets * (weight + duration_min) proxy.
    //
    // We keep TWO levels of detail:
    //   - partVolume (per-part totals): recovery-score math
    //   - partSessions (per-part, per-workout breakdown): drives
    //     the click-list on the body avatar + the worked marker
    //
    // The session breakdown is keyed by workoutId so two sessions
    // on the same day for the same muscle show as separate entries.
    type PartTotal = {
      lastWorkedAt: string;
      totalLoad: number;
      recentSets: number;
    };
    type PartSession = {
      workoutId: string;
      workoutName: string | null;
      performedAt: string;
      setCount: number;
      totalLoad: number;
      totalVolumeKg: number;
    };
    const partVolume = new Map<string, PartTotal>();
    const partSessions = new Map<string, PartSession[]>();
    for (const w of workouts) {
      for (const ex of w.exercises) {
        const muscles = ex.musclesWorked.length > 0
          ? ex.musclesWorked
          : guessMusclesForName(ex.name);
        for (const muscle of muscles) {
          const prev = partVolume.get(muscle) ?? {
            lastWorkedAt: '',
            totalLoad: 0,
            recentSets: 0,
          };
          const exTime = w.performedAt.getTime();
          if (!prev.lastWorkedAt || exTime > new Date(prev.lastWorkedAt).getTime()) {
            prev.lastWorkedAt = w.performedAt.toISOString();
          }
          // Per-session aggregate for this exercise + muscle. We
          // init on the first set, then accumulate.
          const sessionList = partSessions.get(muscle) ?? [];
          let session = sessionList.find((s) => s.workoutId === w.id);
          if (!session) {
            session = {
              workoutId: w.id,
              workoutName: w.name ?? null,
              performedAt: w.performedAt.toISOString(),
              setCount: 0,
              totalLoad: 0,
              totalVolumeKg: 0,
            };
            sessionList.push(session);
            partSessions.set(muscle, sessionList);
          }
          for (const set of ex.sets) {
            const weight = set.weight ?? 0;
            const duration = set.duration ?? 0;
            const load = weight * VOLUME_PER_KG + (duration / 60) * VOLUME_PER_MIN + VOLUME_PER_SET;
            prev.totalLoad += load;
            prev.recentSets += 1;
            session.setCount += 1;
            session.totalLoad += load;
            session.totalVolumeKg += weight * set.reps;
          }
          partVolume.set(muscle, prev);
        }
      }
    }

    // 4. Aggregate pain by body part
    const partPain = new Map<string, { latest: number; avg: number; count: number; latestAt: string }>();
    for (const log of painLogs) {
      const prev = partPain.get(log.bodyPart) ?? { latest: 0, avg: 0, count: 0, latestAt: '' };
      const total = prev.avg * prev.count + log.intensity;
      prev.count += 1;
      prev.avg = total / prev.count;
      if (log.loggedAt.getTime() > new Date(prev.latestAt || 0).getTime() || !prev.latestAt) {
        prev.latest = log.intensity;
        prev.latestAt = log.loggedAt.toISOString();
      }
      partPain.set(log.bodyPart, prev);
    }

    // 5. Compute recovery score per part
    const allParts = new Set<string>([
      ...partVolume.keys(),
      ...partPain.keys(),
    ]);
    const recovery: Array<{
      bodyPart: string;
      score: number;
      lastWorkedAt: string | null;
    }> = [];
    for (const part of allParts) {
      const vol = partVolume.get(part);
      const pain = partPain.get(part);
      let score = 100;

      if (vol) {
        const hoursSince = (now - new Date(vol.lastWorkedAt).getTime()) / (60 * 60 * 1000);
        // Recovery grows with half-life. The volume penalty uses
        // totalLoad directly (no divisor) so heavy work genuinely
        // scores lower. A shoulder day at 9 sets × 70kg produces
        // ~180 load units; with the old /10 divisor that was
        // capped at ~18, which read as "primed" when it should
        // have read as "overloaded".
        const volumePenalty = vol.totalLoad;
        score = Math.max(0, 100 - volumePenalty * Math.pow(0.5, hoursSince / HALF_LIFE_HOURS));
      }
      if (pain) {
        // Pain pulls score down regardless of time
        score = Math.max(0, score - pain.avg * PAIN_PENALTY - pain.latest * 2);
      }
      recovery.push({
        bodyPart: part,
        score: Math.round(score),
        lastWorkedAt: vol?.lastWorkedAt ?? null,
      });
    }

    // 6. Muscle-worked markers: every part worked in last 36h.
    // Window matches the click-list cutoff. Intensity bands:
    //   light    1-2 sets      (opacity ~30%)
    //   moderate 3-5 sets      (opacity ~60%)
    //   heavy    6+ sets       (opacity ~100%)
    // The frontend maps these to color saturation/brightness.
    const RECENT_WINDOW_MS = 36 * 60 * 60 * 1000;
    const worked = [...partVolume.entries()]
      .filter(([_, v]) => (now - new Date(v.lastWorkedAt).getTime()) < RECENT_WINDOW_MS)
      .map(([bodyPart, v]) => ({
        bodyPart,
        workedAt: v.lastWorkedAt,
        setCount: v.recentSets,
        totalLoad: Math.round(v.totalLoad),
        // Legacy 0-10 intensity (kept for back-compat with any
        // older clients). New clients should use setCount +
        // bandForSetCount() to drive the color.
        intensity: Math.min(10, Math.round(v.totalLoad / 5)),
        sessions: (partSessions.get(bodyPart) ?? [])
          .filter((s) => (now - new Date(s.performedAt).getTime()) < RECENT_WINDOW_MS)
          .map((s) => ({
            workoutId: s.workoutId,
            workoutName: s.workoutName,
            performedAt: s.performedAt,
            setCount: s.setCount,
            totalVolumeKg: Math.round(s.totalVolumeKg),
          })),
      }));

    return {
      recovery,
      worked,
      pain: painLogs.slice(0, 50).map((p) => ({
        id: p.id,
        bodyPart: p.bodyPart,
        intensity: p.intensity,
        notes: p.notes,
        loggedAt: p.loggedAt.toISOString(),
      })),
      painSummary: Object.fromEntries(
        [...partPain.entries()].map(([k, v]) => [k, {
          latest: v.latest,
          avg: v.avg,
          count: v.count,
          latestAt: v.latestAt,
        }]),
      ),
      recentWindowHours: 36,
    };
  });

  // GET /status/part/:bodyPart/exercises?since=<iso>
  // Returns the workouts + exercises that contributed to a body
  // part in the given window. Server-side cutoff so the client
  // can't ask for ancient data. Window is hard-capped at 36h —
  // anything older is irrelevant to "did I work this yesterday
  // or today?".
  app.get('/part/:bodyPart/exercises', async (req, reply) => {
    const me = await requireUser(req);
    const { bodyPart } = req.params as { bodyPart: string };
    const query = req.query as { since?: string };
    const since = query.since ? new Date(query.since) : new Date(Date.now() - 36 * 60 * 60 * 1000);
    if (isNaN(since.getTime())) {
      return reply.code(400).send({ error: 'invalid_since' });
    }
    // Hard-cap the lookback to 36h so the response can't grow
    // unbounded if the client asks for a year.
    const minSince = new Date(Date.now() - 36 * 60 * 60 * 1000);
    const effectiveSince = since.getTime() < minSince.getTime() ? minSince : since;

    const workouts = await prisma.workout.findMany({
      where: {
        userId: me.id,
        performedAt: { gte: effectiveSince },
        exercises: { some: { musclesWorked: { has: bodyPart as BodyPart } } },
      },
      include: {
        exercises: {
          where: { musclesWorked: { has: bodyPart as BodyPart } },
          include: { sets: true },
        },
      },
      orderBy: { performedAt: 'desc' },
      take: 20,
    });

    return {
      bodyPart,
      since: effectiveSince.toISOString(),
      windowHours: 36,
      workouts: workouts.map((w) => ({
        id: w.id,
        name: w.name,
        type: w.type,
        performedAt: w.performedAt.toISOString(),
        exercises: w.exercises.map((ex) => ({
          id: ex.id,
          name: ex.name,
          setCount: ex.sets.length,
          totalVolumeKg: Math.round(
            ex.sets.reduce((s, st) => s + (st.weight ?? 0) * st.reps, 0)
          ),
          topSet: ex.sets.length > 0
            ? ex.sets.reduce(
                (best, st) => ((st.weight ?? 0) > (best.weight ?? 0) ? st : best),
                ex.sets[0],
              )
            : null,
        })),
      })),
    };
  });
}

// Heuristic muscle mapping when the exercise hasn't been tagged
// yet (legacy data). Mirrors web/src/lib/muscles.ts but in JS.
function guessMusclesForName(name: string): string[] {
  const lower = name.toLowerCase();
  const out = new Set<string>();
  if (/bench|press|fly|push.?up|chest/.test(lower)) {
    ['PECTORAL', 'TRICEP_L', 'TRICEP_R', 'SHOULDER_L', 'SHOULDER_R'].forEach((x) => out.add(x));
  }
  if (/row|pull|pulldown|chin|back|lat/.test(lower)) {
    ['LAT_L', 'LAT_R', 'BICEP_L', 'BICEP_R', 'TRAPS'].forEach((x) => out.add(x));
  }
  if (/deadlift|rdl|romanian/.test(lower)) {
    ['BACK_LOWER', 'HAMSTRING_L', 'HAMSTRING_R', 'GLUTE_L', 'GLUTE_R', 'TRAPS'].forEach((x) => out.add(x));
  }
  if (/squat|lunge|split|leg press|leg extension/.test(lower)) {
    ['QUAD_L', 'QUAD_R', 'GLUTE_L', 'GLUTE_R'].forEach((x) => out.add(x));
  }
  if (/leg curl|stiff|good morning/.test(lower)) {
    ['HAMSTRING_L', 'HAMSTRING_R'].forEach((x) => out.add(x));
  }
  if (/curl/.test(lower) && !/leg/.test(lower)) {
    ['BICEP_L', 'BICEP_R'].forEach((x) => out.add(x));
  }
  if (/tricep|skull|pushdown|close.?grip/.test(lower)) {
    ['TRICEP_L', 'TRICEP_R'].forEach((x) => out.add(x));
  }
  if (/calf/.test(lower)) {
    ['CALF_L', 'CALF_R'].forEach((x) => out.add(x));
  }
  if (/crunch|sit.?up|plank|ab wheel|leg raise/.test(lower)) {
    out.add('ABS');
  }
  if (/ohp|military|shoulder press|lateral raise|upright row/.test(lower)) {
    ['SHOULDER_L', 'SHOULDER_R'].forEach((x) => out.add(x));
  }
  return [...out];
}