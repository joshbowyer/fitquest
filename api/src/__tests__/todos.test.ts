/**
 * Tests for /todos — the one-shot TODO list.
 *
 * The XP-award path on transition OPEN→DONE is the only piece
 * of real business logic (everything else is straight CRUD).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory Todo store + XP counter. The shape matches the
// Prisma TodoItem model + the awardXpGold result we use.
const h = vi.hoisted(() => {
  type Todo = {
    id: string;
    userId: string;
    title: string;
    description: string | null;
    dueDate: Date | null;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    status: 'OPEN' | 'DONE';
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  const todosByUser = new Map<string, Todo[]>();
  const xpByUser = new Map<string, number>();
  let nextId = 1;
  return { todosByUser, xpByUser, nextId };
});

vi.mock('../lib/prisma', () => ({
  TodoPriority: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
  TodoStatus: { OPEN: 'OPEN', DONE: 'DONE' },
  prisma: {
    todoItem: {
      findMany: vi.fn(async ({ where, orderBy, take }: any) => {
        const list = h.todosByUser.get(where.userId) ?? [];
        let out = list.slice();
        if (where.status) out = out.filter((t: any) => t.status === where.status);
        if (orderBy?.createdAt === 'desc') {
          out.sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return out.slice(0, take ?? out.length);
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        // Route calls with either { userId } or { id }; some calls
        // omit userId, so scan all users' lists.
        if (where.userId) {
          return (h.todosByUser.get(where.userId) ?? []).find((t: any) => t.id === where.id) ?? null;
        }
        for (const list of h.todosByUser.values()) {
          const t = list.find((x: any) => x.id === where.id);
          if (t) return t;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const list = h.todosByUser.get(data.userId) ?? [];
        const t = {
          id: `todo-${h.nextId++}`,
          userId: data.userId,
          title: data.title,
          description: data.description ?? null,
          dueDate: data.dueDate ?? null,
          priority: data.priority ?? 'MEDIUM',
          status: data.status ?? 'OPEN',
          completedAt: data.completedAt ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        list.push(t);
        h.todosByUser.set(data.userId, list);
        return t;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        // Same: support both { userId, id } and { id } shapes.
        let list = where.userId ? h.todosByUser.get(where.userId) : null;
        if (!list) {
          for (const l of h.todosByUser.values()) {
            if (l.find((x: any) => x.id === where.id)) { list = l; break; }
          }
        }
        if (!list) throw new Error('not found');
        const t = list.find((x: any) => x.id === where.id);
        if (!t) throw new Error('not found');
        Object.assign(t, data, { updatedAt: new Date() });
        return t;
      }),
      delete: vi.fn(async ({ where }: any) => {
        let list = where.userId ? h.todosByUser.get(where.userId) : null;
        if (!list) {
          for (const l of h.todosByUser.values()) {
            if (l.find((x: any) => x.id === where.id)) { list = l; break; }
          }
        }
        if (!list) return { id: where.id };
        const idx = list.findIndex((x: any) => x.id === where.id);
        if (idx >= 0) list.splice(idx, 1);
        return { id: where.id };
      }),
    },
  },
}));

vi.mock('../lib/auth', () => ({
  requireUser: vi.fn(async (req: any) => {
    const uid = req?.headers?.['x-test-user'] ?? 'u1';
    return { id: uid, email: `${uid}@test.local`, username: uid };
  }),
}));

vi.mock('../lib/award', () => ({
  awardXpGold: vi.fn(async (userId: string, base: { xp?: number }) => {
    const cur = h.xpByUser.get(userId) ?? 0;
    const add = base.xp ?? 0;
    h.xpByUser.set(userId, cur + add);
    return {
      xp: add, gold: 0, level: 1, previousLevel: 1, leveledUp: false,
      totalXp: cur + add, totalGold: 0, mult: 1,
    };
  }),
}));

import Fastify from 'fastify';
import { todoRoutes } from '../routes/todos';

function buildApp() {
  const app = Fastify();
  // Same ZodError handler as the real index.ts so the test
  // mirrors production behavior (raw ZodError → 400, not 500).
  app.setErrorHandler((err: any, _req, reply) => {
    if (err?.name === 'ZodError' || Array.isArray(err?.issues)) {
      const issues = err?.issues ?? [];
      return reply.code(400).send({
        error: 'Invalid request',
        details: issues.map((i: any) => `${i.path?.join('.') ?? '<root>'}: ${i.message}`).join('; '),
      });
    }
    return reply.code(500).send({ error: 'test' });
  });
  app.register(todoRoutes, { prefix: '/todos' });
  return app;
}

async function call(app: any, req: any) {
  return app.inject({
    ...req,
    headers: { ...(req.headers ?? {}), 'x-test-user': req.userId ?? 'u1' },
  });
}

beforeEach(() => {
  h.todosByUser.clear();
  h.xpByUser.clear();
  h.nextId = 1;
});

describe('todos route', () => {
  it('creates a todo with the default MEDIUM priority', async () => {
    const app = buildApp();
    const res = await call(app, {
      method: 'POST', url: '/todos', userId: 'u1',
      payload: { title: 'Buy milk' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe('Buy milk');
    expect(body.priority).toBe('MEDIUM');
    expect(body.status).toBe('OPEN');
  });

  it('rejects empty title', async () => {
    const app = buildApp();
    const res = await call(app, {
      method: 'POST', url: '/todos', userId: 'u1',
      payload: { title: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('awards XP on OPEN → DONE transition (scaled by priority)', async () => {
    const app = buildApp();
    const low  = (await call(app, { method: 'POST', url: '/todos', userId: 'u1', payload: { title: 'L', priority: 'LOW' } })).json();
    const med  = (await call(app, { method: 'POST', url: '/todos', userId: 'u1', payload: { title: 'M', priority: 'MEDIUM' } })).json();
    const high = (await call(app, { method: 'POST', url: '/todos', userId: 'u1', payload: { title: 'H', priority: 'HIGH' } })).json();

    const r1 = await call(app, { method: 'PATCH', url: `/todos/${low.id}`,  userId: 'u1', payload: { status: 'DONE' } });
    const r2 = await call(app, { method: 'PATCH', url: `/todos/${med.id}`,  userId: 'u1', payload: { status: 'DONE' } });
    const r3 = await call(app, { method: 'PATCH', url: `/todos/${high.id}`, userId: 'u1', payload: { status: 'DONE' } });

    expect(r1.json().award.xp).toBe(10);
    expect(r2.json().award.xp).toBe(20);
    expect(r3.json().award.xp).toBe(30);
  });

  it('does NOT re-award XP if the todo was already DONE', async () => {
    const app = buildApp();
    const todo = (await call(app, { method: 'POST', url: '/todos', userId: 'u1', payload: { title: 'X' } })).json();
    await call(app, { method: 'PATCH', url: `/todos/${todo.id}`, userId: 'u1', payload: { status: 'DONE' } });
    const r2 = await call(app, { method: 'PATCH', url: `/todos/${todo.id}`, userId: 'u1', payload: { status: 'DONE' } });
    expect(r2.json().award).toBeNull();
  });

  it('marks completedAt when transitioning to DONE', async () => {
    const app = buildApp();
    const todo = (await call(app, { method: 'POST', url: '/todos', userId: 'u1', payload: { title: 'X' } })).json();
    const r = await call(app, { method: 'PATCH', url: `/todos/${todo.id}`, userId: 'u1', payload: { status: 'DONE' } });
    expect(r.json().todo.completedAt).toBeTruthy();
  });

  it('forbids updating another user\'s todo (403)', async () => {
    const app = buildApp();
    const todo = (await call(app, { method: 'POST', url: '/todos', userId: 'u1', payload: { title: 'X' } })).json();
    const r = await call(app, { method: 'PATCH', url: `/todos/${todo.id}`, userId: 'u2', payload: { title: 'hijack' } });
    expect(r.statusCode).toBe(403);
  });

  it('list returns OPEN first, then DONE, sorted by due date asc', async () => {
    const app = buildApp();
    const a = (await call(app, { method: 'POST', url: '/todos', userId: 'u1', payload: { title: 'A' } })).json();
    const b = (await call(app, { method: 'POST', url: '/todos', userId: 'u1', payload: { title: 'B', dueDate: '2099-12-31T00:00:00.000Z' } })).json();
    const c = (await call(app, { method: 'POST', url: '/todos', userId: 'u1', payload: { title: 'C', dueDate: '2099-01-01T00:00:00.000Z' } })).json();
    const d = (await call(app, { method: 'POST', url: '/todos', userId: 'u1', payload: { title: 'D' } })).json();
    await call(app, { method: 'PATCH', url: `/todos/${d.id}`, userId: 'u1', payload: { status: 'DONE' } });
    const list = (await call(app, { method: 'GET', url: '/todos', userId: 'u1' })).json();
    expect(list.map((t: any) => t.title)).toEqual(['C', 'B', 'A', 'D']);
  });

  it('filter ?status=open hides DONE', async () => {
    const app = buildApp();
    const a = (await call(app, { method: 'POST', url: '/todos', userId: 'u1', payload: { title: 'A' } })).json();
    const b = (await call(app, { method: 'POST', url: '/todos', userId: 'u1', payload: { title: 'B' } })).json();
    await call(app, { method: 'PATCH', url: `/todos/${a.id}`, userId: 'u1', payload: { status: 'DONE' } });
    const list = (await call(app, { method: 'GET', url: '/todos?status=OPEN', userId: 'u1' })).json();
    expect(list.map((t: any) => t.title)).toEqual(['B']);
  });
});