import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FoodSource, MealType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';

// ============================================================================
// MealEntry CRUD
// ============================================================================
//
// A MealEntry = one instance of the user eating a food. The food is
// referenced by FoodItem.id (which is itself a cached OFF/USDA row);
// the per-100g macros are stored on FoodItem, so the MealEntry just
// stores a "servings" multiplier (1.0 = 100g, 2.0 = 200g, 0.5 = 50g).
//
// For now we keep it simple: one /meals POST creates one entry. The
// UI batches multiple servings of the same food by hitting POST N
// times, or we can add a `count` field later.

const CreateMealSchema = z.object({
  /// Two ways to identify the food:
  ///   1. foodId — a saved FoodItem id (preferred when re-logging
  ///      a food the user has used before).
  ///   2. source + sourceId — fetch a FoodItem by (source, sourceId),
  ///      upsert if missing. The UI uses this on first log of a
  ///      search result so we don't need a second round-trip.
  foodId: z.string().min(1).optional(),
  source: z.nativeEnum(FoodSource).optional(),
  sourceId: z.string().min(1).optional(),
  /// Display fields. When the search result is not yet in our
  /// FoodItem table, the UI passes these so we can create the row
  /// in one transaction with the MealEntry. Optional; ignored if
  /// foodId is provided.
  name: z.string().min(1).max(200).optional(),
  brand: z.string().max(200).optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  servingSizeG: z.number().positive().optional().nullable(),
  calories: z.number().min(0).optional(),
  proteinG: z.number().min(0).optional(),
  carbG: z.number().min(0).optional(),
  fatG: z.number().min(0).optional(),
  fiberG: z.number().min(0).optional().nullable(),
  sugarG: z.number().min(0).optional().nullable(),
  sodiumMg: z.number().min(0).optional().nullable(),
  sourceUrl: z.string().url().optional().nullable(),
  meal: z.nativeEnum(MealType),
  /// Multiplier of the FoodItem's per-100g base.
  servings: z.number().positive().max(50),
  note: z.string().max(200).optional().nullable(),
  loggedAt: z.string().datetime().optional(),
});

