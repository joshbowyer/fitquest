/**
 * Tests for the trend endpoints:
 *   GET /meals/trend?days=N
 *   GET /substances/trend?days=N
 *
 * Both are per-day rollups keyed on the user's local timezone.
 * The focus is the per-day bucketing + the merge with WATER_ML
 * measurements (meals) and the empty-day zero-filling (both).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// =====================================================================
// Mocks
// =====================================================================

const h = vi.hoisted(() => {
  type Food = { id: string; calories: number; proteinG: number; carbG: number; fatG: number };
  type MealEntry = {
    id: string;
    userId: string;
    foodId: string;
    meal: string;
    servings: number;
    note: string | null;
    loggedAt: Date;
    food: Food;
  };
  type WaterRow = { userId: string; metric: string; value: number; recordedAt: Date };
  type SubsLog = { userId: string; category: string; form: string; loggedAt: Date };

  const foods = new Map<string, Food>();
  const meals: MealEntry[] = [];
  const waters: WaterRow[] = [];
  const subs: SubsLog[] = [];
  let nextId = 1;
  return { foods, meals, waters, subs, nextId };
});

vi.mock('../lib/prisma', () => ({
  FoodSource: { MANUAL: 'MANUAL', OFF: 'OFF', USDA: 'USDA', AI_ESTIMATE: 'AI_ESTIMATE' },
  MealType: { BREAKFAST: 'BREAKFAST', LUNCH: 'LUNCH', DINNER: 'DINNER', SNACK: 'SNACK' },
  SubstanceCategory: { CAFFEINE: 'CAFFEINE', ALCOHOL: 'ALCOHOL', NICOTINE: 'NICOTINE', ELECTROLYTE: 'ELECTROLYTE' },
  prisma: {
    foodItem: { findUnique: vi.fn(async ({ where }: any) => h.foods.get(where.id) ?? null) },
    mealEntry: {
      findMany: vi.fn(async ({ where, include }: any) => {
        const since = where?.loggedAt?.gte?.getTime?.() ?? -Infinity;
        return h.meals
          .filter((m) => m.userId === where.userId && m.loggedAt.getTime() >= since)
          .map((m) => include?.food ? { ...m, food: h.foods.get(m.foodId)! } : m);
      }),
      create: vi.fn(async ({ data }: any) => {
        const f = h.foods.get(data.foodId);
        if (!f) throw new Error('Food not found');
        const m = {
          id: `meal-${h.nextId++}`,
          userId: data.userId,
          foodId: data.foodId,
          meal: data.meal,
          servings: data.servings,
          note: data.note ?? null,
          loggedAt: data.loggedAt,
          food: f,
        };
        h.meals.push(m);
        return m;
      }),
    },
    measurement: {
      findMany: vi.fn(async ({ where }: any) => {
        const since = where?.recordedAt?.gte?.getTime?.() ?? -Infinity;
        return h.waters
          .filter((w) => w.userId === where.userId && w.metric === where.metric && w.recordedAt.getTime() >= since)
          .map((w) => ({ value: w.value, recordedAt: w.recordedAt }));
      }),
    },
    substanceLog: {
      findMany: vi.fn(async ({ where }: any) => {
        const since = where?.loggedAt?.gte?.getTime?.() ?? -Infinity;
        return h.subs
          .filter((s) => s.userId === where.userId && s.loggedAt.getTime() >= since)
          .map((s) => ({ category: s.category, form: s.form, loggedAt: s.loggedAt }));
      }),
    },
  },
}));

vi.mock('../lib/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1', timezone: 'UTC' })),
}));

import Fastify from 'fastify';
import { mealRoutes } from '../routes/meals';
import { substanceRoutes } from '../routes/substances';

function buildMealsApp() {
  const app = Fastify();
  app.setErrorHandler((err: any, _req, reply) => {
    if (err?.name === 'ZodError' || Array.isArray(err?.issues)) return reply.code(400).send({ error: 'zod' });
    return reply.code(500).send({ error: err?.message ?? 'test' });
  });
  app.register(mealRoutes, { prefix: '/meals' });
  return app;
}
function buildSubsApp() {
  const app = Fastify();
  app.setErrorHandler((err: any, _req, reply) => {
    if (err?.name === 'ZodError' || Array.isArray(err?.issues)) return reply.code(400).send({ error: 'zod' });
    return reply.code(500).send({ error: err?.message ?? 'test' });
  });
  app.register(substanceRoutes, { prefix: '/substances' });
  return app;
}
async function call(app: any, req: any) {
  return app.inject(req);
}

beforeEach(() => {
  h.foods.clear();
  h.meals.length = 0;
  h.waters.length = 0;
  h.subs.length = 0;
  h.nextId = 1;
});

// =====================================================================
// /meals/trend
// =====================================================================

describe('/meals/trend', () => {
  it('returns contiguous days even when zero meals are logged', async () => {
    const app = buildMealsApp();
    const res = await call(app, { method: 'GET', url: '/meals/trend?days=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.days).toHaveLength(5);
    for (const d of body.days) {
      expect(d.calories).toBe(0);
      expect(d.mealCount).toBe(0);
    }
  });

  it('sums per-day totals (cal, protein, carb, fat) with servings multiplier', async () => {
    const app = buildMealsApp();
    h.foods.set('f1', { id: 'f1', calories: 100, proteinG: 10, carbG: 20, fatG: 5 });
    const day = new Date(Date.now() - 1 * 86_400_000);
    day.setUTCHours(12, 0, 0, 0);
    h.meals.push(
      { id: 'm1', userId: 'u1', foodId: 'f1', meal: 'LUNCH', servings: 2, note: null, loggedAt: day, food: h.foods.get('f1')! },
      { id: 'm2', userId: 'u1', foodId: 'f1', meal: 'LUNCH', servings: 2, note: null, loggedAt: new Date(day.getTime() + 7 * 3600_000), food: h.foods.get('f1')! },
    );
    const res = await call(app, { method: 'GET', url: '/meals/trend?days=3' });
    const body = res.json();
    const targetDay = (body.days as any[]).find((d) => d.calories > 0);
    expect(targetDay).toBeTruthy();
    // 2 entries × 2 servings × 100 cal = 400 cal
    expect(targetDay.calories).toBe(400);
    // 2 × 2 × 10 = 40 g protein
    expect(targetDay.proteinG).toBe(40);
    // 2 × 2 × 20 = 80 g carbs
    expect(targetDay.carbG).toBe(80);
    // 2 × 2 × 5 = 20 g fat
    expect(targetDay.fatG).toBe(20);
    expect(targetDay.mealCount).toBe(2);
  });

  it('merges WATER_ML measurements into the waterMl field', async () => {
    const app = buildMealsApp();
    h.foods.set('f1', { id: 'f1', calories: 0, proteinG: 0, carbG: 0, fatG: 0 });
    const day = new Date(Date.now() - 1 * 86_400_000);
    day.setUTCHours(8, 0, 0, 0);
    h.meals.push({
      id: 'm1', userId: 'u1', foodId: 'f1', meal: 'BREAKFAST', servings: 1, note: null,
      loggedAt: day, food: h.foods.get('f1')!,
    });
    h.waters.push(
      { userId: 'u1', metric: 'WATER_ML', value: 500, recordedAt: new Date(day.getTime() + 2 * 3600_000) },
      { userId: 'u1', metric: 'WATER_ML', value: 300, recordedAt: new Date(day.getTime() + 7 * 3600_000) },
    );
    const res = await call(app, { method: 'GET', url: '/meals/trend?days=3' });
    const targetDay = (res.json().days as any[]).find((d) => d.waterMl > 0);
    expect(targetDay).toBeTruthy();
    expect(targetDay.waterMl).toBe(800);
  });

  it('defaults days to 14 when omitted', async () => {
    const app = buildMealsApp();
    const res = await call(app, { method: 'GET', url: '/meals/trend' });
    expect(res.json().days).toHaveLength(14);
  });

  it('rejects days > 90 with 400', async () => {
    const app = buildMealsApp();
    const res = await call(app, { method: 'GET', url: '/meals/trend?days=91' });
    expect(res.statusCode).toBe(400);
  });
});

// =====================================================================
// /substances/trend
// =====================================================================

describe('/substances/trend', () => {
  it('returns 4 lines (CAFFEINE, ALCOHOL, NICOTINE, ELECTROLYTE) per day', async () => {
    const app = buildSubsApp();
    const res = await call(app, { method: 'GET', url: '/substances/trend?days=3' });
    expect(res.statusCode).toBe(200);
    for (const d of res.json().days) {
      expect(d).toHaveProperty('CAFFEINE');
      expect(d).toHaveProperty('ALCOHOL');
      expect(d).toHaveProperty('NICOTINE');
      expect(d).toHaveProperty('ELECTROLYTE');
      expect(d.CAFFEINE).toBe(0);
    }
  });

  it('counts each log once per day (3 cups of coffee → 3)', async () => {
    const app = buildSubsApp();
    const day = new Date(Date.now() - 1 * 86_400_000);
    day.setUTCHours(8, 0, 0, 0);
    for (let i = 0; i < 3; i++) {
      h.subs.push({
        userId: 'u1', category: 'CAFFEINE', form: 'coffee',
        loggedAt: new Date(day.getTime() + i * 3600_000),
      });
    }
    const res = await call(app, { method: 'GET', url: '/substances/trend?days=3' });
    const targetDay = (res.json().days as any[]).find((d) => d.CAFFEINE > 0);
    expect(targetDay).toBeTruthy();
    expect(targetDay.CAFFEINE).toBe(3);
  });

  it('separate days are separate buckets', async () => {
    const app = buildSubsApp();
    const d0 = new Date(Date.now() - 0 * 86_400_000);
    d0.setUTCHours(19, 0, 0, 0);
    const d1 = new Date(Date.now() - 1 * 86_400_000);
    d1.setUTCHours(19, 0, 0, 0);
    h.subs.push({ userId: 'u1', category: 'ALCOHOL', form: 'beer', loggedAt: d0 });
    h.subs.push({ userId: 'u1', category: 'ALCOHOL', form: 'beer', loggedAt: d1 });
    const res = await call(app, { method: 'GET', url: '/substances/trend?days=3' });
    const days = res.json().days as any[];
    const today = days.find((d) => d.day === d0.toISOString().slice(0, 10))!;
    const yesterday = days.find((d) => d.day === d1.toISOString().slice(0, 10))!;
    expect(today.ALCOHOL).toBe(1);
    expect(yesterday.ALCOHOL).toBe(1);
  });
});