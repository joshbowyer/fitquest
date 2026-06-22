import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FoodSource, MealType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { callLlm, getActiveLlmConfig, type LlmConfig } from '../lib/llm.js';
import {
  offSearch,
  offBarcode,
  normalizeOffProduct,
  type FoodMatch as OffMatch,
} from '../lib/openfoodfacts.js';
import {
  usdaSearch,
  normalizeUsdaFood,
  type FoodMatch as UsdaMatch,
} from '../lib/usda.js';

const FOOD_SYSTEM_PROMPT = `You are a nutrition lookup assistant. The user has given a free-form description of a food or meal. Your job: extract a SHORT search query for OpenFoodFacts (the database we use).

Critical: OpenFoodFacts is a French-origin database with thousands of generic products. It matches poorly on long queries or modifiers. Strip descriptors that don't change the food identity, but KEEP the brand name when present (branded products are easier to find than generics).

  BAD:  "fried boneless chicken breast about the size and thickness of my hand"
  GOOD: "chicken breast"

  BAD:  "the coffee I had this morning, oat milk, no sugar"
  GOOD: "coffee"

  BAD:  "6 large strawberries"
  GOOD: "strawberries"

  KEEP: "Annie's Mac and Cheese"          (brand matters)
  GOOD: "Annie's Mac Cheese"

  KEEP: "Trader Joe's Greek Yogurt"       (brand matters)
  GOOD: "Trader Joe's Greek Yogurt"

Rules:
- Output strict JSON, no prose, no markdown fences.
- The query should be 2-4 keywords. Use 2 for a clear single food
  ("chicken breast"), 3-4 when a brand or modifier is essential.
- If the user mentioned a brand name, KEEP it. Branded products
  exist in OFF; generic terms without a brand may return noise.
- Drop cooking methods (fried, baked, grilled, raw, steamed).
- Drop qualifiers (boneless, skinless, large, organic).
- Drop sizing/packaging hints ("about the size of my hand",
  "6 of them", "the usual size") — the user will set portion
  size after finding the food.
- Do not invent brand names.
- If the description is too vague to search (e.g. "food"),
  return { "query": null, "reason": "..." }.

Schema:
{
  "query": "2-4 keyword search string OR null",
  "reason": "short explanation (1 sentence)"
}`;

const FOOD_SEARCH_PROMPT = (description: string) => `User description: ${description}\n\nExtract a search query.`;

