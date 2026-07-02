import { prisma } from './prisma.js';

/**
 * Per-body-part recovery model — extracted from the inline math
 * in routes/status.ts so the /forecast page can call it without
 * re-implementing the algorithm.
 *
 * Score semantics: 100 = fully recovered, 0 = maxed out.
 * Score decays exponentially with a 36h half-life since the last
 * session, scaled by the volume of that session (sets, weight,
 * duration). Pain logs penalize the score on top of volume decay.
 */

const HALF_LIFE_HOURS = 36;
const PAIN_PENALTY = 6;
const VOLUME_PER_SET = 2;
const VOLUME_PER_KG = 0.3;
const VOLUME_PER_MIN = 0.5;

export type PartRecovery = {
  bodyPart: string;
  score: number; // 0-100, rounded
  lastWorkedAt: string | null;
};

/**
 * Fallback muscle mapping for exercises without explicit
 * musclesWorked metadata. Mirrors the table in routes/status.ts
 * — kept small on purpose (just the common unlabeled names).
 * Falls back to 'core' if nothing matches.
 */
function guessMusclesForName(name: string): string[] {
  const n = name.toLowerCase();
  if (/bench|press|push.?up|dip/.test(n)) return ['chest', 'triceps', 'push'];
  if (/row|pull.?up|pulldown|pull/.test(n)) return ['back', 'biceps', 'pull'];
  if (/squat|leg|calf|lunge|hip thrust/.test(n)) return ['legs', 'glutes'];
  if (/deadlift|hinge/.test(n)) return ['back', 'legs', 'glutes'];
  if (/curl|bicep/.test(n)) return ['biceps'];
  if (/tricep|extension|pushdown/.test(n)) return ['triceps'];
  if (/shoulder|lateral|raise|ohp|military/.test(n)) return ['shoulder', 'push'];
  if (/plank|crunch|sit.?up|ab|core/.test(n)) return ['core'];
  if (/run|jog|sprint/.test(n)) return ['legs', 'cardio'];
  if (/walk/.test(n)) return ['legs', 'cardio'];
  if (/bike|cycle/.test(n)) return ['legs', 'cardio'];
  if (/yoga|stretch|mobility/.test(n)) return ['core', 'mobility'];
  return ['core'];
}

export async function partRecovery(userId: string, lookbackDays = 7): Promise<PartRecovery[]> {
  const now = Date.now();
  const sinceDate = new Date(now - lookbackDays * 24 * 60 * 60 * 1000);
  const workouts = await prisma.workout.findMany({
    where: { userId, performedAt: { gte: sinceDate } },
    include: { exercises: { include: { sets: true } } },
    orderBy: { performedAt: 'desc' },
  });
  const painLogs = await prisma.painLog.findMany({
    where: { userId, loggedAt: { gte: new Date(now - 14 * 24 * 60 * 60 * 1000) } },
  });

  type PartTotal = { lastWorkedAt: string; totalLoad: number };
  const partVolume = new Map<string, PartTotal>();
  for (const w of workouts) {
    for (const ex of w.exercises) {
      const muscles = ex.musclesWorked.length > 0 ? ex.musclesWorked : guessMusclesForName(ex.name);
      for (const muscle of muscles) {
        const prev = partVolume.get(muscle) ?? { lastWorkedAt: '', totalLoad: 0 };
        const exTime = w.performedAt.getTime();
        if (!prev.lastWorkedAt || exTime > new Date(prev.lastWorkedAt).getTime()) {
          prev.lastWorkedAt = w.performedAt.toISOString();
        }
        for (const set of ex.sets) {
          const weight = set.weight ?? 0;
          const duration = set.duration ?? 0;
          prev.totalLoad += weight * VOLUME_PER_KG + (duration / 60) * VOLUME_PER_MIN + VOLUME_PER_SET;
        }
        partVolume.set(muscle, prev);
      }
    }
  }

  type PartPain = { latest: number; avg: number; count: number };
  const partPain = new Map<string, PartPain>();
  for (const log of painLogs) {
    const prev = partPain.get(log.bodyPart) ?? { latest: 0, avg: 0, count: 0 };
    const total = prev.avg * prev.count + log.intensity;
    prev.count += 1;
    prev.avg = total / prev.count;
    if (log.intensity > prev.latest) prev.latest = log.intensity;
    partPain.set(log.bodyPart, prev);
  }

  const allParts = new Set<string>([...partVolume.keys(), ...partPain.keys()]);
  const out: PartRecovery[] = [];
  for (const part of allParts) {
    const vol = partVolume.get(part);
    const pain = partPain.get(part);
    let score = 100;
    if (vol) {
      const hoursSince = (now - new Date(vol.lastWorkedAt).getTime()) / (60 * 60 * 1000);
      const volumePenalty = vol.totalLoad;
      score = Math.max(0, 100 - volumePenalty * Math.pow(0.5, hoursSince / HALF_LIFE_HOURS));
    }
    if (pain) {
      score = Math.max(0, score - pain.avg * PAIN_PENALTY - pain.latest * 2);
    }
    out.push({
      bodyPart: part,
      score: Math.round(score),
      lastWorkedAt: vol?.lastWorkedAt ?? null,
    });
  }
  return out;
}

/**
 * Pick the muscle group best suited for today's session:
 *   - highest recovery score (most rested)
 *   - has not been worked in at least 36h (one half-life)
 *   - if multiple parts tie, prefer the larger compound group
 *     (push / pull / legs > isolation body parts)
 *
 * Returns null if the user has no recent workout data and the
 * result would be a coin flip — caller should fall back to "no
 * recommendation" copy.
 */
const COMPOUND_PRIORITY = ['push', 'pull', 'legs', 'core', 'back', 'chest', 'shoulder', 'glutes', 'biceps', 'triceps', 'mobility', 'cardio'];

export async function recommendMuscle(userId: string): Promise<PartRecovery | null> {
  const parts = await partRecovery(userId);
  if (parts.length === 0) return null;
  // Sort: highest score first, ties broken by compound-priority
  // index (lower index = higher priority).
  const ranked = [...parts].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ai = COMPOUND_PRIORITY.indexOf(a.bodyPart);
    const bi = COMPOUND_PRIORITY.indexOf(b.bodyPart);
    const aRank = ai === -1 ? 999 : ai;
    const bRank = bi === -1 ? 999 : bi;
    return aRank - bRank;
  });
  // The top recommendation should be one the user hasn't worked
  // recently. If the highest-scoring part was touched in the
  // last 12h, look further down the list. (12h is "still sore
  // territory"; the half-life decay alone handles the >36h case.)
  const RECENT_THRESHOLD_HOURS = 12;
  const now = Date.now();
  for (const p of ranked) {
    if (!p.lastWorkedAt) return p;
    const hoursSince = (now - new Date(p.lastWorkedAt).getTime()) / (60 * 60 * 1000);
    if (hoursSince >= RECENT_THRESHOLD_HOURS) return p;
  }
  return ranked[0] ?? null;
}