function todayInTz(timezone: string | null): string {
  const tz = timezone || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function mealRoutes(app: FastifyInstance) {
  // GET /meals/today
  // Returns the user's meal entries for today, grouped by meal,
  // with totals rolled up.
  app.get('/today', async (req) => {
    const me = await requireUser(req);
    const date = todayInTz(me.timezone);
    const since = new Date(date + 'T00:00:00Z');
    const until = new Date(since.getTime() + 24 * 60 * 60 * 1000);
    const entries = await prisma.mealEntry.findMany({
      where: {
        userId: me.id,
        loggedAt: { gte: since, lt: until },
      },
      include: { food: true },
      orderBy: { loggedAt: 'asc' },
    });
    // Roll up totals per meal.
    const byMeal: Record<string, { items: any[]; totals: Totals }> = {};
    for (const m of ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'] as const) {
      byMeal[m] = { items: [], totals: emptyTotals() };
    }
    const dayTotals = emptyTotals();
    for (const e of entries) {
      const served = scaleTotals(e.food, e.servings);
      const mealBucket = byMeal[e.meal];
      if (!mealBucket) continue;
      mealBucket.items.push({
        id: e.id,
        meal: e.meal,
        servings: e.servings,
        note: e.note,
        loggedAt: e.loggedAt.toISOString(),
        food: {
          id: e.food.id,
          source: e.food.source,
          sourceId: e.food.sourceId,
          name: e.food.name,
          brand: e.food.brand,
          imageUrl: e.food.imageUrl,
          servingSizeG: e.food.servingSizeG,
        },
        served,
      });
      addTotals(mealBucket.totals, served);
      addTotals(dayTotals, served);
    }
    return { date, meals: byMeal, dayTotals };
  });

  // GET /meals?days=7
  // Recent entries across N days, newest first. Used for the "recent"
  // sidebar in the food panel.
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const q = z
      .object({ days: z.coerce.number().int().min(1).max(30).default(7) })
      .parse(req.query);
    const since = new Date(Date.now() - q.days * 24 * 60 * 60 * 1000);
    const entries = await prisma.mealEntry.findMany({
      where: { userId: me.id, loggedAt: { gte: since } },
      include: { food: true },
      orderBy: { loggedAt: 'desc' },
      take: 100,
    });
    return {
      items: entries.map((e) => ({
        id: e.id,
        meal: e.meal,
        servings: e.servings,
        note: e.note,
        loggedAt: e.loggedAt.toISOString(),
        food: {
          id: e.food.id,
          name: e.food.name,
          brand: e.food.brand,
          imageUrl: e.food.imageUrl,
        },
        served: scaleTotals(e.food, e.servings),
      })),
    };
  });

  // POST /meals
  app.post('/', async (req, reply) => {
    const me = await requireUser(req);
    const body = CreateMealSchema.parse(req.body);
    let foodId: string;
    if (body.foodId) {
      // Already-saved path: verify ownership-relevant (the FoodItem
      // table is shared across all users so we just look up the row).
      const existing = await prisma.foodItem.findUnique({ where: { id: body.foodId } });
      if (!existing) return reply.code(404).send({ error: 'Food not found' });
      foodId = existing.id;
    } else if (body.source && body.sourceId) {
      // First-log path: upsert by (source, sourceId) so the next
      // log reuses the same row.
      if (
        body.name == null ||
        body.calories == null ||
        body.proteinG == null ||
        body.carbG == null ||
        body.fatG == null
      ) {
        return reply.code(400).send({
          error:
            'When logging a food by source/sourceId, name + cal/p/c/f are required.',
        });
      }
      const upserted = await prisma.foodItem.upsert({
        where: { source_sourceId: { source: body.source, sourceId: body.sourceId } },
        create: {
          source: body.source,
          sourceId: body.sourceId,
          name: body.name,
          brand: body.brand ?? null,
          imageUrl: body.imageUrl ?? null,
          servingSizeG: body.servingSizeG ?? null,
          calories: body.calories,
          proteinG: body.proteinG,
          carbG: body.carbG,
          fatG: body.fatG,
          fiberG: body.fiberG ?? null,
          sugarG: body.sugarG ?? null,
          sodiumMg: body.sodiumMg ?? null,
          sourceUrl: body.sourceUrl ?? null,
        },
        update: {
          name: body.name,
          brand: body.brand ?? null,
          imageUrl: body.imageUrl ?? null,
          servingSizeG: body.servingSizeG ?? null,
          calories: body.calories,
          proteinG: body.proteinG,
          carbG: body.carbG,
          fatG: body.fatG,
          fiberG: body.fiberG ?? null,
          sugarG: body.sugarG ?? null,
          sodiumMg: body.sodiumMg ?? null,
          sourceUrl: body.sourceUrl ?? null,
          fetchedAt: new Date(),
        },
      });
      foodId = upserted.id;
    } else {
      return reply.code(400).send({
        error: 'Provide either foodId or source+sourceId.',
      });
    }
    const entry = await prisma.mealEntry.create({
      data: {
        userId: me.id,
        foodId,
        meal: body.meal,
        servings: body.servings,
        note: body.note ?? null,
        loggedAt: body.loggedAt ? new Date(body.loggedAt) : new Date(),
      },
    });
    return { entry };
  });

  // DELETE /meals/:id
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const existing = await prisma.mealEntry.findUnique({ where: { id } });
    if (!existing || existing.userId !== me.id) {
      return reply.code(404).send({ error: 'Entry not found' });
    }
    await prisma.mealEntry.delete({ where: { id } });
    return { ok: true };
  });
}

// ============================================================================
// Helpers
// ============================================================================

type Totals = {
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  sodiumMg: number;
};

function emptyTotals(): Totals {
  return { calories: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0, sugarG: 0, sodiumMg: 0 };
}

function scaleTotals(
  food: {
    calories: number;
    proteinG: number;
    carbG: number;
    fatG: number;
    fiberG: number | null;
    sugarG: number | null;
    sodiumMg: number | null;
  },
  servings: number,
): Totals {
  return {
    calories: food.calories * servings,
    proteinG: food.proteinG * servings,
    carbG: food.carbG * servings,
    fatG: food.fatG * servings,
    fiberG: (food.fiberG ?? 0) * servings,
    sugarG: (food.sugarG ?? 0) * servings,
    sodiumMg: (food.sodiumMg ?? 0) * servings,
  };
}

function addTotals(a: Totals, b: Totals): void {
  a.calories += b.calories;
  a.proteinG += b.proteinG;
  a.carbG += b.carbG;
  a.fatG += b.fatG;
  a.fiberG += b.fiberG;
  a.sugarG += b.sugarG;
  a.sodiumMg += b.sodiumMg;
}
