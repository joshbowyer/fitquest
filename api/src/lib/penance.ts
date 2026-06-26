import { prisma } from './prisma.js';
import type { ShieldTier } from './prisma.js';

/**
 * Home-base shield + penance system.
 *
 * Each user has a HomeBase row with a shield value (0-100). The
 * tier is derived from the value but stored so we can filter on
 * it without re-deriving.
 *
 *   FORTIFIED    90-100   no monsters can enter
 *   STABLE       60-89    normal defense
 *   COMPROMISED  30-59    portal leaks possible (Phase 2)
 *   BREECHED     0-29     monsters trickle in + daily chip damage
 *
 * Penances are templates (system defaults + user-custom) that fire
 * on events and adjust the shield by their `shieldDelta`. After
 * each adjustment the value is clamped to [0, 100] and the tier
 * is re-derived.
 *
 * The Breach (level-10 unlock) will multiply boss damage by tier
 * — FORTIFIED halves incoming damage, BREECHED doubles it. That
 * integration is Phase 2; this commit ships the foundation +
 * triggers so the dashboard widget + home-base page can render.
 */

export type PenanceKey =
  | 'missed_workout'
  | 'substance_overuse'
  | 'logged_mobility'
  | 'logged_cardio_30'
  | 'substance_checkin'
  | 'substance_free_day'
  | 'hit_protein_target'
  | 'hit_water_target'
  | 'completed_prayer'
  | 'missed_all_dailies'
  // New items (2026-06-26): wider penance menu so users can both
  // hurt AND repair the shield through more daily actions.
  | 'missed_sleep'           // logged <6h sleep
  | 'late_night_log'         // logged a meal/workout after midnight
  | 'broke_streak'           // workout streak reset
  | 'perfect_day'            // all dailies + workout + targets met
  | 'streak_7day'            // hit a 7-day streak milestone
  | 'log_stretch'            // dedicated stretch / yoga session
  | 'meal_logged'            // every meal entry adds a small bump
  | 'checkin_am'             // morning check-in completed
  | 'checkin_pm'             // evening check-in completed
  | 'checkin_weekly'         // weekly check-in completed
  | 'custom';

export const PENANCE_DELTAS: Record<Exclude<PenanceKey, 'custom'>, number> = {
  // Damage penances (negative).
  missed_workout: -15,
  missed_all_dailies: -20,    // bumped from -5 → every daily missed
                                   // in a day is a real hit now
  missed_sleep: -10,           // <6h sleep logged
  late_night_log: -8,         // any log after midnight
  broke_streak: -12,          // workout streak reset
  substance_overuse: -20,
  // Repair penances (positive).
  substance_checkin: 2,
  substance_free_day: 5,
  logged_mobility: 8,
  logged_cardio_30: 6,
  log_stretch: 4,              // dedicated stretch / yoga
  hit_protein_target: 4,
  hit_water_target: 3,
  completed_prayer: 4,
  meal_logged: 1,              // small per-meal bump
  checkin_am: 3,               // morning check-in
  checkin_pm: 3,               // evening check-in
  checkin_weekly: 5,           // weekly check-in
  perfect_day: 12,             // all dailies + workout + targets
  streak_7day: 8,              // 7-day streak milestone
};

export const PENANCE_LABELS: Record<Exclude<PenanceKey, 'custom'>, string> = {
  missed_workout: 'Skipped the forge',
  missed_all_dailies: 'Quiet at home',
  missed_sleep: 'Slept short',
  late_night_log: 'Late-night log',
  broke_streak: 'Streak broken',
  substance_overuse: 'Toxic indulgence',
  substance_checkin: 'Honest reckoning',
  substance_free_day: 'Temperance',
  logged_mobility: 'Tended the hinges',
  logged_cardio_30: 'Scouted the perimeter',
  log_stretch: 'Stretched the sinew',
  hit_protein_target: 'Strong provisions',
  hit_water_target: 'Refreshed the well',
  completed_prayer: 'Lit the lamp',
  meal_logged: 'Logged a meal',
  checkin_am: 'Morning check-in',
  checkin_pm: 'Evening check-in',
  checkin_weekly: 'Weekly check-in',
  perfect_day: 'Perfect day',
  streak_7day: '7-day streak',
};

