import { describe, it, expect } from 'vitest';
import { METRICS } from '../lib/metrics.js';

/**
 * Locks the gauge-floor `defaultMin` values so a future change can't
 * silently push them back into "child-sized" or "elite-only" territory.
 * The web dashboard reads these and shows them as the gauge minimum
 * (in the user's display unit). Values are tuned for adult-male
 * baseline; females / other frames can override per-metric in the UI.
 *
 * If a value changes on purpose, update the assertion AND the
 * roadmap item that triggered the audit.
 */
describe('METRICS.defaultMin — gauge floor sanity', () => {
  it('SHOULDER floor is realistic adult-male circumference (>=35in / ~89cm)', () => {
    expect(METRICS.SHOULDER.defaultMin).toBe(89);
  });

  it('CALF floor accommodates slim adult-male builds (~12in / ~30cm)', () => {
    expect(METRICS.CALF.defaultMin).toBe(30);
  });

  it('FFMI floor matches sedentary adult-male (~15)', () => {
    expect(METRICS.FFMI.defaultMin).toBe(15);
  });

  it('5K time floor is ~15min (900s), not 25min', () => {
    expect(METRICS.FIVE_K_TIME.defaultMin).toBe(900);
  });

  it('1-mile time floor is ~4min (240s), not 6min', () => {
    expect(METRICS.ONE_MILE_TIME.defaultMin).toBe(240);
  });

  it('SHOULDER is labeled circumference (not biacromial breadth)', () => {
    expect(METRICS.SHOULDER.label.toLowerCase()).toContain('circumference');
  });
});