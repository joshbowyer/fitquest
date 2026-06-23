import { describe, it, expect } from 'vitest';
import { calcPlates, formatPlates } from '../lib/plateCalc';

describe('calcPlates', () => {
  describe('metric (kg)', () => {
    it('returns bar-only when target equals bar', () => {
      const r = calcPlates(20, 'METRIC');
      expect(r.plates).toEqual([]);
      expect(r.achieved).toBe(20);
      expect(r.delta).toBe(0);
      expect(r.status).toBe('ok');
      expect(r.unit).toBe('kg');
    });

    it('computes standard 60 kg (20+20)', () => {
      const r = calcPlates(60, 'METRIC');
      expect(r.plates).toEqual([20]);
      expect(r.achieved).toBe(60);
      expect(r.status).toBe('ok');
    });

    it('computes 102.5 kg (greedy: 25+15+1.25 per side)', () => {
      const r = calcPlates(102.5, 'METRIC');
      // 102.5 - 20 = 82.5 / 2 = 41.25 per side
      // greedy: 25 (16.25) → 15 (1.25) → 1.25 (0) = 41.25 ✓
      expect(r.plates).toEqual([25, 15, 1.25]);
      expect(r.achieved).toBe(102.5);
      expect(r.status).toBe('ok');
    });

    it('handles 200 kg (greedy: 25+25+25+15 per side)', () => {
      const r = calcPlates(200, 'METRIC');
      // 200 - 20 = 180 / 2 = 90 per side
      // greedy: 25 (65) → 25 (40) → 25 (15) → 15 (0) = 90 ✓
      expect(r.plates).toEqual([25, 25, 25, 15]);
      expect(r.achieved).toBe(200);
      expect(r.status).toBe('ok');
    });

    it('reports infeasible when target is below bar', () => {
      const r = calcPlates(15, 'METRIC');
      expect(r.plates).toEqual([]);
      expect(r.delta).toBe(-5);
      expect(r.status).toBe('infeasible');
    });

    it('reports infeasible + delta when target needs finer than 1.25 kg', () => {
      const r = calcPlates(22.5, 'METRIC');
      // 22.5 - 20 = 2.5 per side → achievable (1.25 × 2)
      // try 23.0: 3.0 per side, can't make 3.0 with [25,20,15,10,5,2.5,1.25]
      const r2 = calcPlates(23.0, 'METRIC');
      expect(r2.status).toBe('infeasible');
      // best we can do with smallest 1.25 plate: 22.5 → delta -0.5
      // 23 - 22.5 = 0.5
      expect(r2.achieved).toBeCloseTo(22.5, 5);
    });

    it('respects custom bar weight', () => {
      const r = calcPlates(60, 'METRIC', 15);
      // 60 - 15 = 45, /2 = 22.5 per side → 20 + 2.5
      expect(r.plates).toEqual([20, 2.5]);
      expect(r.achieved).toBe(60);
      expect(r.status).toBe('ok');
    });

    it('handles zero target', () => {
      const r = calcPlates(0, 'METRIC');
      expect(r.plates).toEqual([]);
      expect(r.achieved).toBe(0);
      expect(r.status).toBe('infeasible');
    });

    it('handles negative target', () => {
      const r = calcPlates(-5, 'METRIC');
      expect(r.plates).toEqual([]);
      expect(r.status).toBe('infeasible');
    });

    it('handles NaN target', () => {
      const r = calcPlates(NaN, 'METRIC');
      expect(r.plates).toEqual([]);
      expect(r.status).toBe('infeasible');
    });
  });

  describe('imperial (lb)', () => {
    it('returns bar-only for 45 lb', () => {
      const r = calcPlates(45, 'IMPERIAL');
      expect(r.plates).toEqual([]);
      expect(r.achieved).toBe(45);
      expect(r.status).toBe('ok');
    });

    it('computes 135 lb (45 + 45)', () => {
      const r = calcPlates(135, 'IMPERIAL');
      expect(r.plates).toEqual([45]);
      expect(r.achieved).toBe(135);
      expect(r.status).toBe('ok');
    });

    it('computes 225 lb (45+45+45)', () => {
      const r = calcPlates(225, 'IMPERIAL');
      expect(r.plates).toEqual([45, 45]);
      expect(r.achieved).toBe(225);
      expect(r.status).toBe('ok');
    });

    it('computes 405 lb (45+45+45+45)', () => {
      const r = calcPlates(405, 'IMPERIAL');
      expect(r.plates).toEqual([45, 45, 45, 45]);
      expect(r.achieved).toBe(405);
      expect(r.status).toBe('ok');
    });

    it('reports infeasible for 46 lb', () => {
      // 46 - 45 = 1 lb per side; smallest plate is 2.5 lb → infeasible
      const r = calcPlates(46, 'IMPERIAL');
      expect(r.status).toBe('infeasible');
    });
  });
});

describe('formatPlates', () => {
  it('formats an OK result', () => {
    const r = calcPlates(102.5, 'METRIC');
    expect(formatPlates(r)).toBe('25 + 15 + 1.25 kg per side');
  });

  it('formats bar-only', () => {
    const r = calcPlates(20, 'METRIC');
    expect(formatPlates(r)).toBe('bar only (20 kg)');
  });

  it('formats sub-bar infeasible with delta message', () => {
    const r = calcPlates(15, 'METRIC');
    expect(formatPlates(r)).toContain('5.00 kg below bar');
  });
});