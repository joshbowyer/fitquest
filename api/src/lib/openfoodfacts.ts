/**
 * OpenFoodFacts (OFF) client. No API key required.
 *
 * OFF has the biggest global food database. Endpoints:
 *   - GET /api/v2/search?search_terms=...
 *   - GET /api/v2/product/{barcode}.json
 *
 * We only consume a subset of each product's fields — enough to
 * render a search result, log a meal, and link to the full
 * product page for details.
 *
 * Rate limit: ~10 req/sec per IP, no key needed. We cache the
 * results in our own FoodItem table to be safe.
 */

const OFF_BASE = 'https://world.openfoodfacts.org';

export type OffProduct = {
  code: string;
  product_name: string;
  brands: string | null;
  image_front_url: string | null;
  nutriments: {
    'energy-kcal_100g'?: number;
    'proteins_100g'?: number;
    'carbohydrates_100g'?: number;
    'fat_100g'?: number;
    'fiber_100g'?: number;
    'sugars_100g'?: number;
    'sodium_100g'?: number;
  };
};

export type FoodMatch = {
  source: 'OPENFOODFACTS';
  sourceId: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  servingSizeG: number | null;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  sourceUrl: string;
};

/** Convert a raw OFF product into our normalized FoodMatch.
 * Returns null if essential fields (name + calories) are missing. */
export function normalizeOffProduct(p: OffProduct): FoodMatch | null {
  const name = (p.product_name || '').trim();
  if (!name) return null;
  const n = p.nutriments ?? {};
  const cal = n['energy-kcal_100g'];
  if (cal == null) return null;
  return {
    source: 'OPENFOODFACTS',
    sourceId: p.code,
    name,
    brand: p.brands || null,
    imageUrl: p.image_front_url || null,
    servingSizeG: null,
    calories: cal,
    proteinG: n['proteins_100g'] ?? 0,
    carbG: n['carbohydrates_100g'] ?? 0,
    fatG: n['fat_100g'] ?? 0,
    fiberG: n['fiber_100g'] ?? null,
    sugarG: n['sugars_100g'] ?? null,
    // OFF stores sodium in g; convert to mg.
    sodiumMg: n['sodium_100g'] != null ? n['sodium_100g'] * 1000 : null,
    sourceUrl: `https://world.openfoodfacts.org/product/${p.code}`,
  };
}

export async function offSearch(query: string, pageSize = 10): Promise<OffProduct[]> {
  // Use the legacy cgi endpoint — the v2 /api/v2/search endpoint
  // returns a fixed 5 items (looks like a CDN-cached or rate-limited
  // response) regardless of search_terms. The cgi endpoint is the
  // canonical one and returns actual matches.
  const url = new URL('/cgi/search.pl', OFF_BASE);
  url.searchParams.set('search_terms', query);
  url.searchParams.set('search_simple', '1');
  url.searchParams.set('action', 'process');
  url.searchParams.set('json', '1');
  url.searchParams.set('page_size', String(pageSize));
  url.searchParams.set(
    'fields',
    'code,product_name,brands,image_front_url,nutriments',
  );
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FitQuest/1.0 (https://fitquest.local)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data: any = await res.json();
  return Array.isArray(data?.products) ? data.products : [];
}

export async function offBarcode(code: string): Promise<OffProduct | null> {
  const res = await fetch(
    `${OFF_BASE}/api/v2/product/${encodeURIComponent(code)}.json`,
    {
      headers: { 'User-Agent': 'FitQuest/1.0 (https://fitquest.local)' },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) return null;
  const data: any = await res.json();
  if (!data?.product) return null;
  return data.product as OffProduct;
}
