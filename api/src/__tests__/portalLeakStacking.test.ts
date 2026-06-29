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
      create: vi.fn(),
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

import { maybeSpawnLeak, getLeakForUser } from '../lib/portalLeaks.js';
import { prisma } from '../lib/prisma.js';
import { tierForShield } from '../lib/penance.js';

const mockTier = tierForShield as unknown as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as unknown as {
  portalLeak: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  portalLeakDamageEvent: { findMany: ReturnType<typeof vi.fn> };
  portalLeakProgress: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  itemDef: { findFirst: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('maybeSpawnLeak — stacking', () => {
  it('spawns even when active leaks already exist', async () => {
    mockTier.mockReturnValue('BREACHED');
    vi.spyOn(Math, 'random').mockReturnValue(0.01); // under probability
    // The cooldown check (post-resolved leak, not found).
    mockPrisma.portalLeak.findFirst.mockResolvedValueOnce(null);
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
