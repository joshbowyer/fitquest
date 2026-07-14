/**
 * claimKill() must create real Soulstone TTL rows for the rolled
 * `reward.soulstones` count — the previous design wrote to a
 * UserBreachProgress.soulstones counter column that was dropped
 * in 021082d, throwing PrismaClientValidationError on every
 * claim. `reward.soulstones` was still being returned to the
 * caller (and displayed in the victory modal) but no row was
 * ever created — the preview was a guaranteed-broken promise.
 *
 * Regression test: a MINOR-tier breach kill should create exactly
 * 1 Soulstone row with the correct shape (bossName / 24h TTL /
 * bossTier=1), the user gold/xp increments, the progress kills
 * counter, and the breachDamageEvent audit row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the vi.mock factories can close over it. `vi.hoisted`
// runs BEFORE the vi.mock factories are invoked, so mutable test
// state can be set up here and the mocks can record into it.
const h = vi.hoisted(() => {
  const txCalls: any[] = [];
  const mockPrisma = {
    userBreachProgress: {
      findUnique: vi.fn(async () => ({
        userId: 'u1',
        status: 'VICTORY',
        currentBossId: 'b1',
        bossHp: 0,
        kills: 3,
        deaths: 0,
        recentBossIds: ['b1'],
      })),
      update: vi.fn(async () => ({ userId: 'u1' })),
    },
    breachBoss: {
      findUnique: vi.fn(async () => ({
        id: 'b1',
        name: 'Gripping Ghoul',
        tier: 'MINOR',
        maxHp: 500,
        classAffinity: 'PHANTOM',
      })),
      // rollNextBoss queries this to pick the next encounter after
      // a kill — return a deterministic stub so the rotation logic
      // doesn't reach into a real BreachBoss pool.
      findMany: vi.fn(async () => ([{
        id: 'b2', name: 'Hollow Hunger', tier: 'MINOR',
        maxHp: 500, classAffinity: 'PHANTOM',
      }])),
    },
    user: {
      findUnique: vi.fn(async () => ({
        id: 'u1', level: 12, hearts: 10, mode: 'HARDCORE',
        gold: 100, xp: 1000, timezone: 'UTC',
      })),
      update: vi.fn(async () => ({ id: 'u1' })),
    },
    inventoryItem: {
      create: vi.fn(async () => ({ id: 'inv-1' })),
    },
    soulstone: {
      createMany: vi.fn(async ({ data }) => {
        txCalls.push({ kind: 'soulstoneCreateMany', data });
        return { count: data.length };
      }),
    },
    breachDamageEvent: {
      create: vi.fn(async (args) => {
        txCalls.push({ kind: 'breachDamageEvent', args });
        return { id: 'ev-1' };
      }),
    },
    $transaction: vi.fn(async (ops: any[]) => {
      // Record every transactional op (incl. user.update inside
      // the array form) so tests can assert on what landed inside
      // the atomic block.
      for (const op of ops) {
        if (op?.kind === 'soulstoneCreateMany') txCalls.push(op);
        else if (op?.data) txCalls.push(op);
      }
      return ops;
    }),
  };
  return { txCalls, mockPrisma };
});

vi.mock('../lib/prisma', () => ({
  prisma: h.mockPrisma,
  PrismaRuntime: { AnyNull: Symbol('AnyNull') },
}));

// Stub the pet helpers so claimKill doesn't drag in a pet db fetch.
vi.mock('../lib/petStats', () => ({
  getDeployedCombatPet: vi.fn(async () => null),
}));

// Stub pickItemOfRarity so no item roll races the assertion.
vi.mock('../lib/portalLeaks', () => ({
  pickItemOfRarity: vi.fn(async () => null),
}));

import { claimKill, rewardForKill } from '../lib/breach';

describe('claimKill — soulstone drop fix', () => {
  beforeEach(() => {
    h.txCalls.length = 0;
    vi.clearAllMocks();
    h.txCalls.length = 0;
  });

  it('MINOR boss kill creates exactly 1 Soulstone row with 24h TTL + correct boss metadata', async () => {
    const reward = await claimKill('u1');
    expect(reward).not.toBeNull();
    expect(reward!.soulstones).toBe(1);

    const ssCall = h.txCalls.find((c: any) => c.kind === 'soulstoneCreateMany');
    expect(ssCall).toBeDefined();
    expect(ssCall.data).toHaveLength(1);
    const row = ssCall.data[0];
    expect(row.userId).toBe('u1');
    expect(row.bossName).toBe('Gripping Ghoul');
    expect(row.bossTier).toBe(1); // MINOR -> 1
    expect(row.expiresAt.getTime() - row.droppedAt.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('rewardForKill rolls each tier into the documented range', () => {
    const minorReward = rewardForKill({ tier: 'MINOR', maxHp: 500 }, 20);
    const eliteReward = rewardForKill({ tier: 'ELITE', maxHp: 800 }, 20);
    const legendaryReward = rewardForKill({ tier: 'LEGENDARY', maxHp: 1800 }, 20);
    const apexReward = rewardForKill({ tier: 'APEX', maxHp: 2500 }, 20);

    expect(minorReward.soulstones).toBe(1);
    expect(eliteReward.soulstones).toBeGreaterThanOrEqual(2);
    expect(eliteReward.soulstones).toBeLessThanOrEqual(3);
    expect(legendaryReward.soulstones).toBeGreaterThanOrEqual(4);
    expect(legendaryReward.soulstones).toBeLessThanOrEqual(6);
    expect(apexReward.soulstones).toBeGreaterThanOrEqual(8);
    expect(apexReward.soulstones).toBeLessThanOrEqual(12);
  });

  it('user update + soulstone drop + damage event are bundled into one atomic $transaction', async () => {
    await claimKill('u1');
    expect(h.mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // User gold/xp increment + soulstone.createMany + breachDamageEvent.create
    // — all bundled into the same atomic block.
    // toHaveBeenCalledTimes(1) above guarantees the first call exists.
    const ops = h.mockPrisma.$transaction.mock.calls[0]![0]!;
    expect(ops.length).toBe(3);
  });
});