export async function foodRoutes(app: FastifyInstance) {
  // GET /foods/search?q=...
  // Try OFF first. If OFF returns < 3 hits AND the user has a
  // USDA key, fall back to USDA. Cache the results we return in
  // our FoodItem table (source + sourceId unique) so subsequent
  // searches / meal logs don't re-hit the upstream API.
  app.get('/search', async (req) => {
    const me = await requireUser(req);
    const q = z.object({ q: z.string().min(1).max(120) }).parse(req.query);
    const trimmed = q.q.trim();
    if (!trimmed) return { items: [] };

    // Try OFF first
    let offHits: OffMatch[] = [];
    try {
      const raw = await offSearch(trimmed, 10);
      offHits = raw
        .map(normalizeOffProduct)
        .filter((m): m is OffMatch => m !== null);
    } catch {
      // OFF is best-effort; fall through to USDA
    }

    let usdaHits: UsdaMatch[] = [];
    if (offHits.length < 3 && me.usdaApiKey) {
      try {
        const raw = await usdaSearch(trimmed, me.usdaApiKey, 10);
        usdaHits = raw
          .map(normalizeUsdaFood)
          .filter((m): m is UsdaMatch => m !== null);
      } catch {
        // USDA failed too; just return what we have
      }
    }

    // Cache everything we got (upsert by source+sourceId).
    const allHits = [...offHits, ...usdaHits];
    for (const h of allHits) {
      await prisma.foodItem.upsert({
        where: { source_sourceId: { source: h.source, sourceId: h.sourceId } },
        create: {
          source: h.source,
          sourceId: h.sourceId,
          name: h.name,
          brand: h.brand,
          imageUrl: h.imageUrl,
          servingSizeG: h.servingSizeG,
          calories: h.calories,
          proteinG: h.proteinG,
          carbG: h.carbG,
          fatG: h.fatG,
          fiberG: h.fiberG,
          sugarG: h.sugarG,
          sodiumMg: h.sodiumMg,
          sourceUrl: h.sourceUrl,
        },
        update: {
          name: h.name,
          brand: h.brand,
          imageUrl: h.imageUrl,
          servingSizeG: h.servingSizeG,
          calories: h.calories,
          proteinG: h.proteinG,
          carbG: h.carbG,
          fatG: h.fatG,
          fiberG: h.fiberG,
          sugarG: h.sugarG,
          sodiumMg: h.sodiumMg,
          sourceUrl: h.sourceUrl,
          fetchedAt: new Date(),
        },
      });
    }

    return { items: allHits.slice(0, 10) };
  });

  // GET /foods/barcode/:code
  // Direct barcode lookup. OFF has the best global coverage.
  app.get<{ Params: { code: string } }>('/barcode/:code', async (req, reply) => {
    const me = await requireUser(req);
    const code = (req.params as any).code?.trim();
    if (!code) return reply.code(400).send({ error: 'No barcode' });
    const cached = await prisma.foodItem.findUnique({
      where: { source_sourceId: { source: 'OPENFOODFACTS', sourceId: code } },
    });
    if (cached) return { item: cached };

    let product = null;
    try {
      product = await offBarcode(code);
    } catch {
      // OFF failed
    }
    if (!product) return reply.code(404).send({ error: 'Barcode not found' });
    const match = normalizeOffProduct(product);
    if (!match) return reply.code(404).send({ error: 'Barcode data incomplete' });

    const item = await prisma.foodItem.create({
      data: {
        source: match.source,
        sourceId: match.sourceId,
        name: match.name,
        brand: match.brand,
        imageUrl: match.imageUrl,
        servingSizeG: match.servingSizeG,
        calories: match.calories,
        proteinG: match.proteinG,
        carbG: match.carbG,
        fatG: match.fatG,
        fiberG: match.fiberG,
        sugarG: match.sugarG,
        sodiumMg: match.sodiumMg,
        sourceUrl: match.sourceUrl,
      },
    });
    return { item };
  });

  // POST /foods/ask-ai
  // Free-form description → LLM extracts a search query → we run
  // it through the same /search pipeline. If the LLM is disabled
  // or the description is too vague, returns 422.
  const AskAiSchema = z.object({
    description: z.string().min(3).max(500),
  });
  app.post('/ask-ai', async (req, reply) => {
    const me = await requireUser(req);
    const body = AskAiSchema.parse(req.body);
    const config = await getActiveLlmConfig();
    if (!config) {
      return reply.code(422).send({
        error: 'LLM not configured. Add an LLM provider in /admin to use Ask AI.',
      });
    }
    const result = await callLlm(config, {
      system: FOOD_SYSTEM_PROMPT,
      prompt: FOOD_SEARCH_PROMPT(body.description),
      maxTokens: 200,
      temperature: 0.2,
      timeoutMs: 30_000,
    });
    if (!result.ok) {
      return reply.code(502).send({ error: result.error ?? 'LLM failed' });
    }
    const parsed = extractJson(result.text);
    const query = parsed?.query;
    if (typeof query !== 'string' || query.length < 2) {
      return reply.code(422).send({
        error: parsed?.reason ?? "Couldn't figure out a search query from that description.",
      });
    }
    // Run the extracted query through the same /search pipeline.
    // Call the libs directly rather than self-fetching (avoids the
    // cookie-fwd dance and lets the LLM's request trigger fresh
    // upstream lookups without an extra HTTP hop).
    const offHits: OffMatch[] = [];
    try {
      const raw = await offSearch(query, 10);
      for (const p of raw) {
        const m = normalizeOffProduct(p);
        if (m) offHits.push(m);
      }
    } catch {
      // OFF down, continue
    }
    let usdaHits: UsdaMatch[] = [];
    if (offHits.length < 3 && me.usdaApiKey) {
      try {
        const raw = await usdaSearch(query, me.usdaApiKey, 10);
        for (const f of raw) {
          const m = normalizeUsdaFood(f);
          if (m) usdaHits.push(m);
        }
      } catch {
        // USDA down, continue
      }
    }
    const allHits = [...offHits, ...usdaHits].slice(0, 10);
    // Cache for the next time the user searches the same thing.
    for (const h of allHits) {
      await prisma.foodItem.upsert({
        where: { source_sourceId: { source: h.source, sourceId: h.sourceId } },
        create: {
          source: h.source,
          sourceId: h.sourceId,
          name: h.name,
          brand: h.brand,
          imageUrl: h.imageUrl,
          servingSizeG: h.servingSizeG,
          calories: h.calories,
          proteinG: h.proteinG,
          carbG: h.carbG,
          fatG: h.fatG,
          fiberG: h.fiberG,
          sugarG: h.sugarG,
          sodiumMg: h.sodiumMg,
          sourceUrl: h.sourceUrl,
        },
        update: {
          name: h.name,
          brand: h.brand,
          imageUrl: h.imageUrl,
          servingSizeG: h.servingSizeG,
          calories: h.calories,
          proteinG: h.proteinG,
          carbG: h.carbG,
          fatG: h.fatG,
          fiberG: h.fiberG,
          sugarG: h.sugarG,
          sodiumMg: h.sodiumMg,
          sourceUrl: h.sourceUrl,
          fetchedAt: new Date(),
        },
      });
    }
    return {
      query,
      reason: parsed.reason,
      items: allHits,
    };
  });
}

function extractJson(text: string): any | null {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence && fence[1]) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(trimmed.slice(first, last + 1)); } catch {}
  }
  return null;
}

// ============================================================================
// Saved foods (the user's own recipes — daily shake etc)
// ============================================================================
//
// CRUD over the user's SavedFood table. Logging a saved food creates
// a FoodItem (source=MANUAL) on the fly and writes a MealEntry the
// usual way, so the rest of the food tracker doesn't have to know
// whether the food came from OFF/USDA or the user's own list.

