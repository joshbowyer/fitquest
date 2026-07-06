import { describe, expect, it } from 'vitest';
import { computeBodyfat, jacksonPollock3, navyTape } from '../lib/bodyfat';

describe('bodyfat formulas', () => {
  describe('jacksonPollock3', () => {
    it('returns a sensible BF% for a typical untrained male', () => {
      // 30yo man, sum of 3 skinfolds = 36mm (chest 10 + abdomen 14 + thigh 12).
      // Expected BD ≈ 1.075 → BF ≈ 11%. Tolerance is loose because
      // formulas differ slightly across sources.
      const bf = jacksonPollock3('MALE', [10, 14, 12], 30);
      expect(bf).toBeGreaterThan(5);
      expect(bf).toBeLessThan(20);
    });

    it('returns a sensible BF% for a typical female', () => {
      // 28yo woman, sum of 3 skinfolds = 60mm (triceps 18 + suprailium 20 + thigh 22).
      const bf = jacksonPollock3('FEMALE', [18, 20, 22], 28);
      expect(bf).toBeGreaterThan(15);
      expect(bf).toBeLessThan(35);
    });

    it('falls back to male formula for OTHER', () => {
      const male = jacksonPollock3('MALE', [10, 14, 12], 30);
      const other = jacksonPollock3('OTHER', [10, 14, 12], 30);
      expect(other).toBeCloseTo(male, 5);
    });

    it('clamps to 2% when skinfolds are zero (anatomically empty)', () => {
      // Sum = 0mm → body density > 1.2 → negative BF% → clamp to 2.
      expect(jacksonPollock3('MALE', [0, 0, 0], 25)).toBe(2);
    });
  });

  describe('navyTape', () => {
    it('returns a sensible BF% for a male lifter', () => {
      // 180cm tall, waist 84cm, neck 40cm. (waist-neck=44, log10≈1.643)
      // BD: 86.010×1.643 − 70.041×log10(180) + 36.76
      //   = 141.31 − 70.041×2.255 + 36.76
      //   ≈ 20.1%
      const bf = navyTape('MALE', 84, 40, 180);
      expect(bf).not.toBeNull();
      expect(bf!).toBeGreaterThan(15);
      expect(bf!).toBeLessThan(25);
    });

    it('returns null when waist ≤ neck for men (impossible)', () => {
      expect(navyTape('MALE', 35, 40, 175)).toBeNull();
    });

    it('returns null when hip is missing for women', () => {
      expect(navyTape('FEMALE', 70, 30, 165)).toBeNull();
    });

    it('returns null when waist + hip ≤ neck for women (impossible)', () => {
      // waist(30) + hip(20) - neck(35) = 15 → still positive so valid.
      // To make it impossible: waist+hip must be ≤ neck, so set
      // waist=10, hip=20, neck=35 → 10+20-35 = -5 → null.
      expect(navyTape('FEMALE', 10, 35, 165, 20)).toBeNull();
    });

    it('handles NaN inputs gracefully', () => {
      expect(navyTape('MALE', NaN, 40, 180)).toBeNull();
      expect(navyTape('MALE', 80, NaN, 180)).toBeNull();
      expect(navyTape('MALE', 80, 40, NaN)).toBeNull();
    });
  });

  describe('computeBodyfat dispatcher', () => {
    it('passes through DEXA/BIA direct values', () => {
      const r = computeBodyfat({ method: 'DEXA', bfPct: 14.5 });
      expect(r.method).toBe('DEXA');
      expect(r.bfPct).toBe(14.5);
    });

    it('clamps DEXA values to 2-60%', () => {
      expect(computeBodyfat({ method: 'BIA', bfPct: 0 }).bfPct).toBe(2);
      expect(computeBodyfat({ method: 'BIA', bfPct: 100 }).bfPct).toBe(60);
    });

    it('routes CALIPERS_3 through jacksonPollock3', () => {
      const direct = jacksonPollock3('MALE', [10, 14, 12], 30);
      const via = computeBodyfat({
        method: 'CALIPERS_3',
        sex: 'MALE',
        skinfoldsMm: [10, 14, 12],
        ageYears: 30,
      });
      expect(via.bfPct).toBe(direct);
    });

    it('routes NAVY through navyTape', () => {
      const r = computeBodyfat({
        method: 'NAVY',
        sex: 'MALE',
        waistCm: 84,
        neckCm: 40,
        heightCm: 180,
      });
      expect(r.method).toBe('NAVY');
      expect(r.bfPct).toBeGreaterThan(15);
    });

    it('returns NaN for impossible NAVY inputs (caller UI shows error)', () => {
      const r = computeBodyfat({
        method: 'NAVY',
        sex: 'MALE',
        waistCm: 30,
        neckCm: 40,
        heightCm: 180,
      });
      expect(Number.isNaN(r.bfPct)).toBe(true);
    });
  });
});