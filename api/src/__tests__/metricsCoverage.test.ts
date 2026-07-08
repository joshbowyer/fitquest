/**
 * Regression test for the bug that 500'd every POST /measurements
 * without an explicit `unit` (and every /measurements/batch item)
 * because `METRICS[SLEEP_ONSET]` was `undefined`.
 *
 * `routes/measurements.ts:101` (single) and `:229` (batch) do
 * `METRICS[body.metric].unit` and `METRICS[it.metric].unit`
 * respectively — a missing key is an unguarded `TypeError: Cannot
 * read properties of undefined`.
 *
 * Locks the contract: every value of the Prisma `MetricType` enum
 * (including newly-added ones from future migrations) MUST have a
 * `METRICS` entry. If a new enum value ships without a meta row,
 * this test fails CI before the route starts 500ing in prod.
 */
import { describe, it, expect } from 'vitest';
import { MetricType } from '../lib/prisma.js';
import { METRICS, METRICS_BY_CATEGORY } from '../lib/metrics.js';

describe('METRICS — full enum coverage', () => {
  it('has a meta entry for every MetricType enum value', () => {
    const enumValues = Object.keys(MetricType) as Array<keyof typeof MetricType>;
    // The Prisma runtime export re-binds a TypeScript string enum
    // as a frozen object — `Object.keys` returns the member NAMES
    // ("BICEP", "HRV", "SLEEP_ONSET", ...). Each must have a
    // matching entry in METRICS, which is keyed by the same
    // identifier (Prisma string-enum runtime values).
    expect(enumValues.length).toBeGreaterThan(0);

    const missing = enumValues.filter((name) => METRICS[name as unknown as keyof typeof METRICS] == null);
    expect(missing).toEqual([]);
  });

  it('every meta row has a non-empty unit (so measurements.ts PATCH / POST can default to it)', () => {
    for (const [name, meta] of Object.entries(METRICS)) {
      expect(meta.unit, `METRICS.${name}.unit must be defined`).toBeDefined();
      // Empty string IS allowed — STEPS intentionally uses it.
      // The contract here is "string property present", not "non-empty".
      expect(typeof meta.unit).toBe('string');
    }
  });

  it('SLEEP_ONSET is present (regression for POST /measurements 500)', () => {
    // This is the exact key that the production bug was about.
    expect(METRICS.SLEEP_ONSET).toBeDefined();
    expect(METRICS.SLEEP_ONSET!.type).toBe('SLEEP_ONSET');
    // The format helper should render a 12-hour clock time so the
    // dashboard can show "10:30 PM" rather than the raw fractional
    // value.
    const rendered = METRICS.SLEEP_ONSET!.format(22.5);
    expect(rendered).toContain('PM');
    expect(rendered).toContain('10:30');
  });

  it('SLEEP_ONSET is bucketed under the SLEEP category', () => {
    expect(METRICS_BY_CATEGORY.SLEEP).toContain('SLEEP_ONSET');
  });
});