const SavedFoodUpsertSchema = z.object({
  name: z.string().min(1).max(120),
  brand: z.string().max(80).optional().nullable(),
  servingSizeG: z.number().min(0).max(10000).optional().nullable(),
  calories: z.number().min(0).max(10000),
  proteinG: z.number().min(0).max(1000),
  carbG: z.number().min(0).max(1000),
  fatG: z.number().min(0).max(1000),
  fiberG: z.number().min(0).max(1000).optional().nullable(),
  sugarG: z.number().min(0).max(1000).optional().nullable(),
  sodiumMg: z.number().min(0).max(100000).optional().nullable(),
  recipe: z.string().max(2000).optional().nullable(),
});

const SavedFoodLogSchema = z.object({
  meal: z.nativeEnum(MealType),
  servings: z.number().min(0.1).max(50).default(1),
  note: z.string().max(500).optional().nullable(),
});

// Note: a separate route file would be cleaner, but we already
// have foodRoutes registered for /foods/* so the new endpoints
// live under /foods/saved/*.
export async function savedFoodRoutes(app: FastifyInstance) {
  // GET /foods/saved - list the user's saved foods, sorted by
  // useCount + lastUsedAt. The "recent" panel on the food tracker
  // calls this.
  app.get('/foods/saved', async (req) => {
    const me = await requireUser(req);
    const items = await prisma.savedFood.findMany({
      where: { userId: me.id },
      orderBy: [{ useCount: 'desc' }, { lastUsedAt: 'desc' }],
    });
    return { items };
  });

  // POST /foods/saved - upsert a saved food by (userId, name).
  // The same name on a second call updates the macros in place
  // (so tweaking a recipe is one POST away).
  app.post('/foods/saved', async (req) => {
    const me = await requireUser(req);
    const body = SavedFoodUpsertSchema.parse(req.body);
    const item = await prisma.savedFood.upsert({
      where: { userId_name: { userId: me.id, name: body.name } },
      create: {
        userId: me.id,
        name: body.name,
        brand: body.brand ?? null,
        servingSizeG: body.servingSizeG ?? null,
        calories: body.calories,
        proteinG: body.proteinG,
        carbG: body.carbG,
        fatG: body.fatG,
        fiberG: body.fiberG ?? null,
        sugarG: body.sugarG ?? null,
        sodiumMg: body.sodiumMg ?? null,
        recipe: body.recipe ?? null,
      },
      update: {
        brand: body.brand ?? null,
        servingSizeG: body.servingSizeG ?? null,
        calories: body.calories,
        proteinG: body.proteinG,
        carbG: body.carbG,
        fatG: body.fatG,
        fiberG: body.fiberG ?? null,
        sugarG: body.sugarG ?? null,
        sodiumMg: body.sodiumMg ?? null,
        recipe: body.recipe ?? null,
      },
    });
    return { item };
  });

  // DELETE /foods/saved/:id - remove a saved food.
  app.delete('/foods/saved/:id', async (req) => {
    const me = await requireUser(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.savedFood.findFirst({ where: { id, userId: me.id } });
    if (!existing) return { ok: true, deleted: 0 };
    await prisma.savedFood.delete({ where: { id } });
    return { ok: true, deleted: 1 };
  });

  // POST /foods/saved/:id/log - quick-log a saved food as a meal.
  // Bumps useCount + lastUsedAt so the recent list re-orders.
  // Creates a FoodItem (source=MANUAL) on the fly with the saved
  // food's macros, then a MealEntry pointing to it.
  app.post('/foods/saved/:id/log', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = req.params as { id: string };
    const body = SavedFoodLogSchema.parse(req.body);
    const saved = await prisma.savedFood.findFirst({ where: { id, userId: me.id } });
    if (!saved) return reply.code(404).send({ error: 'Saved food not found' });
    // Upsert a MANUAL FoodItem keyed on (source=MANUAL, sourceId=savedFood.id).
    // The unique constraint guarantees one row per saved food; updating
    // the saved food's macros here would also work but we keep FoodItem
    // immutable per MealEntry (ServingSizeSnapshot pattern).
    const food = await prisma.foodItem.upsert({
      where: { source_sourceId: { source: 'MANUAL', sourceId: saved.id } },
      create: {
        source: 'MANUAL',
        sourceId: saved.id,
        name: saved.name,
        brand: saved.brand,
        servingSizeG: saved.servingSizeG,
        calories: saved.calories,
        proteinG: saved.proteinG,
        carbG: saved.carbG,
        fatG: saved.fatG,
        fiberG: saved.fiberG,
        sugarG: saved.sugarG,
        sodiumMg: saved.sodiumMg,
        sourceUrl: null,
      },
      update: {
        // Keep these stable so historical MealEntries don't drift if
        // the user later edits the saved food's macros.
      },
    });
    const entry = await prisma.mealEntry.create({
      data: {
        userId: me.id,
        foodId: food.id,
        meal: body.meal,
        servings: body.servings,
        note: body.note ?? null,
      },
    });
    // Bump useCount + lastUsedAt so the recent list re-orders.
    await prisma.savedFood.update({
      where: { id: saved.id },
      data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    return { entry, food };
  });
}
