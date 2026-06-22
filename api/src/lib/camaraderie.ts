import { prisma } from './prisma.js';

// Camraderie is the per-party 0-100 "bond" score. See roadmap
// §32 for unlocks. The titles are pure UI sugar — the schema
// stores just the int + a tier string for queries.
//
// Source of truth for tier thresholds. Anything below 25 is
// "Cold" because we want the early game to feel like there's
// room to grow into something.

export const CAMARADERIE_TIERS = [
  { min: 90, name: 'Kindred' },
  { min: 75, name: 'Sworn' },
  { min: 50, name: 'Iron Bond' },
  { min: 25, name: 'Warm' },
  { min: 0, name: 'Cold' },
] as const;

export function tierFor(score: number): string {
  for (const t of CAMARADERIE_TIERS) {
    if (score >= t.min) return t.name;
  }
  return 'Cold';
}

const HISTORY_LIMIT = 50;

/**
 * Get-or-create the camaraderie row for a party. Idempotent.
 * Always returns a row with a tier string computed from the
 * current score.
 */
export async function getCamaraderie(partyId: string): Promise<{
  partyId: string;
  score: number;
  tier: string;
  history: Array<{ at: string; delta: number; reason: string }>;
  updatedAt: Date;
}> {
  let row = await prisma.partyCamaraderie.findUnique({ where: { partyId } });
  if (!row) {
    row = await prisma.partyCamaraderie.create({
      data: { partyId, score: 0, tier: 'Cold', history: [] },
    });
  }
  return {
    partyId: row.partyId,
    score: row.score,
    tier: row.tier,
    history: Array.isArray(row.history) ? (row.history as any) : [],
    updatedAt: row.updatedAt,
  };
}

/**
 * Apply a delta with a reason. Score is clamped to [0, 100].
 * History keeps the last 50 entries with timestamps so the
 * /party page can render a "why is my score X?" log.
 */
export async function adjustCamaraderie(
  partyId: string,
  delta: number,
  reason: string
): Promise<{ score: number; tier: string }> {
  const current = await getCamaraderie(partyId);
  const next = Math.max(0, Math.min(100, current.score + delta));
  const history = [
    { at: new Date().toISOString(), delta, reason },
    ...current.history,
  ].slice(0, HISTORY_LIMIT);
  const tier = tierFor(next);
  await prisma.partyCamaraderie.upsert({
    where: { partyId },
    create: { partyId, score: next, tier, history },
    update: { score: next, tier, history },
  });
  return { score: next, tier };
}

/**
 * Daily decay — run by the nightly cron. -1 per day of party
 * inactivity (no shared workout, no shared daily, no raid
 * success in the last 24h). Caps at 0.
 *
 * We track "activity seen in the last 24h" via a simple
 * "did anything happen" check across the most-recent
 * TeamWorkout (status=COMPLETED in last 24h), Raid
 * (startedAt in last 24h), and DailyLog shared activity.
 * For v1 we just check TeamWorkout + Raid; shared-dailies
 * is post-MVP.
 */
export async function applyDailyDecayForAllParties(): Promise<{
  parties: number;
  decayed: number;
}> {
  const parties = await prisma.party.findMany({ select: { id: true } });
  let decayed = 0;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const p of parties) {
    const [recentTw, recentRaid] = await Promise.all([
      prisma.teamWorkout.count({
        where: { partyId: p.id, completedAt: { gte: since } },
      }),
      prisma.raid.count({
        where: { partyId: p.id, startedAt: { gte: since } },
      }),
    ]);
    if (recentTw + recentRaid === 0) {
      await adjustCamaraderie(p.id, -1, 'daily decay (no shared activity)');
      decayed++;
    }
  }
  return { parties: parties.length, decayed };
}

/**
 * Apply a leaving penalty (-5) when a user removes themselves
 * from a party. Tied into the parties route on user removal.
 */
export async function applyLeavePenalty(partyId: string, username: string): Promise<void> {
  await adjustCamaraderie(partyId, -5, `member left: ${username}`);
}