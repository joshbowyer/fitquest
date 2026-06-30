/**
 * Tests for the admin items-reset endpoint. Verifies:
 *  - per-user scope deletes only that user's items
 *  - 'all' scope deletes every user's items
 *  - 403 when the caller is not admin
 *  - 400 when scope=user without a userId
 *  - equip state (equippedSlot column) goes too — since the
 *    reset is deleteMany on InventoryItem, all dependent state
 *    on the same row is removed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => {
  const store: any = { inventoryItems: [] };
  return {
    prisma: {
      inventoryItem: {
        deleteMany: vi.fn(async ({ where }: any) => {
          const before = store.inventoryItems.length;
          store.inventoryItems = store.inventoryItems.filter(
            (ii: any) => {
              if (!where) return false;
              if (where.userId && ii.userId !== where.userId) return true;
              return false;
            },
          );
          return { count: before - store.inventoryItems.length };
        }),
      },
    },
    __store: store,
  };
});
vi.mock('../lib/auth', () => ({
  requireAdmin: vi.fn(async (req: any) => {
    // Honor the X-Test-User header as admin toggle. The route uses
    // requireAdmin, not requireUser, so we don't even look up the
    // user — we just check the header.
    if (req.headers['x-test-admin'] === 'true') return {} as any;
    const err = new Error('Forbidden');
    (err as any).statusCode = 403;
    throw err;
  }),
}));
vi.mock('./usccb.js', () => ({}));
vi.mock('./morningReport.js', () => ({}));
vi.mock('./penance.js', () => ({}));
vi.mock('./auth.js', () => ({
  requireAdmin: vi.fn(async (req: any) => {
    if (req.headers['x-test-admin'] === 'true') return {} as any;
    const err = new Error('Forbidden');
    (err as any).statusCode = 403;
    throw err;
  }),
  requireUser: vi.fn(async () => ({ id: 'u-self' })),
}));

import Fastify from 'fastify';
import { adminRoutes } from '../routes/admin';

const store: any = (await import('../lib/prisma')).__store;

beforeEach(() => {
  store.inventoryItems = [
    { id: 'ii-1', userId: 'u-lobster', itemDefId: 'tron_phantom_head', equippedSlot: 'HEAD' },
    { id: 'ii-2', userId: 'u-lobster', itemDefId: 'tron_phantom_body', equippedSlot: 'BODY' },
    { id: 'ii-3', userId: 'u-lobster', itemDefId: 'tron_phantom_hands', equippedSlot: 'HANDS' },
    { id: 'ii-4', userId: 'u-admin', itemDefId: 'tron_admin_head', equippedSlot: 'HEAD' },
    { id: 'ii-5', userId: 'u-admin', itemDefId: 'tron_admin_body', equippedSlot: 'BODY' },
  ];
});

describe('admin items-reset endpoint', () => {
  it('rejects non-admin callers with 403', async () => {
    const app = Fastify();
    await app.register(adminRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/items/reset',
      headers: { 'x-test-admin': 'false' },
      payload: { scope: 'all' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when scope=user without userId', async () => {
    const app = Fastify();
    await app.register(adminRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/items/reset',
      headers: { 'x-test-admin': 'true' },
      payload: { scope: 'user' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('wipes only the targeted user when scope=user', async () => {
    const app = Fastify();
    await app.register(adminRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/items/reset',
      headers: { 'x-test-admin': 'true' },
      payload: { scope: 'user', userId: 'u-lobster' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deleted).toBe(3);
    expect(body.scope).toBe('user');
    // Admin's items still here
    expect(store.inventoryItems.find((ii: any) => ii.userId === 'u-admin')).toBeTruthy();
    // Lobster's gone
    expect(store.inventoryItems.find((ii: any) => ii.userId === 'u-lobster')).toBeUndefined();
  });

  it('wipes every user when scope=all', async () => {
    const app = Fastify();
    await app.register(adminRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/items/reset',
      headers: { 'x-test-admin': 'true' },
      payload: { scope: 'all' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deleted).toBe(5);
    expect(body.scope).toBe('all');
    expect(store.inventoryItems.length).toBe(0);
  });

  it('equip state is gone with the row (no separate cleanup needed)', async () => {
    // Reset wipes the InventoryItem row; equippedSlot lives on
    // the same row so the new "is anything equipped" answer is
    // naturally null for those users. Verifies the integration
    // assumption rather than testing the column directly.
    const app = Fastify();
    await app.register(adminRoutes);
    const before = store.inventoryItems.find((ii: any) => ii.equippedSlot === 'HEAD');
    expect(before).toBeTruthy();
    await app.inject({
      method: 'POST',
      url: '/items/reset',
      headers: { 'x-test-admin': 'true' },
      payload: { scope: 'user', userId: before.userId },
    });
    const after = store.inventoryItems.find(
      (ii: any) => ii.userId === before.userId && ii.equippedSlot === 'HEAD',
    );
    expect(after).toBeUndefined();
  });
});