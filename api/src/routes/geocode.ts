import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/auth.js';

/**
 * GET /geocode?q=<city or postal code>
 *
 * Thin proxy around Open-Meteo's free Geocoding API
 * (https://geocoding-api.open-meteo.com/v1/search). No API key
 * required.
 *
 * Why a server proxy instead of a direct browser fetch:
 *   1. Keeps the upstream URL out of the client bundle.
 *   2. Centralizes the User-Agent + future rate-limit logic.
 *   3. Returns a trimmed response shape so the client only sees
 *      the fields Profile actually uses.
 *   4. Lets us short-circuit empty / overly-short queries
 *      before burning an upstream request.
 *
 * Docs: https://open-meteo.com/en/docs/geocoding-api
 *   The endpoint returns up to 100 results, fuzzy-matching for
 *   3+ char queries and exact-matching for 2-char queries.
 *   We default to 8 results — enough to populate a useful
 *   picker without overwhelming the user.
 */

const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

export async function geocodeRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; count?: string } }>('/', async (req) => {
    await requireUser(req);
    const q = (req.query.q ?? '').trim();
    const count = Math.max(1, Math.min(20, Number(req.query.count) || 8));
    if (q.length < 2) return { results: [] };

    const params = new URLSearchParams({ name: q, count: String(count), language: 'en', format: 'json' });
    const url = `${ENDPOINT}?${params.toString()}`;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'FitQuest/1.0 (+https://github.com/joshbowyer/fitquest)',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { results: [] };
      const raw: any = await res.json();
      const results = Array.isArray(raw?.results) ? raw.results : [];
      // Trim the shape so the client only sees the fields it uses.
      return {
        results: results.map((r: any) => ({
          id: r.id,
          name: r.name,
          latitude: r.latitude,
          longitude: r.longitude,
          country: r.country,
          country_code: r.country_code,
          admin1: r.admin1,
          admin2: r.admin2,
          admin3: r.admin3,
          admin4: r.admin4,
          timezone: r.timezone,
          population: r.population,
          feature_code: r.feature_code,
        })),
      };
    } catch {
      return { results: [] };
    }
  });
}