/**
 * Tests for the stacking behaviour of maybeSpawnLeak +
 * getLeakForUser. The user can have multiple ACTIVE leaks at once
 * — only the 24h "post-resolved cooldown" prevents new spawns.
 *
 * We mock the heavy DB + LLM dependencies so the leak logic is
 * testable offline. Each test sets up exactly the mocks it needs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/penance.js', () => ({
  tierForShield: vi.fn(),
}));
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    portalLeak: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    portalLeakDamageEvent: {
      findMany: vi.fn(),
    },
    portalLeakProgress: { findFirst: vi.fn(), update: vi.fn() },
    itemDef: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock('../lib/loot.js', () => ({}));

import { maybeSpawnLeak, getLeakForUser, tickLeakGrowth, MAX_ACTIVE_LEAKS } from '../lib/portalLeaks.js';
import { prisma } from '../lib/prisma.js';
import { tierForShield } from '../lib/penance.js';

const mockTier = tierForShield as unknown as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as unknown as {
  portalLeak: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  portalLeakDamageEvent: { findMany: ReturnType<typeof vi.fn> };
  portalLeakProgress: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  itemDef: { findFirst: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('maybeSpawnLeak — stacking', () => {
  it('spawns even when active leaks already exist (under cap)', async () => {
    mockTier.mockReturnValue('BREACHED');
    vi.spyOn(Math, 'random').mockReturnValue(0.01); // under probability
    // The cooldown check (post-resolved leak, not found).
    mockPrisma.portalLeak.findFirst.mockResolvedValueOnce(null);
    // The active-count cap check — 1 active leak, room for more.
    mockPrisma.portalLeak.count.mockResolvedValueOnce(1);
    mockPrisma.user.findUnique.mockResolvedValue({ level: 5 });
    mockPrisma.itemDef.findFirst.mockResolvedValue(null);
    mockPrisma.portalLeak.create.mockResolvedValue({
      id: 'new-leak-1',
      spawnedAt: new Date(),
    });

    const result = await maybeSpawnLeak('user-1', 30);
    expect(result.spawned).toBe(true);
    expect(result.leakId).toBe('new-leak-1');
    expect(mockPrisma.portalLeak.create).toHaveBeenCalledTimes(1);
  });

  it('skips spawn when active leak count is at MAX_ACTIVE_LEAKS', async () => {
    mockTier.mockReturnValue('BREACHED');
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    mockPrisma.portalLeak.findFirst.mockResolvedValueOnce(null);
    // Cap hit — user has 3 active leaks already.
    mockPrisma.portalLeak.count.mockResolvedValueOnce(MAX_ACTIVE_LEAKS);

    const result = await maybeSpawnLeak('user-1', 30);
    expect(result.spawned).toBe(false);
    expect(mockPrisma.portalLeak.create).not.toHaveBeenCalled();
  });

  it('skips spawn when within the 24h post-resolved cooldown', async () => {
    mockTier.mockReturnValue('BREACHED');
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    mockPrisma.portalLeak.findFirst.mockResolvedValueOnce({
      resolvedAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6h ago
    });

    const result = await maybeSpawnLeak('user-1', 30);
    expect(result.spawned).toBe(false);
    expect(mockPrisma.portalLeak.create).not.toHaveBeenCalled();
  });

  it('skips spawn when shield tier is FORTIFIED (probability 0)', async () => {
    mockTier.mockReturnValue('FORTIFIED');
    const result = await maybeSpawnLeak('user-1', 90);
    expect(result.spawned).toBe(false);
    expect(mockPrisma.portalLeak.create).not.toHaveBeenCalled();
  });
});

describe('tickLeakGrowth — no longer expires leaks', () => {
  it('grows every active leak by LEAK_DAILY_GROWTH but never sets status to EXPIRED', async () => {
    // Even leaks with very old spawnedAt timestamps should stay ACTIVE
    // — they only get their HP bumped up to the overwhelm cap.
    const ancient = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days old
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);   // 1 day old
    mockPrisma.portalLeak.findMany.mockResolvedValueOnce([
      { id: 'leak-old',  hp: 50,  maxHp: 100, spawnedAt: ancient },
      { id: 'leak-new',  hp: 90,  maxHp: 100, spawnedAt: recent  },
    ]);

    const result = await tickLeakGrowth();
    expect(result.ticked).toBe(2);
    // Both rows updated with new hp, neither with status EXPIRED.
    expect(mockPrisma.portalLeak.update).toHaveBeenCalledTimes(2);
    const updateCalls = mockPrisma.portalLeak.update.mock.calls;
    for (const call of updateCalls) {
      // Prisma.update takes a single args object: { where, data }
      const data = call[0]?.data;
      expect(data?.status).toBeUndefined();
      expect(data?.resolvedAt).toBeUndefined();
      expect(typeof data?.hp).toBe('number');
    }
    // HP for the ancient leak = 50 + 8 = 58 (under 150% cap of 150).
    // HP for the recent leak = 90 + 8 = 98 (under cap).
    expect(updateCalls[0][0].data.hp).toBe(58);
    expect(updateCalls[1][0].data.hp).toBe(98);
  });

  it('returns ticked=0 when no active leaks', async () => {
    mockPrisma.portalLeak.findMany.mockResolvedValueOnce([]);
    const result = await tickLeakGrowth();
    expect(result.ticked).toBe(0);
    expect(mockPrisma.portalLeak.update).not.toHaveBeenCalled();
  });
});

describe('getLeakForUser — stacking', () => {
  it('returns all active leaks', async () => {
    const leaks = [
      { id: 'leak-3', spawnedAt: new Date('2026-06-21T10:00:00Z'), status: 'ACTIVE' },
      { id: 'leak-1', spawnedAt: new Date('2026-06-19T10:00:00Z'), status: 'ACTIVE' },
      { id: 'leak-2', spawnedAt: new Date('2026-06-20T10:00:00Z'), status: 'ACTIVE' },
    ];
    // The API does 2 findMany calls on portalLeakDamageEvent:
    // per-leak + global. Both should return empty for this test.
    mockPrisma.portalLeak.findMany.mockResolvedValueOnce(leaks);
    mockPrisma.portalLeakDamageEvent.findMany.mockResolvedValue([]);

    const result = await getLeakForUser('user-1');
    expect(result.leaks).toHaveLength(3);
    const ids = result.leaks.map((e) => e.leak.id);
    expect(ids).toContain('leak-1');
    expect(ids).toContain('leak-2');
    expect(ids).toContain('leak-3');
  });

  it('returns empty when no active leaks', async () => {
    // findMany returns []; the function short-circuits before
    // the second call so we don't need to mock it.
    mockPrisma.portalLeak.findMany.mockResolvedValueOnce([]);

    const result = await getLeakForUser('user-1');
    expect(result.leaks).toHaveLength(0);
    expect(result.recentDamage).toHaveLength(0);
  });
});
