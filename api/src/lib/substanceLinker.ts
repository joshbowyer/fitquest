/**
 * Auto-link substances to a food entry based on its name.
 *
 * The user asked for this as low-hanging-fruit: logging "coffee"
 * should auto-tick the caffeine row, "kombucha" too, wine → alcohol,
 * etc. Saves a tap when the substance is implied by the food itself.
 *
 * Returns 0..N (category, form, amount, unit) tuples. The meal POST
 * handler iterates and posts each as a separate /substances row.
 *
 * Patterns are matched case-insensitively as substrings — the food
 * names are typically short ("Oat Milk Latte", "Stout Beer") so
 * substring matching is fine and avoids the false-positive cost of
 * full regex.
 *
 * The default amount is "1 cup" / "1 drink" / "1 cigarette" — a
 * rough default. The user can edit the row on /today if they want
 * to be more precise.
 */
export type SubstanceLink = {
  category: SubCategory;
  form: string;
  amount: number | null;
  unit: string | null;
};

/** Pattern → link mapping. First match wins per category, so list
 *  specific patterns before general ones ("iced coffee" before
 *  "coffee", "green tea" before "tea"). */
type SubCategory = 'CAFFEINE' | 'ALCOHOL' | 'NICOTINE';
type Pattern = {
  match: string;
  category: SubCategory;
  form: string;
  amount?: number;
  unit?: string;
};

