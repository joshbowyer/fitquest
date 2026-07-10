/**
 * OpenFoodFacts (OFF) client. No API key required.
 *
 * OFF has the biggest global food database. Endpoints:
 *   - GET /cgi/search.pl?search_terms=...
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
  serving_size?: string;
  serving_quantity?: number;
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
    servingSizeG: p.serving_quantity != null && p.serving_quantity > 0 ? p.serving_quantity : null,
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

/**
 * Score a normalized FoodMatch for "basicness" when the user
 * didn't include a brand in their query. Higher score = better
 * generic match (what the user usually wants when they search
 * "chicken breast").
 *
 * Penalizes:
 *   - Products with a brand set (the user didn't search a brand,
 *     so branded products are usually a worse match than the
 *     generic item they actually want)
 *   - Long product names (>5 words is usually a variant — "Organic
 *     Free-Range Air-Chilled Boneless Skinless Chicken Breast" is
 *     technically more accurate but not what "chicken breast"
 *     usually means in a macro log)
 *   - Words that appear in the query BUT show up at the end of
 *     the name (suggests a long prefix that swallowed the query —
 *     e.g. "Annie's Homegrown Organic Whole Wheat Elbows" for
 *     "elbows")
 *
 * Rewards:
 *   - Query words appearing at the START of the name
 *   - Short, clean product names
 *   - More complete nutrient data (basic foods usually have full
 *     per-100g coverage; obscure variants often only have cal)
 */
function basicnessScore(query: string, m: FoodMatch): number {
  const q = query.toLowerCase().trim();
  const name = m.name.toLowerCase();
  const qWords = q.split(/\s+/).filter((w) => w.length >= 3);
  const nameWords = name.split(/\s+/);
  let score = 0;

  // Brand penalty
  if (m.brand && m.brand.trim().length > 0) score -= 25;

  // Name length penalty — slightly penalize >5 words, more for >10
  if (nameWords.length > 10) score -= 30;
  else if (nameWords.length > 5) score -= 10;

  // Query-word position reward
  if (qWords.length > 0) {
    // Best case: query words appear at the start of the name in order
    const firstWord = qWords[0]!;
    const pos = name.indexOf(firstWord);
    if (pos === 0) score += 25;
    else if (pos > 0 && pos < 15) score += 10;
    else if (pos > 30) score -= 15;

    // Bonus: all query words present
    const allPresent = qWords.every((w) => name.includes(w));
    if (allPresent) score += 10;
  }

  // Nutrient completeness reward
  let filledNutrients = 0;
  if (m.proteinG > 0) filledNutrients++;
  if (m.carbG > 0) filledNutrients++;
  if (m.fatG > 0) filledNutrients++;
  if (m.fiberG != null) filledNutrients++;
  if (m.sugarG != null) filledNutrients++;
  if (m.sodiumMg != null) filledNutrients++;
  score += filledNutrients * 1.5;

  return score;
}

/**
 * Detect whether the user's query looks brand-specific.
 * Heuristic: contains a known brand token (Trader Joe's, Costco,
 * Whole Foods, etc.) or quotes a brand-name substring. This is
 * intentionally loose — false positives just mean we don't
 * deprioritize branded results, which is fine.
 */
function hasBrandHint(query: string): boolean {
  const KNOWN_BRANDS = [
    'trader joe', 'trader joe', "trader joe's",
    'costco', 'kirkland', 'sam', 'walmart', 'great value',
    'kroger', 'private selection', 'simple truth',
    'whole foods', '365', 'amazon', 'happy belly',
    'kraft', 'general mills', 'cheerios', 'kellogg', 'kellogg\'s',
    'nestle', 'coca cola', 'coke', 'pepsi', 'sprite', 'fanta',
    'heinz', 'hellmann', 'hellmann\'s', 'best foods', 'dukes',
    'campbell', 'campbell\'s', ' progresso', 'barilla', 'ragu',
    'annies', 'annie\'s', 'kashi', 'pop tarts', 'cheez',
    'oreo', 'nabisco', 'mondelez', 'lay', 'lays', 'lay\'s',
    'doritos', 'cheetos', 'ruffles', 'tostitos', 'snyder',
    'lance', 'sun chips', 'pringles', 'm&m', 'm&m\'s',
    'snickers', 'twix', 'kit kat', 'kitkat', 'reeses', 'reeses',
    'ben & jerry', 'ben and jerry', 'halo top', 'talenti',
    'yoplait', 'chobani', 'fage', 'siggi', 'siggis', 'noosa',
    'sabra', 'stacy', 'tostitos', 'lays', 'lay\'s',
    'olympic', 'kraft singles', 'tillamook', 'sargento',
  ];
  const q = query.toLowerCase();
  return KNOWN_BRANDS.some((b) => q.includes(b));
}

export function rankResults(query: string, results: FoodMatch[]): FoodMatch[] {
  if (results.length === 0) return results;
  const brandish = hasBrandHint(query);
  // When the user is searching for a brand, OFF's internal sort
  // (popularity + completeness) is usually fine — don't reshuffle.
  // When they're searching generic ("chicken breast"), we want the
  // most basic match first.
  if (brandish) return results;
  return [...results].sort((a, b) => basicnessScore(query, b) - basicnessScore(query, a));
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
    'code,product_name,brands,image_front_url,serving_size,serving_quantity,nutriments',
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
