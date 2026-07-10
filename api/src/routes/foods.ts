import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FoodSource, MealType } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { callLlm, getActiveLlmConfig, type LlmConfig } from '../lib/llm.js';
import {
  offSearch,
  offBarcode,
  normalizeOffProduct,
  rankResults,
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

/**
 * System prompt for the multi-item Ask AI flow. Takes a single
 * comma-separated description ("1 cup milk, 1 cup kefir, 6
 * strawberries, collagen peptides") and asks the LLM to split it
 * into individual items, each with a short OFF/USDA-friendly
 * search query. The server then runs each query through the
 * standard search pipeline so the user gets back real match
 * candidates with macros, not raw queries.
 *
 * Quantity/unit is best-effort: the LLM parses "1 cup" → {1, "cup"},
 * "6 strawberries" → {6, null}, "a pinch of salt" → {1, "pinch"}.
 * Per-100g macros are computed client-side from the per-serving
 * values returned by OFF/USDA.
 */
/**
 * System prompt for the Ask AI single-entry flow. Takes a single
 * free-form description (often comma-separated, with typos, brand
 * names, vague quantities) and asks the LLM to:
 *   1. parse the description into items
 *   2. estimate total macros for the whole meal as a SINGLE entry
 *
 * The UI shows the result as one card with editable name + macros
 * the user can adjust before logging. No OFF/USDA search — the LLM
 * does the estimation directly. Useful when the user wants to log
 * a recipe the app has no records for (homemade smoothie, mixed
 * plate, etc.).
 *
 * UNIT PARSING (be liberal with what the user means):
 *   "1 cup"             → quantity=1,  unit="cup"
 *   "7 oz almond milk"  → quantity=7,  unit="oz"
 *   "a handful of ..."  → quantity=1,  unit=null  (vague count)
 *   "a dozen ..."       → quantity=12, unit=null  (word→number!)
 *   "a scoop of ..."    → quantity=1,  unit="scoop" (~30g protein serving)
 *   "a table spoon"     → quantity=1,  unit="tbsp"  (typo tolerant)
 *   "1/2 cup"          → quantity=0.5, unit="cup"
 *   "3 strawberries"    → quantity=3,  unit=null  (count, no unit)
 *
 * CALORIE ESTIMATES (rough ranges the LLM should know):
 *   almond milk:           ~30-40 kcal/100ml (unsweetened), 1g P, 0.5g F
 *   dairy milk:            ~60 kcal/100ml (whole), 3g P, 3g F
 *   frozen berries:        ~50 kcal/100g, 1g P, 12g C
 *   banana:                ~90 kcal/100g, 1g P, 23g C
 *   avocado:               ~160 kcal/100g, 2g P, 9g F
 *   chicken breast:        ~165 kcal/100g cooked, 31g P
 *   rice (cooked white):   ~130 kcal/100g, 2.5g P, 28g C
 *   eggs:                  ~70 kcal each, 6g P, 5g F
 *   whey protein scoop:    ~120 kcal, 24g P, 3g C, 1g F
 *   casein protein scoop:  ~120 kcal, 24g P, 3g C, 1g F
 *   plant protein scoop:   ~120 kcal, 22g P, 5g C, 1.5g F
 *   collagen peptides:     ~35 kcal per 10g serving, 9g P
 *   creatine powder:       ~0 kcal (not metabolized)
 *   peanut butter:         ~95 kcal/tbsp, 4g P, 8g F
 *   olive oil:             ~120 kcal/tbsp, 14g F
 *   almonds:               ~7 kcal each, 0.25g P
 *
 * When in doubt, round to the nearest 5 kcal and use conservative
 * estimates. It's better to under-call calories than over-call.
 */
const ASK_AI_SINGLE_SYSTEM_PROMPT = `You are a nutrition estimator for a fitness tracking app. The user pastes a free-form description of one or more foods they ate, with quantities. Examples:

  1 cup milk, 1 cup kefir, 6 strawberries, collagen peptides, 1 avocado
  Made a smoothie of 7oz of almond mik, a handful of frozen strawberries, a dozen frozen raspberries, a table spoon of creatine, a table spoon of collagen peptides, and a scoop of gold standard whey protein.
  3 eggs and a piece of toast with butter
  Big bowl of pho with brisket

Your job: parse the description, estimate the TOTAL macros for the whole meal, and return a sensible display name.

PARSING RULES (be liberal):
- Strip "frozen", "fresh", "organic", "raw", "large", "small", "ripe" — they don't change calories
- Convert vague units: "a handful" ≈ 1 cup of berries (~150g), "a dozen" = 12, "a scoop" = 1 protein scoop (~30g)
- Fix typos: "mik"→"milk", "table spoon"→"tbsp", "protien"→"protein"
- KEEP brand names in the display name (e.g. "Gold Standard Whey Protein")
- KEEP what changed the meal (e.g. "almond" milk vs "dairy" milk — different calories)
- For unknown foods, estimate conservatively based on similar known foods. State uncertainty in "reason".

CALORIE ESTIMATION (these are ROUGH; the user can edit):
  7 oz unsweetened almond milk      ~70 kcal,   2g P,   1g C,   5g F
  1 cup frozen strawberries          ~50 kcal,   1g P,  12g C, 0.5g F
  1 cup frozen raspberries          ~65 kcal, 1.5g P,  15g C,   1g F
  1 tbsp creatine powder             ~0 kcal,   0    ,   0   ,   0
  1 tbsp collagen peptides powder  ~35 kcal,   9g P,   0   ,   0
  1 scoop whey protein             ~120 kcal,  24g P,   3g C,   1g F
  1 medium avocado                 ~240 kcal,   3g P,  12g C,  22g F
  3 large eggs                     ~215 kcal,  18g P,   1g C,  15g F
  1 cup cooked rice                ~205 kcal,   4g P,  45g C, 0.4g F
  6 oz chicken breast (cooked)     ~280 kcal,  47g P,   0   ,   7g F

Round totals to the nearest 5 kcal. When genuinely uncertain, err on the conservative side — overestimating calories is worse than underestimating.

NAMING:
- 2-6 word display name, as the user would say it.
- Combine the items when the meal is a single recipe: "Smoothie (berries + collagen + whey)" rather than separate entries.
- Keep brand names when relevant: "Gold Standard Whey shake".
- For a simple meal, name the main item: "Avocado toast", "Chicken + rice".

Output strict JSON only, no prose, no markdown fences.

Schema:
{
  "name": "2-6 word display name",
  "reason": "1 sentence explaining the estimate (assumptions, rounding)",
  "calories": <integer>,
  "proteinG": <number, 1 decimal>,
  "carbG": <number, 1 decimal>,
  "fatG": <number, 1 decimal>,
  "fiberG": <number, 1 decimal, optional>,
  "sugarG": <number, 1 decimal, optional>,
  "sodiumMg": <integer, optional>
}

Example (expected output):
User description: Made a smoothie of 7oz of almond mik, a handful of frozen strawberries, a dozen frozen raspberries, a table spoon of creatine, a table spoon of collagen peptides, and a scoop of gold standard whey protein.
{
  "name": "Smoothie (almond milk + berries + creatine + collagen + whey)",
  "reason": "Estimated 7oz almond milk (~70 kcal), 1 cup strawberries (~50), 12 raspberries (~65), creatine (0), 1 tbsp collagen (~35), 1 scoop Gold Standard whey (~120). Sum rounded.",
  "calories": 335,
  "proteinG": 37,
  "carbG": 30,
  "fatG": 7.5
}`;

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

    // Try OFF first. Fetch a larger page (50) so the rankResults()
    // pass below has a real pool to choose from — OFF rarely returns
    // the basic item in the top 10 (branded variants crowd it out)
    // but it usually appears within the top 50.
    let offHits: OffMatch[] = [];
    try {
      const raw = await offSearch(trimmed, 50);
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

    return { items: rankResults(trimmed, allHits).slice(0, 10) };
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

    const item = await prisma.foodItem.upsert({
      where: { source_sourceId: { source: match.source, sourceId: match.sourceId } },
      create: {
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
      update: {
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
        fetchedAt: new Date(),
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
    }, 'food');
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

  // POST /foods/ask-ai-multi
  // Multi-item Ask AI: user pastes "1 cup milk, 1 cup kefir, 6
  // strawberries, collagen peptides, 1 avocado" and the server
  // parses it into individual items, runs each through the OFF/USDA
  // search pipeline, and returns per-item match candidates with
  // macros. The UI then lets the user pick a match (or override),
  // set servings, and POST each to /meals in one batch.
  //
  // Difference from /foods/ask-ai: ask-ai returns a single search
  // query + hits for a single food. ask-ai-multi returns N parsed
  // items + per-item match candidates for a meal description.
  const AskAiMultiSchema = z.object({
    description: z.string().min(3).max(2000),
  });
  app.post('/ask-ai-multi', async (req, reply) => {
    const me = await requireUser(req);
    const body = AskAiMultiSchema.parse(req.body);
    const config = await getActiveLlmConfig();
    if (!config) {
      return reply.code(422).send({
        error: 'LLM not configured. Add an LLM provider in /admin to use Ask AI.',
      });
    }
    const result = await callLlm(config, {
      system: ASK_AI_SINGLE_SYSTEM_PROMPT,
      prompt: body.description,
      maxTokens: 1500,
      temperature: 0.2,
      timeoutMs: 45_000,
      jsonMode: true,
    }, 'food');
    if (!result.ok) {
      return reply.code(502).send({ error: result.error ?? 'LLM failed' });
    }
    const parsed = extractAskAiSingleResult(result.text);
    if (!parsed) {
      return reply.code(422).send({
        error: "Couldn't estimate that meal. Try a comma-separated list with quantities, e.g. '1 cup milk, 1 avocado, 6 strawberries'.",
      });
    }
    return parsed;
  });
}

/**
 * Parse the LLM's response from /foods/ask-ai-multi. Tolerates the
 * usual JSON variations (fenced, trailing-comma, partial). Returns
 * null when no items are recoverable.
 */
/**
 * Parse the LLM's response from /foods/ask-ai-multi (single-entry).
 * Expects { name, reason, calories, proteinG, carbG, fatG, ... }.
 * Tolerates the usual JSON variations (fenced, trailing-comma).
 * Returns null if the response is missing the required name +
 * calories pair.
 */
function extractAskAiSingleResult(text: string): {
  name: string;
  reason: string;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
} | null {
  const parsed = extractJson(text);
  if (!parsed || typeof parsed.name !== 'string' || typeof parsed.calories !== 'number') {
    return null;
  }
  return {
    name: parsed.name.trim(),
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    calories: Math.max(0, Math.round(parsed.calories)),
    proteinG: Math.max(0, Number(parsed.proteinG ?? 0)),
    carbG: Math.max(0, Number(parsed.carbG ?? 0)),
    fatG: Math.max(0, Number(parsed.fatG ?? 0)),
    fiberG: parsed.fiberG != null ? Math.max(0, Number(parsed.fiberG)) : undefined,
    sugarG: parsed.sugarG != null ? Math.max(0, Number(parsed.sugarG)) : undefined,
    sodiumMg: parsed.sodiumMg != null ? Math.max(0, Math.round(Number(parsed.sodiumMg))) : undefined,
  };
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
    }, 'foodSaved');
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

