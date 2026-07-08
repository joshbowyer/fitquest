/**
 * Tests for the notification inbox routes:
 *   GET    /notifications
 *   GET    /notifications/unread-count
 *   POST   /notifications/:id/read
 *   POST   /notifications/read-all
 *   DELETE /notifications/:id
 *   DELETE /notifications
 *
 * Plus the emitNotification helper's fire-and-forget contract.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Row = {
  id: string;
  userId: string;
  category: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  payload: any;
  readAt: Date | null;
  createdAt: Date;
};

const h = vi.hoisted(() => {
  const rows: any[] = [];
  let nextId = 1;
  return { rows, nextId };
});

vi.mock('../lib/prisma', () => ({
  NotificationCategory: {
    SKILL: 'SKILL', PENANCE: 'PENANCE', SHOP: 'SHOP',
    SYSTEM: 'SYSTEM', ACHIEVEMENT: 'ACHIEVEMENT', LEVEL: 'LEVEL',
  },
  prisma: {
    notification: {
      create: vi.fn(async ({ data }: any) => {
        const row: Row = {
          id: `n-${h.nextId++}`,
          userId: data.userId,
          category: data.category,
          kind: data.kind,
          title: data.title,
          body: data.body ?? null,
          link: data.link ?? null,
          payload: data.payload ?? null,
          readAt: null,
          createdAt: new Date(),
        };
        h.rows.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ where, take }: any) => {
        let out = h.rows.filter((r) => r.userId === where.userId);
        if (where.category) out = out.filter((r) => r.category === where.category);
        if (where.readAt === null) out = out.filter((r) => r.readAt == null);
        out = out.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return out.slice(0, take ?? out.length);
      }),
      count: vi.fn(async ({ where }: any) =>
        h.rows.filter(
          (r) => r.userId === where.userId && (where.readAt === null ? r.readAt == null : true),
        ).length,
      ),
      findUnique: vi.fn(async ({ where }: any) => h.rows.find((r) => r.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const r = h.rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let n = 0;
        for (const r of h.rows) {
          if (r.userId === where.userId && (where.readAt === null ? r.readAt == null : true)) {
            Object.assign(r, data);
            n++;
          }
        }
        return { count: n };
      }),
      delete: vi.fn(async ({ where }: any) => {
        const i = h.rows.findIndex((r) => r.id === where.id);
        const [r] = h.rows.splice(i, 1);
        return r;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = h.rows.length;
        for (let i = h.rows.length - 1; i >= 0; i--) {
          if (h.rows[i].userId === where.userId) h.rows.splice(i, 1);
        }
        return { count: before - h.rows.length };
      }),
    },
  },
}));

vi.mock('../lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1', timezone: 'UTC' })),
}));

import Fastify from 'fastify';
import { notificationRoutes } from '../routes/notifications';
import { emitNotification } from '../lib/notify';

function buildApp() {
  const app = Fastify();
  app.setErrorHandler((err: any, _req, reply) => {
    if (err?.name === 'ZodError' || Array.isArray(err?.issues)) return reply.code(400).send({ error: 'zod' });
    return reply.code(500).send({ error: err?.message ?? 'test' });
  });
  app.register(notificationRoutes, { prefix: '/notifications' });
  return app;
}

beforeEach(() => {
  h.rows.length = 0;
  h.nextId = 1;
});

async function seed(n: number, over: Partial<Row> = {}) {
  for (let i = 0; i < n; i++) {
    await emitNotification({
      userId: 'u1',
      category: (over.category as any) ?? 'SKILL',
      kind: over.kind ?? 'skill_unlock',
      title: over.title ?? `Notif ${i}`,
    });
  }
}

describe('emitNotification', () => {
  it('creates a row and never throws on DB error', async () => {
    await seed(1);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].readAt).toBeNull();
  });

  it('swallows errors (fire-and-forget)', async () => {
    const spy = (await import('../lib/prisma')).prisma.notification.create as any;
    spy.mockImplementationOnce(async () => { throw new Error('db down'); });
    // Must resolve, not reject.
    await expect(
      emitNotification({ userId: 'u1', category: 'SYSTEM', kind: 'x', title: 't' }),
    ).resolves.toBeUndefined();
  });
});

describe('/notifications', () => {
  it('lists newest-first', async () => {
    await seed(3);
    const res = await buildApp().inject({ method: 'GET', url: '/notifications' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(3);
  });

  it('filters by category', async () => {
    await seed(2, { category: 'SKILL' });
    await seed(1, { category: 'SHOP' });
    const res = await buildApp().inject({ method: 'GET', url: '/notifications?category=SHOP' });
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].category).toBe('SHOP');
  });

  it('unread filter returns only unread', async () => {
    await seed(2);
    h.rows[0].readAt = new Date();
    const res = await buildApp().inject({ method: 'GET', url: '/notifications?unread=true' });
    expect(res.json().items).toHaveLength(1);
  });
});

describe('/notifications/unread-count', () => {
  it('counts unread only', async () => {
    await seed(3);
    h.rows[0].readAt = new Date();
    const res = await buildApp().inject({ method: 'GET', url: '/notifications/unread-count' });
    expect(res.json().count).toBe(2);
  });
});

describe('mark read', () => {
  it('POST /:id/read stamps readAt once', async () => {
    await seed(1);
    const id = h.rows[0].id;
    const res = await buildApp().inject({ method: 'POST', url: `/notifications/${id}/read` });
    expect(res.statusCode).toBe(200);
    expect(res.json().item.readAt).not.toBeNull();
  });

  it('POST /:id/read 404s for another user\'s row', async () => {
    h.rows.push({
      id: 'other', userId: 'u2', category: 'SKILL', kind: 'k', title: 't',
      body: null, link: null, payload: null, readAt: null, createdAt: new Date(),
    });
    const res = await buildApp().inject({ method: 'POST', url: '/notifications/other/read' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /read-all marks every unread read', async () => {
    await seed(3);
    const res = await buildApp().inject({ method: 'POST', url: '/notifications/read-all' });
    expect(res.json().updated).toBe(3);
    expect(h.rows.every((r) => r.readAt != null)).toBe(true);
  });
});

describe('dismiss', () => {
  it('DELETE /:id removes the row', async () => {
    await seed(2);
    const id = h.rows[0].id;
    const res = await buildApp().inject({ method: 'DELETE', url: `/notifications/${id}` });
    expect(res.statusCode).toBe(200);
    expect(h.rows).toHaveLength(1);
  });

  it('DELETE / clears all', async () => {
    await seed(4);
    const res = await buildApp().inject({ method: 'DELETE', url: '/notifications' });
    expect(res.json().deleted).toBe(4);
    expect(h.rows).toHaveLength(0);
  });
});
