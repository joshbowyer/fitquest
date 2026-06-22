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
}

Example (expected output):
User description: Trader Joe's vanilla Greek yogurt
{"query":"Trader Joe's vanilla Greek yogurt","reason":"Branded product; keep brand for accurate OFF match."}

Example (expected output):
User description: a banana
{"query":"banana","reason":"Single generic food, no brand or modifiers present."}`;

const FOOD_SEARCH_PROMPT = (description: string) => `User description: ${description}\n\nRespond with strict JSON only: {"query":"...","reason":"..."}.`;

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
      // jsonMode forces the model to output valid JSON. With
      // Ollama, this sets `format: 'json'`; with OpenAI, it
      // sets `response_format: { type: 'json_object' }`. Either
      // way, the fallback parser in extractAskAiResult() is
      // rarely needed.
      jsonMode: true,
    });
    if (!result.ok) {
      return reply.code(502).send({ error: result.error ?? 'LLM failed' });
    }
    const extracted = extractAskAiResult(result.text);
    if (!extracted) {
      return reply.code(422).send({
        error: "Couldn't figure out a search query from that description.",
      });
    }
    const { query, reason: askReason } = extracted;
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
      reason: askReason,
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

// Parse the LLM's response and pull out a search query, reason, and
// optional items array. Handles three formats we see in practice:
//   1. Strict JSON: {"query":"chicken breast","reason":"…","items":[]}
//      (Anthropic, OpenAI, well-tuned local models)
//   2. JSON-ish:   {"query":"chicken breast", "reason":"…"}
//      (trailing-comma / space variants)
//   3. Plain text: "chicken breast"
//      (smaller instruction-tuned models that ignore the JSON rule
//      and just echo the user input)
//
// For (3), we use the whole text as the query — better than failing
// the user with a 422 when the LLM clearly understood the task but
// just didn't follow the format.
function extractAskAiResult(text: string): { query: string; reason: string; items: any[] } | null {
  const parsed = extractJson(text);
  if (parsed && typeof parsed.query === 'string' && parsed.query.length >= 2) {
    return {
      query: parsed.query,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  }
  // Fallback: treat the whole text as a query. Strip surrounding
  // quotes / whitespace / punctuation. Reject if the model went on
  // a tangent (>120 chars or no alphabetic content).
  const cleaned = text.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (cleaned.length >= 2 && cleaned.length <= 120 && /[a-zA-Z]/.test(cleaned)) {
    return { query: cleaned, reason: 'Model returned a plain query instead of JSON; used as-is.', items: [] };
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

  // POST /foods/saved/ask-ai
  // Free-form description of a recipe → LLM returns per-serving
  // macros the user can save. Different from /foods/ask-ai (which
  // returns a list of OFF/USDA matches): here we want the user to
  // describe something they make themselves (a shake, a bowl) and
  // have the model estimate the nutrition.
  const SavedFoodAskAiSchema = z.object({
    description: z.string().min(5).max(1500),
    /// Optional: "per 100g" or "per serving" — helps the model
    /// commit to a unit. Default "per serving".
    unitBasis: z.enum(['per_serving', 'per_100g']).default('per_serving'),
  });
  app.post('/foods/saved/ask-ai', async (req, reply) => {
    const me = await requireUser(req);
    const body = SavedFoodAskAiSchema.parse(req.body);
    const config = await getActiveLlmConfig();
    if (!config) {
      return reply.code(422).send({
        error: 'LLM not configured. Add an LLM provider in /admin to use Ask AI.',
      });
    }
    const result = await callLlm(config, {
      system: SAVED_FOOD_SYSTEM_PROMPT,
      prompt: SAVED_FOOD_ESTIMATE_PROMPT(body.description, body.unitBasis),
      maxTokens: 400,
      jsonMode: true,
      temperature: 0.2,
      timeoutMs: 60_000,
    });
    if (!result.ok) {
      return reply.code(502).send({ error: result.error ?? 'LLM failed' });
    }
    const parsed = extractJson(result.text);
    if (!parsed) {
      return reply.code(422).send({
        error: "Couldn't parse the AI's response. Try rewording the description.",
      });
    }
    // Coerce numbers; missing fields become 0 (the editor lets the
    // user fill in what the model didn't estimate).
    const num = (v: any): number => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    return {
      suggestion: {
        name: typeof parsed.name === 'string' ? parsed.name : '',
        servingSizeG: num(parsed.servingSizeG),
        calories: num(parsed.calories),
        proteinG: num(parsed.proteinG),
        carbG: num(parsed.carbG),
        fatG: num(parsed.fatG),
        fiberG: num(parsed.fiberG),
        sugarG: num(parsed.sugarG),
        sodiumMg: num(parsed.sodiumMg),
        recipe: typeof parsed.recipe === 'string' ? parsed.recipe : body.description,
        // Reasoning shown under the suggestion so the user can spot
        // a wrong call before saving ("the LLM assumed 2% milk fat").
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
        confidence: typeof parsed.confidence === 'string' ? parsed.confidence : 'medium',
        unitBasis: body.unitBasis,
      },
    };
  });
}

// ============================================================================
// Saved-food Ask-AI prompt
// ============================================================================
//
// We ask the LLM to act as a nutrition calculator. The user describes
// a recipe in plain language; the model returns per-serving (or
// per-100g, if unitBasis says so) macros plus the recipe written
// back for the user to review. We also ask for `reasoning` and
// `confidence` so the UI can show the user what the LLM assumed.

const SAVED_FOOD_SYSTEM_PROMPT = `You are a nutrition calculator for a self-hosted fitness RPG app. The user is describing a recipe they make themselves (a shake, a bowl, a meal prep) and wants you to estimate the per-serving macros.

