import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { useAuth } from '@/lib/auth';
import { METRICS, METRICS_BY_CATEGORY, type Measurement, type MetricType } from '@/lib/types';
import { displayUnit, displayValue, type UnitSystem } from '@/lib/units';
import { classNames } from '@/lib/format';
import { MetricDetailModal } from '@/components/MetricDetailModal';

// Metrics that are derived from other data and shouldn't be
// user-enterable. LEAN_MASS = weight × (1 - bf%). FFMI is computed
// from LBM and height in the Status panel. SHOULDER_WAIST_RATIO
// is auto-computed from SHOULDER + WAIST. We hide these from the
// tile grid so users don't try to log conflicting values.
const DERIVED_METRICS: MetricType[] = ['LEAN_MASS', 'FFMI', 'SHOULDER_WAIST_RATIO'];

const CATS = Object.keys(METRICS_BY_CATEGORY) as Array<keyof typeof METRICS_BY_CATEGORY>;

// Per-category accent. Matches the /dashboard stat-sheet colour
// scheme so the two surfaces feel like one navigation system.
// Used for the category label + the metric tile borders.
const CAT_ACCENT: Record<string, 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet'> = {
  HYPERTROPHY: 'magenta',
  STRENGTH: 'cyan',
  BODY_COMP: 'lime',
  CARDIO: 'amber',
  CALISTHENICS: 'violet',
  SLEEP: 'cyan',
  NUTRITION: 'lime',
  WELLNESS: 'amber',
};

/**
 * /measurements — flat grid of metric tiles grouped by category.
 *
 * Click a tile → MetricDetailModal opens with the full log +
 * history + override stack (everything the old detail panel
 * used to inline-render). No detail panel below the grid — the
 * modal is the only path for log / history / override actions.
 *
 * The previous version had a 260px sidebar (collapsed categories
 * stacked vertically) + a separate detail panel. The sidebar
 * was awkward on desktop (one category expanded, the rest
 * collapsed but still occupying full height) and the collapsed
 * state wasn't discoverable enough. The flat-grid layout reads
 * cleaner across viewports: every tile is always visible, no
 * "is this collapsed or empty?" ambiguity.
 */
export function MeasurementsPage() {
  const { user } = useAuth();
  const system: UnitSystem = user?.units ?? 'METRIC';

  // Which metric is currently open in the modal. null = closed.
  const [openMetric, setOpenMetric] = useState<MetricType | null>(null);

  // Pull the user's recent measurements so each tile can show
  // its latest value (one-glance summary across all metrics).
  // Single query for all metrics — smaller set than the modal's
  // per-metric 200-row history, polled at the default staleTime.
  const allQ = useQuery({
    queryKey: ['measurements', 'all'],
    queryFn: () => api<{ items: Measurement[] }>('/measurements?limit=200'),
  });

  // Group measurements by metric, keeping only the most-recent
  // one per metric for the tile display.
  const latestByMetric = new Map<MetricType, Measurement>();
  for (const m of allQ.data?.items ?? []) {
    if (!latestByMetric.has(m.metric)) latestByMetric.set(m.metric, m);
  }

  return (
    <Layout>
      <PageHeader
        title="// Measurements"
        subtitle="Pick a metric to log, view history, or override its genetic max."
      />

      {/* Category sections. 2-col on md+, single col on smaller.
          Each section has a header + a wrapping grid of metric
          tiles. Tiles are always visible — no collapsing — so the
          desktop "expanded vs collapsed at full height" weirdness
          from the previous version can't recur. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CATS.map((cat) => {
          const metrics = METRICS_BY_CATEGORY[cat].filter(
            (m) => !DERIVED_METRICS.includes(m),
          );
          const accent = CAT_ACCENT[cat] ?? 'cyan';
          return (
            <div key={cat} className="border border-ink-500/30 bg-bg-800/40 p-3">
              <div className="flex items-baseline justify-between mb-2">
                <span
                  className={classNames(
                    'text-[10px] font-display tracking-widest uppercase',
                    `neon-text-${accent}`,
                  )}
                >
                  {cat.replace('_', ' ')}
                </span>
                <span className="text-[9px] font-mono text-ink-500">
                  {metrics.length} metric{metrics.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {metrics.map((m) => {
                  const meta = METRICS[m];
                  const latest = latestByMetric.get(m);
                  const unitLabel = displayUnit(meta.unit, system);
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setOpenMetric(m)}
                      className={classNames(
                        'group text-left p-2 border bg-bg-700/40 transition-all',
                        `border-ink-500/40 hover:border-neon-${accent}/60 hover:bg-neon-${accent}/10`,
                      )}
                    >
                      <div className={classNames(
                        'font-display tracking-wider text-[11px] uppercase truncate',
                        `group-hover:neon-text-${accent}`,
                      )}>
                        {meta.shortLabel}
                      </div>
                      <div className="text-[10px] font-mono text-ink-500 mt-0.5">
                        {latest ? (
                          <>
                            <span className={`neon-text-${accent}`}>
                              {displayValue(latest.value, meta.unit, system)}
                            </span>
                            {' '}
                            <span className="text-ink-400">{unitLabel}</span>
                          </>
                        ) : (
                          <span className="italic text-ink-500">— {unitLabel}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* The modal owns the entire log + history + override stack.
          No inline detail panel on this page — clicking a tile is
          the only path. Mirrors the dashboard's radial-click
          behaviour, so the two surfaces feel consistent. */}
      <MetricDetailModal
        open={openMetric != null}
        metric={openMetric}
        onClose={() => setOpenMetric(null)}
      />
    </Layout>
  );
}