/**
 * Tests for the new insight rules in api/src/lib/insights.ts:
 *   - plateau_detected: calls detectPlateaus and surfaces the top one
 *   - water_low_recent: surfaces a hydration gap when WATER_ML not logged in 3+ days
 *   - sleep_recovery_mismatch: sleep OK, recovery low → surface non-sleep drag
 *
 * Each test is offline (no DB) by mocking the heavy imported helpers
 * (computeRecovery, computeCorrelations, detectPlateaus) so the
 * insight-rule logic can be verified without a Postgres instance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the heavy DB-driven helpers before importing insights.ts.
// We need to be careful: the import path is '../lib/recovery.js' /
// '../lib/correlations.js' / '../lib/plateau.js' from the
// insights module's perspective, so the relative paths in the
// mock must match.
vi.mock('../lib/recovery.js', () => ({
  computeRecovery: vi.fn(),
}));
vi.mock('../lib/correlations.js', () => ({
  computeCorrelations: vi.fn(),
}));
vi.mock('../lib/plateau.js', () => ({
  detectPlateaus: vi.fn(),
}));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    measurement: { findFirst: vi.fn() },
  },
}));

import { generateInsights } from '../lib/insights.js';
import { computeRecovery } from '../lib/recovery.js';
import { computeCorrelations } from '../lib/correlations.js';
import { detectPlateaus } from '../lib/plateau.js';

const mockRecovery = computeRecovery as unknown as ReturnType<typeof vi.fn>;
const mockCorrelations = computeCorrelations as unknown as ReturnType<typeof vi.fn>;
const mockDetectPlateaus = detectPlateaus as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('plateau_detected', () => {
  it('surfaces the most actionable plateau (scold first)', async () => {
    mockRecovery.mockResolvedValue({ score: 75, components: [], dataPoints: 5, totalMetrics: 7, trend: 80, date: '2026-06-28' });
    mockCorrelations.mockResolvedValue([]);
    mockDetectPlateaus.mockResolvedValue([
      { kind: 'VOLUME_REGRESSION', label: 'Volume', severity: 'warn', note: 'Weekly volume dropped 30% vs 28d baseline.' },
      { kind: 'NO_PR_RECENT', label: 'No PR in 45d', severity: 'scold', note: 'No PR in 45 days — the goal is at risk.' },
    ]);

    const tips = await generateInsights('user-1');
    const plateau = tips.find((t) => t.type === 'plateau_detected');
    expect(plateau).toBeDefined();
    expect(plateau!.title).toBe('No PR in 45d');
    expect(plateau!.severity).toBe('warning');
    expect(plateau!.message).toContain('45 days');
  });

  it('omits plateau rule when no plateaus detected', async () => {
    mockRecovery.mockResolvedValue({ score: 80, components: [], dataPoints: 7, totalMetrics: 7, trend: 82, date: '2026-06-28' });
    mockCorrelations.mockResolvedValue([]);
    mockDetectPlateaus.mockResolvedValue([]);

    const tips = await generateInsights('user-1');
    expect(tips.find((t) => t.type === 'plateau_detected')).toBeUndefined();
  });
});

describe('water_low_recent', () => {
  it('fires at 3+ days gap, warn severity at 7+', async () => {
    mockRecovery.mockResolvedValue({ score: 75, components: [], dataPoints: 5, totalMetrics: 7, trend: 80, date: '2026-06-28' });
    mockCorrelations.mockResolvedValue([]);
    mockDetectPlateaus.mockResolvedValue([]);

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const { prisma } = await import('../lib/prisma.js');
    (prisma.measurement.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ recordedAt: fiveDaysAgo });

    const tips = await generateInsights('user-1');
    const water = tips.find((t) => t.type === 'water_low_recent');
    expect(water).toBeDefined();
    expect(water!.severity).toBe('info');
    expect(water!.message).toContain('5 days');
  });

  it('warns at 7+ days', async () => {
    mockRecovery.mockResolvedValue({ score: 75, components: [], dataPoints: 5, totalMetrics: 7, trend: 80, date: '2026-06-28' });
    mockCorrelations.mockResolvedValue([]);
    mockDetectPlateaus.mockResolvedValue([]);

    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const { prisma } = await import('../lib/prisma.js');
    (prisma.measurement.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ recordedAt: tenDaysAgo });

    const tips = await generateInsights('user-1');
    const water = tips.find((t) => t.type === 'water_low_recent');
    expect(water!.severity).toBe('warning');
    expect(water!.message).toContain('10 days');
  });

  it('omits when water is logged recently', async () => {
    mockRecovery.mockResolvedValue({ score: 75, components: [], dataPoints: 5, totalMetrics: 7, trend: 80, date: '2026-06-28' });
    mockCorrelations.mockResolvedValue([]);
    mockDetectPlateaus.mockResolvedValue([]);

    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const { prisma } = await import('../lib/prisma.js');
    (prisma.measurement.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ recordedAt: oneDayAgo });

    const tips = await generateInsights('user-1');
    expect(tips.find((t) => t.type === 'water_low_recent')).toBeUndefined();
  });
});

describe('sleep_recovery_mismatch', () => {
  it('fires when sleep is fine but recovery is low', async () => {
    // sleep subscore = 85 (good); other component = stress 30 (bad)
    mockRecovery.mockResolvedValue({
      score: 42, // below 50 → recovery_low also fires, that's fine
      components: [
        { metric: 'SLEEP_HOURS', rawValue: 7.5, subscore: 85, weight: 0.2, contribution: 17, reason: '7.5h sleep', available: true },
        { metric: 'STRESS', rawValue: 7, subscore: 30, weight: 0.1, contribution: 3, reason: 'Stress level 7/10', available: true },
      ],
      dataPoints: 2,
      totalMetrics: 2,
      trend: null,
      date: '2026-06-28',
    });
    mockCorrelations.mockResolvedValue([]);
    mockDetectPlateaus.mockResolvedValue([]);
    const { prisma } = await import('../lib/prisma.js');
    (prisma.measurement.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const tips = await generateInsights('user-1');
    const mismatch = tips.find((t) => t.type === 'sleep_recovery_mismatch');
    expect(mismatch).toBeDefined();
    expect(mismatch!.title).toContain('Sleep OK');
    expect(mismatch!.message).toContain('Stress');
    expect(mismatch!.message).toContain('30/100');
  });

  it('omits when sleep is also the weak link', async () => {
    // sleep = 30, stress = 40 → sleep is the worst, mismatch rule should NOT fire
    mockRecovery.mockResolvedValue({
      score: 35,
      components: [
        { metric: 'SLEEP_HOURS', rawValue: 4, subscore: 30, weight: 0.2, contribution: 6, reason: '4h sleep', available: true },
        { metric: 'STRESS', rawValue: 6, subscore: 40, weight: 0.1, contribution: 4, reason: 'Stress 6', available: true },
      ],
      dataPoints: 2,
      totalMetrics: 2,
      trend: null,
      date: '2026-06-28',
    });
    mockCorrelations.mockResolvedValue([]);
    mockDetectPlateaus.mockResolvedValue([]);
    const { prisma } = await import('../lib/prisma.js');
    (prisma.measurement.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const tips = await generateInsights('user-1');
    expect(tips.find((t) => t.type === 'sleep_recovery_mismatch')).toBeUndefined();
  });
});