You must:
- Return strict JSON only. No prose, no markdown fences, no preamble.
- Estimate per serving (or per 100g if the user says so) to the nearest gram / calorie.
- Use USDA / generic food database knowledge. If you don't know a value, use 0 and note it in reasoning. Never invent.
- Capture the user's exact description in 'recipe' (lightly cleaned up). Don't paraphrase.
- Set 'confidence' to 'high' (well-known foods, common combos), 'medium' (uncommon or estimate-heavy), or 'low' (vague, raw weights missing, exotic ingredients).
- Keep reasoning to 1-2 short sentences.

Return JSON with this exact shape:
{
  "name": "string — short human name, e.g. 'Daily Shake'",
  "servingSizeG": number,
  "calories": number,
  "proteinG": number,
  "carbG": number,
  "fatG": number,
  "fiberG": number,
  "sugarG": number,
  "sodiumMg": number,
  "recipe": "string",
  "reasoning": "string",
  "confidence": "high" | "medium" | "low"
}`;

function SAVED_FOOD_ESTIMATE_PROMPT(description: string, unitBasis: 'per_serving' | 'per_100g'): string {
  return `The user described this recipe:\n\n${description}\n\n` +
    `Return per-${unitBasis === 'per_100g' ? '100g' : 'serving'} macros. ` +
    `If a serving size is ambiguous, assume one standard serving (one shake, one bowl, one sandwich).`;
}

// ============================================================================
// FoodYou import
// ============================================================================
//
// The user exported a FoodYou Android app database (SQLite). It
// contains a Product table with the full OFF+USDA catalog, a
// FoodEvent table with what the user actually LOGGED, and a
// SearchEntry table with their recent searches. We expose two
// endpoints:
//
//   GET  /foods/import/foodyou?path=/tmp/foodyou-db.db
//        returns: { available, logged: [...], recent: [...] }
//
//   POST /foods/import/foodyou/commit
//        body: { items: [{ name, brand, servingSizeG, cal, p, c, f, ... }] }
//        creates SavedFood rows (deduped by userId+name).
//
// The server is the one reading the file because the SQLite
// driver is native — running in Node lets us handle the
// older schema and column names directly. We use better-sqlite3
// (sync, no async overhead) for speed.

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

type ImportedFood = {
  name: string;
  brand: string | null;
  servingSizeG: number | null;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  // Source row in the FoodYou DB (for dedup / display).
  source: 'logged' | 'recent';
  foodYouId: number;
};

function readFoodYouDb(dbPath: string): { logged: ImportedFood[]; recent: ImportedFood[]; searches: ImportedFood[] } | { error: string } {
  if (!fs.existsSync(dbPath)) {
    return { error: `File not found: ${dbPath}` };
  }
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (e: any) {
    return { error: `Failed to open DB: ${e?.message ?? e}` };
  }
  try {
    // Logged foods: every FoodEvent.type = 0 maps to a Product
    // (or Recipe). Recipes aren't supported here — we import
    // products only. Dedupe by (name, brand) so logging the
    // same product 5 times doesn't show 5 entries.
    const loggedRows = db.prepare(`
      SELECT fe.id AS event_id, fe.epochSeconds AS ts,
             p.id, p.name, p.brand, p.servingWeight, p.energy,
             p.proteins, p.fats, p.carbohydrates, p.sugars,
             p.dietaryFiber, p.sodiumMilli
      FROM FoodEvent fe
      INNER JOIN Product p ON p.id = fe.productId
      WHERE fe.type = 0
      ORDER BY fe.epochSeconds DESC
    `).all() as any[];

    // Recent additions: distinct products by highest rowid in the
    // last 200 (i.e. anything the user added recently that
    // may not be in their log history). We use rowid DESC so
    // "most recent in their catalog" is the order.
    const recentRows = db.prepare(`
      SELECT p.id, p.name, p.brand, p.servingWeight, p.energy,
             p.proteins, p.fats, p.carbohydrates, p.sugars,
             p.dietaryFiber, p.sodiumMilli, p.rowid
      FROM Product p
      WHERE p.rowid > (SELECT MAX(rowid) - 200 FROM Product)
        AND p.energy IS NOT NULL AND p.energy > 0
      ORDER BY p.rowid DESC
      LIMIT 100
    `).all() as any[];

    // Recent searches: the user's last 20 distinct search terms.
    // Each one is resolved to its best-matching Product (the
    // first result OFF/USDA returned) so we can import it as a
    // concrete food with macros. The user mentioned
    // "alcoholic beverage wint table white" — that's a search
    // for "white wine" with a typo. The actual OFF/USDA matches
    // get imported as the food, not the search term.
    const searchRows = db.prepare(`
      SELECT DISTINCT query FROM SearchEntry
      ORDER BY epochSeconds DESC LIMIT 20
    `).all() as any[];

    // For each search term, do a CASE-INSENSITIVE LIKE match
    // against the Product name and grab the top result. We
    // can't reuse the OFF API here (we're offline); a LIKE on
    // the local Product table is the next best thing.
    const searchHits: any[] = [];
    for (const row of searchRows) {
      const q = (row.query ?? '').trim();
      if (q.length < 2) continue;
      const hit = db.prepare(`
        SELECT id, name, brand, servingWeight, energy,
               proteins, fats, carbohydrates, sugars,
               dietaryFiber, sodiumMilli
        FROM Product
        WHERE LOWER(name) LIKE LOWER(?) ESCAPE '\\'
          AND energy IS NOT NULL AND energy > 0
        ORDER BY
          CASE WHEN LOWER(name) = LOWER(?) THEN 0 ELSE 1 END,
          CASE WHEN LOWER(name) LIKE LOWER(?) || '%' ESCAPE '\\' THEN 0 ELSE 1 END,
          id DESC
        LIMIT 1
      `).get(
        `%${q.replace(/[\\%_]/g, '\\$&')}%`,
        q,
        q,
      ) as any;
      if (hit) searchHits.push({ query: q, hit });
    }

    function toImported(r: any, source: 'logged' | 'recent' | 'search'): ImportedFood {
      return {
        name: r.name,
        brand: r.brand ?? null,
        servingSizeG: r.servingWeight ?? 100,
        calories: r.energy ?? 0,
        proteinG: r.proteins ?? 0,
        carbG: r.carbohydrates ?? 0,
        fatG: r.fats ?? 0,
        fiberG: r.dietaryFiber ?? null,
        sugarG: r.sugars ?? null,
        sodiumMg: r.sodiumMilli ?? null,
        source,
        foodYouId: r.id,
      };
    }

    const seen = new Set<string>();
    const logged: ImportedFood[] = [];
    for (const r of loggedRows) {
      const key = `${r.name}|${r.brand ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const f = toImported(r, 'logged');
      if (f.calories > 0) logged.push(f);
    }

    const recent: ImportedFood[] = [];
    for (const r of recentRows) {
      const key = `${r.name}|${r.brand ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const f = toImported(r, 'recent');
      if (f.calories > 0) recent.push(f);
    }

    const searches: ImportedFood[] = [];
    for (const sh of searchHits) {
      const key = `${sh.hit.name}|${sh.hit.brand ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const f = toImported(sh.hit, 'search');
      if (f.calories > 0) searches.push(f);
    }

    return { logged, recent, searches };
  } finally {
    db.close();
  }
}

