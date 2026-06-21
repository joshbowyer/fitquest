/**
 * USDA FoodData Central client. Requires the user's API key.
 *
 * Two endpoints we use:
 *   - POST /v1/foods/search   text search, top 10 results
 *   - GET  /v1/food/{fdcId}   details for a single food
 *
 * Rate limit: 1000 req/hour per key. Plenty for a single user.
 */

const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';

export type UsdaFoodNutrient = {
  nutrientId: number;
  nutrientName: string;
  unitName: string;
  value: number;
};

export type UsdaSearchHit = {
  fdcId: number;
  description: string;
  brandName: string | null;
  foodNutrients: UsdaFoodNutrient[];
};

export type FoodMatch = {
  source: 'USDA';
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

// USDA nutrient IDs (per the FDC nutrient list).
// https://fdc.nal.usda.gov/nutrient-list
const NUTRIENT_ID = {
  ENERGY_KCAL: 1008,
  PROTEIN: 1003,
  CARB: 1005,
  FAT: 1004,
  FIBER: 1079,
  SUGAR: 2000,
  SODIUM: 1093,
};

function getNutrient(nutrients: UsdaFoodNutrient[], id: number): number | null {
  for (const n of nutrients) {
    if (n.nutrientId === id && n.value != null) return n.value;
  }
  return null;
}

export function normalizeUsdaFood(f: UsdaSearchHit): FoodMatch | null {
  const name = (f.description || '').trim();
  if (!name) return null;
  const ns = f.foodNutrients ?? [];
  const cal = getNutrient(ns, NUTRIENT_ID.ENERGY_KCAL);
  if (cal == null) return null;
  return {
    source: 'USDA',
    sourceId: String(f.fdcId),
    name,
    brand: f.brandName || null,
    imageUrl: null,
    servingSizeG: null,
    calories: cal,
    proteinG: getNutrient(ns, NUTRIENT_ID.PROTEIN) ?? 0,
    carbG: getNutrient(ns, NUTRIENT_ID.CARB) ?? 0,
    fatG: getNutrient(ns, NUTRIENT_ID.FAT) ?? 0,
    fiberG: getNutrient(ns, NUTRIENT_ID.FIBER),
    sugarG: getNutrient(ns, NUTRIENT_ID.SUGAR),
    sodiumMg: getNutrient(ns, NUTRIENT_ID.SODIUM),
    sourceUrl: `https://fdc.nal.usda.gov/food-search?query=${encodeURIComponent(name)}`,
  };
}

export async function usdaSearch(
  query: string,
  apiKey: string,
  pageSize = 10,
): Promise<UsdaSearchHit[]> {
  if (!apiKey) return [];
  const url = new URL('/v1/foods/search', USDA_BASE);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('query', query);
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('dataType', 'Survey (FNDDS),Foundation,Branded,SR Legacy');
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data: any = await res.json();
  return Array.isArray(data?.foods) ? data.foods : [];
}
