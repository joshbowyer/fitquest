/**
 * Tests for the new equipment helper (`api/src/lib/equipment.ts`).
 *
 * Verifies:
 *  - statTotals / setCounts computed from mocked InventoryItems
 *    (same loops the old /inventory/stats route had, verbatim).
 *  - The defensive whitelist on the equip derivation: typo'd or
 *    future-unknown stat keys never leak into the EquipBonus that
 *    feeds into computeRaidDamage.
 *  - Malformed stats JSON (null / non-object) doesn't crash the
 *    helper.
 *  - setDmgPct per-set logic: <3pc = 0, 3pc-only = 0.03, 6pc = 0.08
 *    (highest tier wins, does NOT stack 3+6 for the same set).
 *  - setDmgPct across distinct sets: 3pc tron + 4pc iron_pact =
 *    0.06 (different sets' bonuses ADD).
 *  - The mythic ring stress test item (ring_mythic_blood) derives
 *    the expected raw equip values without clamping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => {
  // Shared in-memory store so each test can populate equipped items
  // and the mocked findMany() returns them. Mirrors the pattern
  // used in adminItemsReset.test.ts.
  const store: any = { inventoryItems: [] };
  return {
    prisma: {
      inventoryItem: {
        findMany: vi.fn(async ({ where }: any = {}) => {
          return store.inventoryItems.filter((ii: any) => {
            if (where?.userId && ii.userId !== where.userId) return false;
            if (where?.equippedSlot) {
              if (typeof where.equippedSlot === 'string') {
                if (ii.equippedSlot !== where.equippedSlot) return false;
              } else if (where.equippedSlot?.not === null) {
                // Prisma `{ equippedSlot: { not: null } }` filter
                if (ii.equippedSlot == null) return false;
              }
            }
            return true;
          });
        }),
      },
    },
    __store: store,
  };
});

import { getEquippedBonus } from '../lib/equipment.js';

// `__store` is a test-only escape hatch exposed by the prisma mock
// (above) but the real `lib/prisma` module's type doesn't declare
// it, so cast the import to access it.
const store: any = (await import('../lib/prisma') as any).__store;

beforeEach(() => {
  store.inventoryItems = [];
});

describe('getEquippedBonus', () => {
  it('returns empty totals / setCounts / zero equip when nothing is equipped', async () => {
    const r = await getEquippedBonus('u-1');
    expect(r.statTotals).toEqual({});
    expect(r.setCounts).toEqual({});
    expect(r.equip).toEqual({ flatDmg: 0, crit: 0, disc: 0, setDmgPct: 0 });
  });

  it('sums statTotals across all equipped items (verbatim like the old /inventory/stats route)', async () => {
    store.inventoryItems = [
      { id: 'ii-1', userId: 'u-1', equippedSlot: 'BODY', itemDef: { id: 'a', stats: { '+DMG': 10, '+CRIT': 0.05 }, setId: null } },
      { id: 'ii-2', userId: 'u-1', equippedSlot: 'MAIN', itemDef: { id: 'b', stats: { '+DMG': 15, '+DISC': 0.10 }, setId: null } },
    ];
    const r = await getEquippedBonus('u-1');
    expect(r.statTotals).toEqual({ '+DMG': 25, '+CRIT': 0.05, '+DISC': 0.10 });
  });

  it('counts set pieces per setId (verbatim like the old /inventory/stats route)', async () => {
    store.inventoryItems = [
      { id: 'ii-1', userId: 'u-1', equippedSlot: 'BODY', itemDef: { id: 'a', stats: {}, setId: 'tron_set' } },
      { id: 'ii-2', userId: 'u-1', equippedSlot: 'MAIN', itemDef: { id: 'b', stats: {}, setId: 'tron_set' } },
      { id: 'ii-3', userId: 'u-1', equippedSlot: 'NECK', itemDef: { id: 'c', stats: {}, setId: 'iron_pact' } },
    ];
    const r = await getEquippedBonus('u-1');
    expect(r.setCounts).toEqual({ tron_set: 2, iron_pact: 1 });
  });

  it('derives equip.flatDmg / crit / disc from statTotals (raw, unclamped)', async () => {
    store.inventoryItems = [
      { id: 'ii-1', userId: 'u-1', equippedSlot: 'BODY', itemDef: { id: 'a', stats: { '+DMG': 50, '+CRIT': 0.10, '+DISC': 0.20 }, setId: null } },
    ];
    const r = await getEquippedBonus('u-1');
    expect(r.equip).toEqual({ flatDmg: 50, crit: 0.10, disc: 0.20, setDmgPct: 0 });
  });

  it('whitelist guard: typo / unknown stat keys never leak into EquipBonus', async () => {
    // A future seed with a typo like +DMGG or a stat we haven't
    // wired yet must not get silently treated as +DMG by the
    // raid-damage math. The equip layer only reads +DMG/+CRIT/+DISC.
    store.inventoryItems = [
      { id: 'ii-1', userId: 'u-1', equippedSlot: 'RING', itemDef: { id: 'mythic_typo', stats: { '+DMGG': 50, '+CRITT': 0.99, '+XP': 1.0 } as any, setId: null } },
    ];
    const r = await getEquippedBonus('u-1');
    // Equip is built only from whitelisted keys → all zero.
    expect(r.equip).toEqual({ flatDmg: 0, crit: 0, disc: 0, setDmgPct: 0 });
    // The frontend display still sees the typo'd keys (the inventory
    // page needs to show every stat the user has, including dormant).
    expect(r.statTotals).toEqual({ '+DMGG': 50, '+CRITT': 0.99, '+XP': 1.0 });
  });

  it('does not crash when an item has a malformed (non-object) stats field', async () => {
    // Prisma JSON column could theoretically be an array, string,
    // or number (e.g. a hand-seeded row). The verbatim summing
    // loop uses `?? {}` so null is safe; Object.entries on
    // strings/arrays/numbers is also safe (returns either [] or
    // indexed entries), so no defensive guard is needed beyond
    // the verbatim loop. We verify the helper doesn't throw.
    store.inventoryItems = [
      { id: 'ii-1', userId: 'u-1', equippedSlot: 'BODY', itemDef: { id: 'broken', stats: null as any, setId: null } },
      { id: 'ii-2', userId: 'u-1', equippedSlot: 'MAIN', itemDef: { id: 'array', stats: [1, 2, 3] as any, setId: null } },
      { id: 'ii-3', userId: 'u-1', equippedSlot: 'NECK', itemDef: { id: 'str', stats: 'garbage' as any, setId: null } },
    ];
    const expectNoThrow = async () => {
      const r = await getEquippedBonus('u-1');
      // And the result is a well-formed shape (no NaN, no undefined
      // breaking the equip fields).
      expect(r.equip.flatDmg).toBe(0);
      expect(r.equip.crit).toBe(0);
      expect(r.equip.disc).toBe(0);
      expect(r.equip.setDmgPct).toBe(0);
    };
    await expectNoThrow();
  });

  it('setDmgPct = 0 when no set has 3+ pieces equipped', async () => {
    store.inventoryItems = [
      { id: 'ii-1', userId: 'u-1', equippedSlot: 'BODY', itemDef: { id: 'a', stats: {}, setId: 'tron_set' } },
      { id: 'ii-2', userId: 'u-1', equippedSlot: 'MAIN', itemDef: { id: 'b', stats: {}, setId: 'tron_set' } },
    ];
    const r = await getEquippedBonus('u-1');
    expect(r.equip.setDmgPct).toBe(0);
  });

  it('setDmgPct = 0.03 for 3pc of one set (tier 1 only)', async () => {
    store.inventoryItems = [
      { id: 'ii-1', userId: 'u-1', equippedSlot: 'BODY', itemDef: { id: 'a', stats: {}, setId: 'tron_set' } },
      { id: 'ii-2', userId: 'u-1', equippedSlot: 'MAIN', itemDef: { id: 'b', stats: {}, setId: 'tron_set' } },
      { id: 'ii-3', userId: 'u-1', equippedSlot: 'NECK', itemDef: { id: 'c', stats: {}, setId: 'tron_set' } },
    ];
    const r = await getEquippedBonus('u-1');
    expect(r.equip.setDmgPct).toBeCloseTo(0.03, 5);
  });

  it('setDmgPct = 0.08 for 6pc of one set (tier 2 REPLACES tier 1, does NOT stack 0.03+0.08)', async () => {
    store.inventoryItems = [
      { id: 'ii-1', userId: 'u-1', equippedSlot: 'BODY',  itemDef: { id: 'a', stats: {}, setId: 'tron_set' } },
      { id: 'ii-2', userId: 'u-1', equippedSlot: 'MAIN',  itemDef: { id: 'b', stats: {}, setId: 'tron_set' } },
      { id: 'ii-3', userId: 'u-1', equippedSlot: 'NECK',  itemDef: { id: 'c', stats: {}, setId: 'tron_set' } },
      { id: 'ii-4', userId: 'u-1', equippedSlot: 'HEAD',  itemDef: { id: 'd', stats: {}, setId: 'tron_set' } },
      { id: 'ii-5', userId: 'u-1', equippedSlot: 'HANDS', itemDef: { id: 'e', stats: {}, setId: 'tron_set' } },
      { id: 'ii-6', userId: 'u-1', equippedSlot: 'FEET',  itemDef: { id: 'f', stats: {}, setId: 'tron_set' } },
    ];
    const r = await getEquippedBonus('u-1');
    // 0.08 — not 0.11 (3+6 stack) and not 0.03 (lower tier only).
    expect(r.equip.setDmgPct).toBeCloseTo(0.08, 5);
  });

  it('setDmgPct sums across distinct sets (multi-set, additive)', async () => {
    // tron_set 3pc (0.03) + iron_pact 4pc (0.03, can't reach tier 2)
    // = 0.06 total. Still less than one full 6pc tron set (0.08),
    // so the incentive to specialize stays correct.
    store.inventoryItems = [
      { id: 'ii-1', userId: 'u-1', equippedSlot: 'BODY',  itemDef: { id: 'a', stats: {}, setId: 'tron_set' } },
      { id: 'ii-2', userId: 'u-1', equippedSlot: 'MAIN',  itemDef: { id: 'b', stats: {}, setId: 'tron_set' } },
      { id: 'ii-3', userId: 'u-1', equippedSlot: 'NECK',  itemDef: { id: 'c', stats: {}, setId: 'tron_set' } },
      { id: 'ii-4', userId: 'u-1', equippedSlot: 'HEAD2', itemDef: { id: 'd', stats: {}, setId: 'iron_pact' } },
      { id: 'ii-5', userId: 'u-1', equippedSlot: 'BODY2', itemDef: { id: 'e', stats: {}, setId: 'iron_pact' } },
      { id: 'ii-6', userId: 'u-1', equippedSlot: 'MAIN2', itemDef: { id: 'f', stats: {}, setId: 'iron_pact' } },
      { id: 'ii-7', userId: 'u-1', equippedSlot: 'OFF2',  itemDef: { id: 'g', stats: {}, setId: 'iron_pact' } },
    ];
    const r = await getEquippedBonus('u-1');
    expect(r.equip.setDmgPct).toBeCloseTo(0.06, 5);
  });

  it('mythic ring stress test (ring_mythic_blood: +DMG 100, +CRIT 0.30) → raw equip values, no clamping', async () => {
    // The spec calls out the mythic ring as the stress-test item.
    // Clamping happens inside computeRaidDamage where the per-
    // workout base is known — the helper just returns the raw
    // summed values for the equip layer.
    store.inventoryItems = [
      {
        id: 'ii-1',
        userId: 'u-1',
        equippedSlot: 'RING',
        itemDef: {
          id: 'ring_mythic_blood',
          stats: { '+DMG': 100, '+CRIT': 0.30, '+HP': 100, '+BURST': 0.30, '+DEF': 50 },
          setId: null,
        },
      },
    ];
    const r = await getEquippedBonus('u-1');
    expect(r.equip.flatDmg).toBe(100);
    expect(r.equip.crit).toBe(0.30);
    // +HP / +BURST / +DEF are not v1-active, so disc stays 0.
    expect(r.equip.disc).toBe(0);
    expect(r.equip.setDmgPct).toBe(0);
    // Frontend display still sees the full dormant group.
    expect(r.statTotals).toEqual({
      '+DMG': 100,
      '+CRIT': 0.30,
      '+HP': 100,
      '+BURST': 0.30,
      '+DEF': 50,
    });
  });

  it('only the calling user\'s equipped items contribute (user-scope filter honored)', async () => {
    store.inventoryItems = [
      { id: 'ii-1', userId: 'u-1', equippedSlot: 'BODY', itemDef: { id: 'a', stats: { '+DMG': 10 }, setId: null } },
      { id: 'ii-2', userId: 'u-other', equippedSlot: 'BODY', itemDef: { id: 'b', stats: { '+DMG': 999 }, setId: null } },
    ];
    const r = await getEquippedBonus('u-1');
    expect(r.statTotals).toEqual({ '+DMG': 10 });
    expect(r.equip.flatDmg).toBe(10);
  });
});