export const PENANCE_FLAVORS: Record<Exclude<PenanceKey, 'custom'>, string> = {
  missed_workout: 'A planned session was left undone. The forge cools.',
  missed_all_dailies: 'Every daily for the day was left unchecked. The walls go quiet.',
  missed_sleep: 'Less than six hours logged. The walls need rest, not you.',
  late_night_log: 'A log after midnight — the watch was asleep.',
  broke_streak: 'The streak that held for days is broken. Rebuild.',
  substance_overuse: 'Hardcore caps exceeded — the walls remember.',
  substance_checkin: 'Honest reckoning with what was taken.',
  substance_free_day: 'A day with no alcohol — clear-headed walls stand stronger.',
  logged_mobility: 'Tendons and joints tended to.',
  logged_cardio_30: '30+ minutes of cardio logged — scouts out the perimeter.',
  log_stretch: 'A dedicated stretch. Sinew remembers, sinew forgives.',
  hit_protein_target: 'Protein target met — strong provisions stocked.',
  hit_water_target: 'Water target met — the well is fresh.',
  completed_prayer: 'Daily prayer completed — the lamp is lit.',
  meal_logged: 'A meal entry written. The larder is honest.',
  checkin_am: 'Morning check-in. The walls wake with you.',
  checkin_pm: 'Evening check-in. The walls close the day with you.',
  checkin_weekly: 'Weekly check-in. The long view is kept.',
  perfect_day: 'Every daily, every target, every box. The walls shine.',
  streak_7day: 'A 7-day streak holds. The walls remember your rhythm.',
};

/** Map a shield value (0-100) to its tier. */
export function tierForShield(shield: number): ShieldTier {
  if (shield >= 90) return 'FORTIFIED';
  if (shield >= 60) return 'STABLE';
  if (shield >= 30) return 'COMPROMISED';
  return 'BREECHED';
}

/** Human-readable label for each tier (for UI display). */
export const TIER_LABEL: Record<ShieldTier, string> = {
  FORTIFIED: 'Fortified',
  STABLE: 'Stable',
  COMPROMISED: 'Compromised',
  BREECHED: 'Breached',
};

/** Color hint for each tier (matches the cyberpunk theme palette). */
export const TIER_COLOR: Record<ShieldTier, string> = {
  FORTIFIED: '#56e88e',     // neon-lime
  STABLE: '#14d6e8',        // neon-cyan
  COMPROMISED: '#ffaa3a',   // neon-amber
  BREECHED: '#dc2626',      // neon-red
};