const PATTERNS: Pattern[] = [
  // CAFFEINE — coffee variants
  { match: 'espresso',    category: 'CAFFEINE', form: 'espresso' },
  { match: 'americano',    category: 'CAFFEINE', form: 'coffee' },
  { match: 'cappuccino',  category: 'CAFFEINE', form: 'coffee' },
  { match: 'latte',       category: 'CAFFEINE', form: 'coffee' },
  { match: 'mocha',       category: 'CAFFEINE', form: 'coffee' },
  { match: 'macchiato',   category: 'CAFFEINE', form: 'coffee' },
  { match: 'cold brew',   category: 'CAFFEINE', form: 'coffee' },
  { match: 'cold-brew',   category: 'CAFFEINE', form: 'coffee' },
  { match: 'coffee',      category: 'CAFFEINE', form: 'coffee' },
  // Energy drinks
  { match: 'red bull',    category: 'CAFFEINE', form: 'energy_drink' },
  { match: 'monster',     category: 'CAFFEINE', form: 'energy_drink' },
  { match: 'celsius',     category: 'CAFFEINE', form: 'energy_drink' },
  { match: 'bang',        category: 'CAFFEINE', form: 'energy_drink' },
  { match: 'pre-workout', category: 'CAFFEINE', form: 'pre_workout' },
  { match: 'pre workout', category: 'CAFFEINE', form: 'pre_workout' },
  { match: 'energy drink',category: 'CAFFEINE', form: 'energy_drink' },
  // Tea
  { match: 'matcha',      category: 'CAFFEINE', form: 'tea' },
  { match: 'kombucha',    category: 'CAFFEINE', form: 'kombucha' },
  { match: 'green tea',   category: 'CAFFEINE', form: 'tea' },
  { match: 'black tea',   category: 'CAFFEINE', form: 'tea' },
  { match: 'oolong',      category: 'CAFFEINE', form: 'tea' },
  { match: 'yerba mate',  category: 'CAFFEINE', form: 'tea' },
  { match: 'mate',        category: 'CAFFEINE', form: 'tea' },
  { match: 'tea',         category: 'CAFFEINE', form: 'tea' },
  // Soda (caffeinated brands)
  { match: 'coca-cola',   category: 'CAFFEINE', form: 'soda' },
  { match: 'coke',        category: 'CAFFEINE', form: 'soda' },
  { match: 'pepsi',       category: 'CAFFEINE', form: 'soda' },
  { match: 'dr pepper',   category: 'CAFFEINE', form: 'soda' },
  { match: 'mtn dew',     category: 'CAFFEINE', form: 'soda' },
  { match: 'mountain dew',category: 'CAFFEINE', form: 'soda' },

  // ALCOHOL — beer / cider / seltzer
  { match: 'stout',       category: 'ALCOHOL',  form: 'beer' },
  { match: 'porter',     category: 'ALCOHOL',  form: 'beer' },
  { match: 'ipa',         category: 'ALCOHOL',  form: 'beer' },
  { match: 'lager',       category: 'ALCOHOL',  form: 'beer' },
  { match: 'pilsner',     category: 'ALCOHOL',  form: 'beer' },
  { match: 'pale ale',    category: 'ALCOHOL',  form: 'beer' },
  { match: 'hefeweizen',  category: 'ALCOHOL',  form: 'beer' },
  { match: 'sour',        category: 'ALCOHOL',  form: 'beer' },
  { match: 'cider',       category: 'ALCOHOL',  form: 'cider' },
  { match: 'hard seltzer',category: 'ALCOHOL',  form: 'seltzer' },
  { match: 'truly',       category: 'ALCOHOL',  form: 'seltzer' },
  { match: 'white claw',  category: 'ALCOHOL',  form: 'seltzer' },
  { match: 'michelob',    category: 'ALCOHOL',  form: 'beer' },
  { match: 'budweiser',   category: 'ALCOHOL',  form: 'beer' },
  { match: 'bud light',   category: 'ALCOHOL',  form: 'beer' },
  { match: 'miller',      category: 'ALCOHOL',  form: 'beer' },
  { match: 'coors',       category: 'ALCOHOL',  form: 'beer' },
  { match: 'corona',      category: 'ALCOHOL',  form: 'beer' },
  { match: 'heineken',    category: 'ALCOHOL',  form: 'beer' },
  { match: 'stella',      category: 'ALCOHOL',  form: 'beer' },
  { match: 'modelo',      category: 'ALCOHOL',  form: 'beer' },
  { match: 'pabst',       category: 'ALCOHOL',  form: 'beer' },
  { match: 'beer',        category: 'ALCOHOL',  form: 'beer', amount: 1, unit: 'drink' },
  // Wine
  { match: 'merlot',      category: 'ALCOHOL',  form: 'wine' },
  { match: 'cabernet',    category: 'ALCOHOL',  form: 'wine' },
  { match: 'pinot noir',  category: 'ALCOHOL',  form: 'wine' },
  { match: 'chardonnay',  category: 'ALCOHOL',  form: 'wine' },
  { match: 'sauvignon',   category: 'ALCOHOL',  form: 'wine' },
  { match: 'pinot grigio',category: 'ALCOHOL',  form: 'wine' },
  { match: 'riesling',    category: 'ALCOHOL',  form: 'wine' },
  { match: 'rosé',        category: 'ALCOHOL',  form: 'wine' },
  { match: 'rose',        category: 'ALCOHOL',  form: 'wine' },
  { match: 'prosecco',    category: 'ALCOHOL',  form: 'wine' },
  { match: 'champagne',   category: 'ALCOHOL',  form: 'wine' },
  { match: 'moscato',     category: 'ALCOHOL',  form: 'wine' },
  { match: 'red wine',    category: 'ALCOHOL',  form: 'wine' },
  { match: 'white wine',  category: 'ALCOHOL',  form: 'wine' },
  { match: 'wine',        category: 'ALCOHOL',  form: 'wine', amount: 1, unit: 'glass' },
  // Spirits
  { match: 'bourbon',     category: 'ALCOHOL',  form: 'spirits' },
  { match: 'whiskey',     category: 'ALCOHOL',  form: 'spirits' },
  { match: 'scotch',      category: 'ALCOHOL',  form: 'spirits' },
  { match: 'vodka',       category: 'ALCOHOL',  form: 'spirits' },
  { match: 'gin',         category: 'ALCOHOL',  form: 'spirits' },
  { match: 'rum',         category: 'ALCOHOL',  form: 'spirits' },
  { match: 'tequila',     category: 'ALCOHOL',  form: 'spirits' },
  { match: 'mezcal',      category: 'ALCOHOL',  form: 'spirits' },
  { match: 'brandy',      category: 'ALCOHOL',  form: 'spirits' },
  { match: 'cognac',      category: 'ALCOHOL',  form: 'spirits' },
  { match: 'sake',        category: 'ALCOHOL',  form: 'spirits' },
  { match: 'soju',        category: 'ALCOHOL',  form: 'spirits' },
  { match: 'cocktail',    category: 'ALCOHOL',  form: 'spirits' },
  { match: 'margarita',   category: 'ALCOHOL',  form: 'cocktail' },
  { match: 'old fashion', category: 'ALCOHOL',  form: 'cocktail' },
  { match: 'martini',     category: 'ALCOHOL',  form: 'cocktail' },
  { match: 'negroni',     category: 'ALCOHOL',  form: 'cocktail' },
  { match: 'mojito',      category: 'ALCOHOL',  form: 'cocktail' },
  { match: 'manhattan',   category: 'ALCOHOL',  form: 'cocktail' },
  { match: 'spirit',      category: 'ALCOHOL',  form: 'spirits' },

  // NICOTINE
  { match: 'cigarette',   category: 'NICOTINE', form: 'cigarette' },
  { match: 'cigar',       category: 'NICOTINE', form: 'cigar' },
  { match: 'vape',        category: 'NICOTINE', form: 'vape' },
  { match: 'vaping',      category: 'NICOTINE', form: 'vape' },
  { match: 'juul',        category: 'NICOTINE', form: 'vape' },
  { match: 'pod',         category: 'NICOTINE', form: 'pod' },
  { match: 'pouch',       category: 'NICOTINE', form: 'pouch' },
  { match: 'zyn',         category: 'NICOTINE', form: 'pouch' },
  { match: 'on!',         category: 'NICOTINE', form: 'pouch' },
  { match: 'grizzly',     category: 'NICOTINE', form: 'pouch' },
  { match: 'dip',         category: 'NICOTINE', form: 'chew' },
  { match: 'chew',        category: 'NICOTINE', form: 'chew' },
  { match: 'snus',        category: 'NICOTINE', form: 'pouch' },
  { match: 'hookah',      category: 'NICOTINE', form: 'hookah' },
  { match: 'shisha',      category: 'NICOTINE', form: 'hookah' },
  { match: 'nicotine',    category: 'NICOTINE', form: 'pouch' },
];

/** Compute the substance links implied by a food name. Returns
 *  [] when the name doesn't match any pattern. */
export function inferSubstanceLinks(foodName: string | null | undefined): SubstanceLink[] {
  if (!foodName) return [];
  const n = foodName.toLowerCase();
  const out: SubstanceLink[] = [];
  const seen = new Set<string>(); // dedup by (category, form)
  for (const p of PATTERNS) {
    if (!n.includes(p.match)) continue;
    const k = `${p.category}|${p.form}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      category: p.category,
      form: p.form,
      amount: p.amount ?? null,
      unit: p.unit ?? null,
    });
  }
  return out;
}
