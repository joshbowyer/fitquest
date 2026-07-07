/**
 * Tests for /vitals — the Gadgetbridge auto-sync target.
 *
 * /vitals accepts batched health samples (steps, body battery,
 * HR, stress, etc.) and upserts them into the Measurement
 * table keyed on (userId, metric, recordedAt). The unique
 * index was added in v1.0.34. /vitals also returns existing
 * samples for cursor reconciliation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory Measurement store matching the (userId, metric,
// recordedAt) unique constraint.
const h = vi.hoisted(() => {
  type Measurement = {
    id: string;
    userId: string;
    metric: string;
    value: number;
    unit: string;
    notes: string | null;
    recordedAt: Date;
  };
  const measurements = new Map<string, Measurement>(); // key = userId|metric|iso
  let nextId = 1;
  const key = (userId: string, metric: string, recordedAt: Date) =>
    `${userId}|${metric}|${recordedAt.toISOString()}`;
  return { measurements, nextId, key };
});

vi.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: any) => {
      // The route's POST /vitals uses an async-fn form of
      // $transaction for the upsert loop. Provide a minimal tx
      // context that delegates to the measurement methods.
      const tx = {
        measurement: {
          findUnique: vi.fn(async ({ where, select }: any) => {
            const k = h.key(where.userId_metric_recordedAt.userId,
                            where.userId_metric_recordedAt.metric,
                            new Date(where.userId_metric_recordedAt.recordedAt));
            const m = h.measurements.get(k);
            if (!m) return null;
            if (select) {
              const out: any = {};
              for (const sk of Object.keys(select)) out[sk] = (m as any)[sk];
              return out;
            }
            return m;
          }),
          upsert: vi.fn(async ({ where, create, update }: any) => {
            const k = h.key(where.userId_metric_recordedAt.userId,
                            where.userId_metric_recordedAt.metric,
                            new Date(where.userId_metric_recordedAt.recordedAt));
            const existing = h.measurements.get(k);
            if (existing) {
              Object.assign(existing, update);
              return existing;
            }
            const m = {
              id: `m-${h.nextId++}`,
              ...create,
              notes: create.notes ?? null,
            };
            h.measurements.set(k, m);
            return m;
          }),
        },
      };
      return fn(tx);
    }),
    measurement: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        const k = h.key(where.userId_metric_recordedAt.userId,
                        where.userId_metric_recordedAt.metric,
                        new Date(where.userId_metric_recordedAt.recordedAt));
        const m = h.measurements.get(k);
        if (!m) return null;
        if (select) {
          const out: any = {};
          for (const k of Object.keys(select)) out[k] = (m as any)[k];
          return out;
        }
        return m;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const k = h.key(where.userId_metric_recordedAt.userId,
                        where.userId_metric_recordedAt.metric,
                        new Date(where.userId_metric_recordedAt.recordedAt));
        const existing = h.measurements.get(k);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const m = {
          id: `m-${h.nextId++}`,
          ...create,
          notes: create.notes ?? null,
        };
        h.measurements.set(k, m);
        return m;
      }),
      findMany: vi.fn(async ({ where, orderBy, take, select }: any) => {
        const wantedUser = where?.userId;
        const wantedMetric = where?.metric;
        const since = where?.recordedAt?.gte;
        const all: any[] = [];
        for (const m of h.measurements.values()) {
          if (wantedUser && m.userId !== wantedUser) continue;
          if (wantedMetric && m.metric !== wantedMetric) continue;
          if (since && m.recordedAt.getTime() < since.getTime()) continue;
          all.push(m);
        }
        all.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
        const out = all.slice(0, take ?? all.length);
        if (select) {
          return out.map((m) => {
            const r: any = {};
            for (const k of Object.keys(select)) r[k] = m[k];
            return r;
          });
        }
        return out;
      }),
      findMany: vi.fn(async ({ where, orderBy, take, select }: any) => {
        const wantedUser = where?.userId;
        const wantedMetric = where?.metric;
        const since = where?.recordedAt?.gte;
        const all: any[] = [];
        for (const m of h.measurements.values()) {
          if (wantedUser && m.userId !== wantedUser) continue;
          if (wantedMetric && m.metric !== wantedMetric) continue;
          if (since && m.recordedAt.getTime() < since.getTime()) continue;
          all.push(m);
        }
        all.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
        const out = all.slice(0, take ?? all.length);
        if (select) {
          return out.map((m) => {
            const r: any = {};
            for (const k of Object.keys(select)) r[k] = m[k];
            return r;
          });
        }
        return out;
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

import Fastify from 'fastify';
import { vitalsRoutes } from '../routes/vitals';

function buildApp() {
  const app = Fastify();
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
  app.register(vitalsRoutes, { prefix: '/vitals' });
  return app;
}

async function call(app: any, req: any) {
  return app.inject({
    ...req,
    headers: { ...(req.headers ?? {}), 'x-test-user': req.userId ?? 'u1' },
  });
}

beforeEach(() => {
  h.measurements.clear();
  h.nextId = 1;
});

describe('vitals route', () => {
  it('upserts a batch of body battery samples', async () => {
    const app = buildApp();
    const res = await call(app, {
      method: 'POST', url: '/vitals', userId: 'u1',
      payload: {
        kind: 'BODY_BATTERY',
        unit: '/100',
        source: 'gadgetbridge',
        samples: [
          { ts: '2026-04-06T15:00:00.000Z', value: 87 },
          { ts: '2026-04-06T16:00:00.000Z', value: 72 },
          { ts: '2026-04-06T17:00:00.000Z', value: 55 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe('BODY_BATTERY');
    expect(body.received).toBe(3);
    expect(body.created).toBe(3);
    expect(body.updated).toBe(0);
  });

  it('returns 400 for unknown metric kind', async () => {
    const app = buildApp();
    const res = await call(app, {
      method: 'POST', url: '/vitals', userId: 'u1',
      payload: { kind: 'NONSENSE_METRIC', samples: [{ ts: '2026-04-06T15:00:00.000Z', value: 1 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('unknown_metric');
  });

  it('updates an existing sample at the same (user, kind, ts) — same value = no write, different = update', async () => {
    const app = buildApp();
    // Initial
    await call(app, {
      method: 'POST', url: '/vitals', userId: 'u1',
      payload: { kind: 'STEPS', samples: [{ ts: '2026-04-06T15:00:00.000Z', value: 1000 }] },
    });
    // Same value: skip (no write, updated=0)
    const r1 = await call(app, {
      method: 'POST', url: '/vitals', userId: 'u1',
      payload: { kind: 'STEPS', samples: [{ ts: '2026-04-06T15:00:00.000Z', value: 1000 }] },
    });
    expect(r1.json().updated).toBe(0);
    expect(r1.json().created).toBe(0);
    // Different value: update (updated=1)
    const r2 = await call(app, {
      method: 'POST', url: '/vitals', userId: 'u1',
      payload: { kind: 'STEPS', samples: [{ ts: '2026-04-06T15:00:00.000Z', value: 1200 }] },
    });
    expect(r2.json().updated).toBe(1);
    expect(r2.json().created).toBe(0);
  });

  it('GET /vitals returns existing samples (cursor reconciliation)', async () => {
    const app = buildApp();
    await call(app, {
      method: 'POST', url: '/vitals', userId: 'u1',
      payload: { kind: 'HEART_RATE', samples: [
        { ts: '2026-04-06T15:00:00.000Z', value: 72 },
        { ts: '2026-04-06T16:00:00.000Z', value: 78 },
      ] },
    });
    // Pass `since` explicitly — the default is "last 7 days" which
    // would exclude 2026-04-06 samples run on any test date after
    // 2026-04-13.
    const res = await call(app, {
      method: 'GET',
      url: '/vitals?since=2026-01-01T00:00:00.000Z',
      userId: 'u1',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.samples).toHaveLength(2);
    expect(body.samples[0].kind).toBe('HEART_RATE');
  });

  it('GET /vitals?since=... filters by timestamp', async () => {
    const app = buildApp();
    await call(app, {
      method: 'POST', url: '/vitals', userId: 'u1',
      payload: { kind: 'STEPS', samples: [
        { ts: '2026-04-05T15:00:00.000Z', value: 100 },
        { ts: '2026-04-06T15:00:00.000Z', value: 200 },
      ] },
    });
    const res = await call(app, {
      method: 'GET', url: '/vitals?since=2026-04-06T00:00:00.000Z',
      userId: 'u1',
    });
    const body = res.json();
    expect(body.samples).toHaveLength(1);
    expect(body.samples[0].value).toBe(200);
  });

  it('rejects empty samples array', async () => {
    const app = buildApp();
    const res = await call(app, {
      method: 'POST', url: '/vitals', userId: 'u1',
      payload: { kind: 'STEPS', samples: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});