/** Clamp shield to [0, 100]. */
export function clampShield(v: number): number {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

/**
 * Get-or-create the user's HomeBase. Every user has exactly one
 * row; lazily created on first shield-touch (first penance fire,
 * first home-base GET, etc.) so we don't have to seed them up-front.
 */
export async function getOrCreateHomeBase(userId: string): Promise<{
  id: string;
  shield: number;
  tier: ShieldTier;
}> {
  let row = await prisma.homeBase.findUnique({ where: { userId } });
  if (!row) {
    row = await prisma.homeBase.create({
      data: { userId, shield: 100, tier: 'FORTIFIED' },
    });
  }
  return { id: row.id, shield: row.shield, tier: row.tier };
}

/**
 * Resolve a penance template for a (userId, key) pair. User-scoped
 * templates shadow system defaults. Returns null when no enabled
 * template exists for the key.
 *
 * System defaults are NOT stored as DB rows — they're exported as
 * constants at the top of this module (PENANCE_DELTAS, PENANCE_LABELS,
 * PENANCE_FLAVORS). This avoids the sentinel-user / FK-violation
 * problem and means the defaults are always available, even on a
 * fresh DB without any seeded rows.
 *
 * Disabled user templates still shadow the default — this lets the
 * user opt out of a default without losing the "this penance exists"
 * signal elsewhere. System defaults can be implicitly disabled
 * by creating a user template with `enabled: false`.
 */
export async function resolvePenance(
  userId: string,
  key: PenanceKey,
): Promise<{ id: string; label: string; shieldDelta: number; flavor: string | null; isUserOverride: boolean } | null> {
  // User template first (shadows system).
  const userTpl = await prisma.penanceTemplate.findUnique({
    where: { userId_key: { userId, key } },
  });
  if (userTpl) {
    if (!userTpl.enabled) return null;
    return {
      id: userTpl.id,
      label: userTpl.label,
      shieldDelta: userTpl.shieldDelta,
      flavor: userTpl.flavor,
      isUserOverride: true,
    };
  }
  // System default from constants.
  const delta = PENANCE_DELTAS[key];
  if (delta == null) return null;
  return {
    id: `system:${key}`,
    label: PENANCE_LABELS[key],
    shieldDelta: delta,
    flavor: PENANCE_FLAVORS[key],
    isUserOverride: false,
  };
}

/**
 * Fire a penance for a user. Looks up the template, applies the
 * delta to the user's shield (clamped), updates the tier, writes a
 * PenanceEvent audit row, and returns the resulting state. No-op
 * (returns null) when no enabled template exists for the key —
 * callers can safely fire-and-forget.
 *
 * Use a transaction so the HomeBase update and the PenanceEvent
 * insert commit atomically. A failed insert doesn't half-decay
 * the shield.
 */
export async function firePenance(
  userId: string,
  key: PenanceKey,
  source: 'workout_commit' | 'substance_log' | 'daily_missed' | 'daily_completed' | 'nutrition_target' | 'auto_decay' | 'manual',
): Promise<{
  shieldBefore: number;
  shieldAfter: number;
  tierBefore: ShieldTier;
  tierAfter: ShieldTier;
  label: string;
} | null> {
  const tpl = await resolvePenance(userId, key);
  if (!tpl) return null;
  if (tpl.shieldDelta === 0) return null;

  return await prisma.$transaction(async (tx) => {
    const base = await tx.homeBase.upsert({
      where: { userId },
      create: { userId, shield: 100, tier: 'FORTIFIED' },
      update: {},
    });
    const shieldBefore = base.shield;
    const tierBefore = base.tier;
    const shieldAfter = clampShield(shieldBefore + tpl.shieldDelta);
    const tierAfter = tierForShield(shieldAfter);

    await tx.homeBase.update({
      where: { userId },
      data: { shield: shieldAfter, tier: tierAfter },
    });
    await tx.penanceEvent.create({
      data: {
        userId,
        penanceKey: key,
        label: tpl.label,
        shieldDelta: tpl.shieldDelta,
        shieldAfter,
        tierAfter,
        source,
      },
    });
    return { shieldBefore, shieldAfter, tierBefore, tierAfter, label: tpl.label };
  });
}

/**
 * Fire several penances in one go. Used by the nightly decay
 * sweep (where missed-daily + missed-workout + etc. all apply at
 * once) and by the dashboard widget's "preflight" before the
 * morning report.
 *
 * Returns the list of (key, applied-state) pairs so the caller
 * can show what fired.
 */
export async function firePenances(
  userId: string,
  fires: Array<{
    key: PenanceKey;
    source: 'workout_commit' | 'substance_log' | 'daily_missed' | 'daily_completed' | 'nutrition_target' | 'auto_decay' | 'manual';
  }>,
): Promise<Array<{
  key: PenanceKey;
  shieldBefore: number;
  shieldAfter: number;
  tierBefore: ShieldTier;
  tierAfter: ShieldTier;
  label: string;
}>> {
  const out: Array<{
    key: PenanceKey;
    shieldBefore: number;
    shieldAfter: number;
    tierBefore: ShieldTier;
    tierAfter: ShieldTier;
    label: string;
  }> = [];
  for (const f of fires) {
    const r = await firePenance(userId, f.key, f.source);
    if (r) {
      out.push({ key: f.key, ...r });
      // Spawn check after each penance fire. After any shield
      // drop, roll the dice: if tier is COMPROMISED or worse,
      // there's a chance a portal leak spawns at home base.
      // No-op if an active leak exists or the 24h cooldown
      // hasn't elapsed. Best-effort — a spawn failure must not
      // block the penance result.
      if (r.shieldAfter < r.shieldBefore) {
        try {
          const { maybeSpawnLeak } = await import('./portalLeaks.js');
          await maybeSpawnLeak(userId, r.shieldAfter);
        } catch {
          // Swallow — leak system is best-effort.
        }
      }
    }
  }
  return out;
}

/**
 * Fetch the user's recent penance events for the home-base feed.
 * Newest first; capped to N rows for UI sanity.
 */
export async function recentPenanceEvents(
  userId: string,
  limit: number = 20,
): Promise<Array<{
  id: string;
  penanceKey: string;
  label: string;
  shieldDelta: number;
  shieldAfter: number;
  tierAfter: ShieldTier;
  source: string;
  createdAt: Date;
}>> {
  const rows = await prisma.penanceEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    penanceKey: r.penanceKey,
    label: r.label,
    shieldDelta: r.shieldDelta,
    shieldAfter: r.shieldAfter,
    tierAfter: r.tierAfter,
    source: r.source,
    createdAt: r.createdAt,
  }));
}
