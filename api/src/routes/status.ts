import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import type { BodyPart } from '@prisma/client';

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

    // 3. Aggregate muscle volume by body part
    // Each set contributes to each muscle in the exercise's musclesWorked list.
    // Volume = sets * (weight + duration_min) proxy.
    const partVolume = new Map<string, { lastWorkedAt: string; totalLoad: number; recentSets: number }>();
    for (const w of workouts) {
      for (const ex of w.exercises) {
        const muscles = ex.musclesWorked.length > 0
          ? ex.musclesWorked
          : guessMusclesForName(ex.name);
        for (const muscle of muscles) {
          const prev = partVolume.get(muscle) ?? { lastWorkedAt: '', totalLoad: 0, recentSets: 0 };
          const exTime = w.performedAt.getTime();
          if (!prev.lastWorkedAt || exTime > new Date(prev.lastWorkedAt).getTime()) {
            prev.lastWorkedAt = w.performedAt.toISOString();
          }
          for (const set of ex.sets) {
            const weight = set.weight ?? 0;
            const duration = set.duration ?? 0;
            const load = weight * VOLUME_PER_KG + (duration / 60) * VOLUME_PER_MIN + VOLUME_PER_SET;
            prev.totalLoad += load;
            prev.recentSets += 1;
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
        // Recovery grows with half-life: score = 100 - 50 * 2^(-hours / halfLife)
        // But we cap the lower bound by volume: more volume = need more time
        const volumePenalty = Math.min(80, vol.totalLoad / 10);
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

    // 6. Muscle-worked markers: every part worked in last 48h
    const worked = [...partVolume.entries()]
      .filter(([_, v]) => (now - new Date(v.lastWorkedAt).getTime()) < 48 * 60 * 60 * 1000)
      .map(([bodyPart, v]) => ({
        bodyPart,
        workedAt: v.lastWorkedAt,
        intensity: Math.min(10, Math.round(v.totalLoad / 5)),
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