export async function foodYouImportRoutes(app: FastifyInstance) {
  // GET /foods/import/foodyou?path=...
  // Probe a FoodYou export at the given path. Returns the list of
  // foods we'd import (logged + recent), grouped by source. The
  // user picks which ones to actually import on the client.
  //
  // For convenience, if no path is provided we look in /tmp for
  // any file matching 'foodyou-*.db' (the standard export name).
  app.get('/foods/import/foodyou', async (req, reply) => {
    const me = await requireUser(req);
    const q = z.object({ path: z.string().optional() }).parse(req.query ?? {});
    let dbPath = q.path;
    if (!dbPath) {
      // Auto-discover: pick the most recent foodyou-*.db in /tmp.
      try {
        const candidates = fs
          .readdirSync('/tmp')
          .filter((f) => f.startsWith('foodyou-') && f.endsWith('.db'))
          .map((f) => ({ f, m: fs.statSync(path.join('/tmp', f)).mtimeMs }))
          .sort((a, b) => b.m - a.m);
        if (candidates.length > 0) dbPath = path.join('/tmp', candidates[0].f);
      } catch {
        // /tmp might not be readable; that's OK.
      }
    }
    if (!dbPath) {
      return reply.code(200).send({ available: false, reason: 'no_foodyou_db', message: 'No FoodYou export found in /tmp/' });
    }
    const result = readFoodYouDb(dbPath);
    if ('error' in result) {
      return reply.code(200).send({ available: false, reason: 'parse_error', message: result.error, path: dbPath });
    }
    return {
      available: true,
      path: dbPath,
      logged: result.logged,
      recent: result.recent,
      searches: result.searches,
    };
  });

  // POST /foods/import/foodyou/commit
  // body: { items: [...] }
  // Creates SavedFood rows for each item (deduped by userId+name).
  // The client should send only the items the user selected from
  // the import list.
  app.post('/foods/import/foodyou/commit', async (req) => {
    const me = await requireUser(req);
    const body = z.object({
      items: z.array(z.object({
        name: z.string().min(1).max(200),
        brand: z.string().max(100).optional().nullable(),
        servingSizeG: z.number().min(0).max(5000).optional().nullable(),
        calories: z.number().min(0).max(5000),
        proteinG: z.number().min(0).max(500),
        carbG: z.number().min(0).max(500),
        fatG: z.number().min(0).max(500),
        fiberG: z.number().min(0).max(500).optional().nullable(),
        sugarG: z.number().min(0).max(500).optional().nullable(),
        sodiumMg: z.number().min(0).max(50000).optional().nullable(),
      })),
    }).parse(req.body);
    let created = 0, skipped = 0;
    for (const item of body.items) {
      try {
        await prisma.savedFood.upsert({
          where: { userId_name: { userId: me.id, name: item.name } },
          create: {
            userId: me.id,
            name: item.name,
            brand: item.brand ?? null,
            servingSizeG: item.servingSizeG ?? null,
            calories: item.calories,
            proteinG: item.proteinG,
            carbG: item.carbG,
            fatG: item.fatG,
            fiberG: item.fiberG ?? null,
            sugarG: item.sugarG ?? null,
            sodiumMg: item.sodiumMg ?? null,
            recipe: null,
          },
          update: {
            brand: item.brand ?? null,
            servingSizeG: item.servingSizeG ?? null,
            calories: item.calories,
            proteinG: item.proteinG,
            carbG: item.carbG,
            fatG: item.fatG,
            fiberG: item.fiberG ?? null,
            sugarG: item.sugarG ?? null,
            sodiumMg: item.sodiumMg ?? null,
          },
        });
        created++;
      } catch (e: any) {
        // Skip on per-item failure so a single bad row doesn't
        // abort the whole import. The user can re-try just the
        // failed rows.
        skipped++;
      }
    }
    return { ok: true, created, skipped };
  });
}
