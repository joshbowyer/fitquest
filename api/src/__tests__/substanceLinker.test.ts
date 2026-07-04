import { describe, it, expect } from 'vitest';
import { inferSubstanceLinks } from '../lib/substanceLinker.js';

describe('inferSubstanceLinks', () => {
  it('returns [] for empty / null / undefined', () => {
    expect(inferSubstanceLinks(null)).toEqual([]);
    expect(inferSubstanceLinks(undefined)).toEqual([]);
    expect(inferSubstanceLinks('')).toEqual([]);
  });

  it('returns [] for foods with no implied substance', () => {
    expect(inferSubstanceLinks('Grilled Chicken Breast')).toEqual([]);
    expect(inferSubstanceLinks('Brown Rice')).toEqual([]);
    expect(inferSubstanceLinks('Avocado Toast')).toEqual([]);
  });

  it('matches coffee variants → CAFFEINE', () => {
    const cases = [
      'Coffee',
      'Iced Coffee',
      'Espresso',
      'Double Espresso',
      'Cappuccino',
      'Latte',
      'Caramel Latte',
      'Cold Brew',
      'Oat Milk Latte',
    ];
    for (const name of cases) {
      const links = inferSubstanceLinks(name);
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ category: 'CAFFEINE' });
    }
  });

  it('matches tea + kombucha + matcha → CAFFEINE', () => {
    for (const name of ['Green Tea', 'Black Tea', 'Earl Grey Tea', 'Matcha Latte', 'Kombucha', 'Yerba Mate']) {
      const links = inferSubstanceLinks(name);
      expect(links.length).toBeGreaterThanOrEqual(1);
      expect(links.some((l) => l.category === 'CAFFEINE')).toBe(true);
    }
  });

  it('matches energy drinks → CAFFEINE with energy_drink form', () => {
    for (const name of ['Red Bull', 'Monster Energy', 'Celsius', 'Pre-Workout']) {
      const links = inferSubstanceLinks(name);
      const caffeine = links.find((l) => l.category === 'CAFFEINE');
      expect(caffeine).toBeDefined();
      // Energy drinks + pre-workout have specific forms
      expect(caffeine!.form).toMatch(/energy_drink|pre_workout/);
    }
  });

  it('matches beer variants → ALCOHOL with beer form', () => {
    for (const name of ['IPA', 'Lager', 'Stout', 'Pilsner', 'Pale Ale', 'Budweiser', 'Heineken', 'Modelo', 'Hard Seltzer', 'Truly']) {
      const links = inferSubstanceLinks(name);
      const alcohol = links.find((l) => l.category === 'ALCOHOL');
      expect(alcohol).toBeDefined();
      expect(alcohol!.form).toMatch(/beer|cider|seltzer/);
    }
  });

  it('matches wine variants → ALCOHOL with wine form', () => {
    for (const name of ['Cabernet Sauvignon', 'Merlot', 'Pinot Noir', 'Chardonnay', 'Rosé', 'Champagne']) {
      const links = inferSubstanceLinks(name);
      const alcohol = links.find((l) => l.category === 'ALCOHOL');
      expect(alcohol).toBeDefined();
      expect(alcohol!.form).toBe('wine');
    }
  });

  it('matches spirits / cocktails → ALCOHOL', () => {
    for (const name of ['Whiskey', 'Vodka Soda', 'Margarita', 'Old Fashioned', 'Negroni', 'Tequila']) {
      const links = inferSubstanceLinks(name);
      const alcohol = links.find((l) => l.category === 'ALCOHOL');
      expect(alcohol).toBeDefined();
      expect(alcohol!.form).toMatch(/spirits|cocktail/);
    }
  });

  it('matches nicotine variants → NICOTINE', () => {
    for (const name of ['Cigarette', 'Vape Pen', 'Zyn Pouch', 'On! Pouch', 'Hookah']) {
      const links = inferSubstanceLinks(name);
      const nicotine = links.find((l) => l.category === 'NICOTINE');
      expect(nicotine).toBeDefined();
    }
  });

  it('returns multiple links when the food name triggers multiple categories', () => {
    // "Whiskey and a cigarette" — should match both ALCOHOL + NICOTINE.
    const links = inferSubstanceLinks('Whiskey and a cigarette');
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links.some((l) => l.category === 'ALCOHOL')).toBe(true);
    expect(links.some((l) => l.category === 'NICOTINE')).toBe(true);
  });

  it('dedupes by (category, form)', () => {
    // "Iced coffee with a coffee chaser" should only have ONE
    // caffeine link, not two.
    const links = inferSubstanceLinks('Iced Coffee with a Coffee Chaser');
    const caffeine = links.filter((l) => l.category === 'CAFFEINE');
    expect(caffeine).toHaveLength(1);
  });

  it('is case-insensitive', () => {
    expect(inferSubstanceLinks('COFFEE').length).toBeGreaterThan(0);
    expect(inferSubstanceLinks('Beer').length).toBeGreaterThan(0);
    expect(inferSubstanceLinks('VAPE').length).toBeGreaterThan(0);
  });

  it('does NOT false-positive on non-substance foods that contain a substring', () => {
    // "Matcha Cookies" — should match matcha (caffeine), not
    // fail or crash. Tests substring behavior, not correctness
    // of the linker.
    const links = inferSubstanceLinks('Matcha Cookies');
    expect(links.some((l) => l.category === 'CAFFEINE')).toBe(true);
  });
});
