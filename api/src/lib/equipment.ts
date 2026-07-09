import { prisma } from './prisma.js';

/**
 * Equipment-driven combat bonus derived from the user's currently
 * equipped gear. Used as the optional 3rd arg to
 * `computeRaidDamage` so the per-set roll loop and final damage
 * assembly can see the gear bonuses without re-querying Prisma.
 *
 * All fields are RAW (unclamped) values summed from the equipped
 * ItemDef.stats JSON. Clamping happens inside `computeRaidDamage`
 * where the per-workout base is known — e.g. flatDmg is clamped
 * to `base` to stop a strong mythic ring from dominating a junk
 * workout, crit is clamped to 0.5 to prevent near-100% crit
 * with stacked gear, setDmgPct is a generic tier constant.
 */
export type EquipBonus = {
  flatDmg?: number;
  crit?: number;
  disc?: number;
  setDmgPct?: number;
};

/**
 * Generic set-bonus tier table. The HIGHEST tier reached for a
 * given set wins (3pc → 0.03, 6pc → 0.08); tiers do NOT stack
 * within a single set. Different sets' bonuses SUM (e.g. tron×3
 * + iron_pact×4 = 0.06, still less than one 8% full set).
 *
 * No per-set config table yet — the design is YAGNI for v1
 * (oracle-approved). If a set needs a custom curve later, the
 * call site is centralized here.
 */
const SET_BONUS_TIERS = { 3: 0.03, 6: 0.08 } as const;
// Sorted descending so the first match in the loop is the highest tier.
const SET_BONUS_TIER_KEYS_DESC: readonly number[] = Object.keys(SET_BONUS_TIERS)
  .map(Number)
  .sort((a, b) => b - a);

/**
 * Whitelist of stat keys wired into v1 combat math. Other stat
 * keys (+EVA, +HEAL, +BURST, +DEF, +HP, +XP, +GOLD) are still
 * summed into `statTotals` (for the inventory frontend display,
 * including the upcoming "Dormant (future update)" group) but
 * are NEVER read for the equip-derived bonus. Guards against a
 * future seed typo like `'+DMGG': 100` being silently treated as
 * `'+DMG': 100` by the raid-damage math.
 */
const ACTIVE_EQUIP_STAT_KEYS = new Set(['+DMG', '+CRIT', '+DISC']);

/**
 * Compute the user's equipped-bonus payload:
 *   - `statTotals`: rolled-up stats from all equipped gear (the
 *     same totals the /inventory/stats route returns today — used
 *     verbatim by the inventory frontend).
 *   - `setCounts`: set-piece counts per setId.
 *   - `equip`: the v1-active combat bonus consumed by
 *     `computeRaidDamage` (flatDmg / crit / disc / setDmgPct).
 *
 * The totals and setCounts loops are extracted verbatim from the
 * previous `/inventory/stats` route implementation
 * (routes/inventory.ts:60-81) so behavior is identical. The
 * equip derivation is new and is whitelisted to the v1-active
 * stat keys.
 */
export async function getEquippedBonus(userId: string): Promise<{
  statTotals: Record<string, number>;
  setCounts: Record<string, number>;
  equip: EquipBonus;
}> {
  // Same query as the old /inventory/stats route — include the
  // joined ItemDef so we can read both `stats` and `setId` from
  // each row in a single round trip.
  const equipped = await prisma.inventoryItem.findMany({
    where: { userId, equippedSlot: { not: null } },
    include: { itemDef: true },
  });

  // Stat totals — VERBATIM from the old /inventory/stats route
  // (inventory.ts:66-72). Frontend reads this for the inventory
  // page display and the upcoming "Dormant stats" group; any
  // future stat key is preserved here for the display.
  const statTotals: Record<string, number> = {};
  for (const it of equipped) {
    const stats = (it.itemDef.stats as Record<string, number>) ?? {};
    for (const [k, v] of Object.entries(stats)) {
      statTotals[k] = (statTotals[k] ?? 0) + v;
    }
  }

  // Set piece counts — VERBATIM from the old route
  // (inventory.ts:74-79).
  const setCounts: Record<string, number> = {};
  for (const it of equipped) {
    if (it.itemDef.setId) {
      setCounts[it.itemDef.setId] = (setCounts[it.itemDef.setId] ?? 0) + 1;
    }
  }

  // Set bonus %: for each distinct set, pick the HIGHEST tier
  // reached (does NOT stack 3pc + 6pc for the same set), then
  // SUM across all distinct sets. iron_pact (max 4pc wearable)
  // can only ever reach tier 1 — no special-casing needed.
  let setDmgPct = 0;
  for (const count of Object.values(setCounts)) {
    for (const tier of SET_BONUS_TIER_KEYS_DESC) {
      if (count >= tier) {
        setDmgPct += SET_BONUS_TIERS[tier as keyof typeof SET_BONUS_TIERS];
        break;
      }
    }
  }

  // Equip-derived combat bonus. ONLY reads the whitelisted keys
  // (see ACTIVE_EQUIP_STAT_KEYS) — typo'd or future-unknown keys
  // are ignored here even if they were summed into statTotals.
  // Values are raw/unclamped; clamping happens in computeRaidDamage.
  const equip: EquipBonus = {
    flatDmg: ACTIVE_EQUIP_STAT_KEYS.has('+DMG') ? (statTotals['+DMG'] ?? 0) : 0,
    crit: ACTIVE_EQUIP_STAT_KEYS.has('+CRIT') ? (statTotals['+CRIT'] ?? 0) : 0,
    disc: ACTIVE_EQUIP_STAT_KEYS.has('+DISC') ? (statTotals['+DISC'] ?? 0) : 0,
    setDmgPct,
  };

  return { statTotals, setCounts, equip };
}
