import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FoodSource, MealType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { callLlm, type LlmConfig } from '../lib/llm.js';
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

Critical: OpenFoodFacts is a French-origin database with thousands of generic products. It matches poorly on long queries or modifiers. Strip descriptors that don't change the food identity:

  BAD:  "fried boneless chicken breast about the size and thickness of my hand"
  GOOD: "chicken breast"

  BAD:  "the coffee I had this morning, oat milk, no sugar"
  GOOD: "coffee"

  BAD:  "6 large strawberries"
  GOOD: "strawberries"

Rules:
- Output strict JSON, no prose, no markdown fences.
- The query should be 1-3 keywords: just the food's identity.
- Drop cooking methods (fried, baked, grilled, raw, steamed).
- Drop qualifiers (boneless, skinless, large, organic).
- Drop sizing/packaging hints ("about the size of my hand", "6 of them") — the user will set portion size after finding the food.
- Do not invent brand names.
- If the description is too vague to search (e.g. "food"), return { "query": null, "reason": "..." }.

Schema:
{
  "query": "1-3 keyword search string OR null",
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
    const cfg = await prisma.llmConfig.findFirst();
    if (!cfg || !cfg.enabled) {
      return reply.code(422).send({
        error: 'LLM not configured. Add an LLM provider in /admin to use Ask AI.',
      });
    }
    const config: LlmConfig = {
      provider: cfg.provider as LlmConfig['provider'],
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      enabled: cfg.enabled,
      systemPrompt: cfg.systemPrompt,
    };
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
