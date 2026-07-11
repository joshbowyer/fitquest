import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { OverlayTrendChart } from '@/components/OverlayTrendChart';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { convertForDisplay, formatInUnits } from '@/lib/units';
import { classNames } from '@/lib/format';
import { METRICS, type MetricType } from '@/lib/types';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
type Window = 30 | 90 | 180 | 365;

const WINDOWS: Array<{ days: Window; label: string }> = [
  { days: 30,  label: '30 d' },
  { days: 90,  label: '90 d' },
  { days: 180, label: '6 mo' },
  { days: 365, label: '1 yr' },
];

/// Body-comp metrics grouped by chart for visual clarity. Lean mass
/// is computed client-side from WEIGHT × (1 - BF%) so we don't store
/// a separate row.
const WEIGHT_GROUP: Array<{
  metric: MetricType;
  color: string;
  label: string;
  unit: 'kg' | '%';
  derived?: 'lean';
}> = [
  { metric: 'WEIGHT',        color: '#14d6e8', label: 'Weight',    unit: 'kg' },
  { metric: 'LEAN_MASS',     color: '#9bff5c', label: 'Lean mass', unit: 'kg', derived: 'lean' },
  { metric: 'BODY_FAT_PCT',  color: '#ffc34d', label: 'Body fat',  unit: '%'  },
];

const CIRCUMFERENCE_GROUP: Array<{
  metric: MetricType;
  color: string;
  label: string;
  yAxis: 'left' | 'right';
}> = [
  { metric: 'WAIST',          color: '#ff5cff', label: 'Waist',       yAxis: 'left'  },
  { metric: 'CHEST',          color: '#14d6e8', label: 'Chest',       yAxis: 'right' },
  { metric: 'NECK',           color: '#9bff5c', label: 'Neck',        yAxis: 'right' },
  { metric: 'SHOULDER',       color: '#ffc34d', label: 'Shoulder',    yAxis: 'right' },
  // Bicep split into flexed + relaxed after 2026-07-06. Both
  // share the right Y axis but get distinct colors so the user
  // can see them diverge (relaxed rises slower; flexed has pump
  // spikes).
  { metric: 'BICEP_FLEXED',   color: '#ff8c00', label: 'Bicep (F)',   yAxis: 'right' },
  { metric: 'BICEP_RELAXED',  color: '#ffa64d', label: 'Bicep (R)',   yAxis: 'right' },
  { metric: 'FOREARM',        color: '#8b9eff', label: 'Forearm',     yAxis: 'right' },
  { metric: 'QUAD',           color: '#ff2bd6', label: 'Quad',        yAxis: 'right' },
  { metric: 'CALF',           color: '#daa520', label: 'Calf',        yAxis: 'right' },
];

/**
 * Body composition timeline + per-metric insight cards.
 *
 * Charts:
 *   1. Weight + lean mass + body fat % (single Y axis in kg/% dual)
 *   2. Circumference group (waist on one side, muscle groups on the
 *      other so the V-taper direction reads at a glance)
 *
 * Cards (below the charts):
 *   - One per tracked metric, with current value, 7/30/90-day delta,
 *     and a 90-day sparkline. Clicking a card opens the metric detail
 *     modal (reusing MetricDetailModal).
 *
 * Creatine correction: when `User.creatine` is true, we subtract 1.5 kg
 * from the derived lean mass so the line reflects contractile tissue,
 * not intracellular water. This was a known UX issue: creatine users
 * saw lean mass flatline or even rise during a cut, which read as
 * "gaining muscle while losing weight" when actually the intracellular
 * water was masking the real tissue change.
 */
export function BodyCompPage() {
  const { user } = useAuth();
  const units = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';
  const qc = useQueryClient();
  const [win, setWin] = useState<Window>(90);

  // Pull-to-refresh: invalidate the body-comp window query so the
  // user can drag from the top to reload charts + cards after a
  // fresh measurement entry. Single query key (scoped by window),
  // so invalidate that one prefix.
  const { pulledPx, refreshing } = usePullToRefresh<HTMLDivElement>({
    scrollSelector: 'main',
    onRefresh: () => {
      // The body-comp query key is ['body-comp', win, allMetrics.join(',')]
      // — invalidate the ['body-comp'] prefix so whichever window
      // is active re-fetches. The underlying /measurements query
      // is bundled into a single useQuery call here, so we only
      // need to hit that one cache entry.
      qc.invalidateQueries({ queryKey: ['body-comp'] });
    },
  });

  // Fetch the union of all body-comp metrics in a single query.
  // The /measurements endpoint supports `metric` filter, but doing
  // one query per metric is N round-trips. A single wide query is
  // simpler and the result set is small (one row per metric per day).
  const allMetrics: MetricType[] = useMemo(
    () => [...WEIGHT_GROUP, ...CIRCUMFERENCE_GROUP].map((g) => g.metric),
    [],
  );
  const queries = useQuery({
    queryKey: ['body-comp', win, allMetrics.join(',')],
    queryFn: async () => {
      // Fetch each metric in parallel. Each call is small.
      const lists = await Promise.all(
        allMetrics.map((m) =>
          api<{ items: Array<{ metric: string; value: number; recordedAt: string; unit: string }> }>(
            `/measurements?metric=${m}&days=${win}&limit=500`,
          ).then((r) => r.items).catch(() => []),
        ),
      );
      // Flatten for the chart, which expects a single array of
      // { recordedAt, metric, value }.
      const out: Array<{ recordedAt: string; metric: string; value: number; unit: string }> = [];
      for (const list of lists) for (const it of list) out.push(it);
      return out;
    },
  });

  const history = queries.data ?? [];

  // For the lean-mass derivation: stitch WEIGHT + BODY_FAT_PCT rows
  // by date so each day's lean mass = weight × (1 - bf/100).
  const leanMassHistory = useMemo(() => {
    if (!user?.creatine) return [];
    const byDate: Record<string, { weight: number | null; bf: number | null }> = {};
    for (const h of history) {
      const key = h.recordedAt.slice(0, 10);
      if (!byDate[key]) byDate[key] = { weight: null, bf: null };
      if (h.metric === 'WEIGHT') byDate[key].weight = h.value;
      if (h.metric === 'BODY_FAT_PCT') byDate[key].bf = h.value;
    }
    const out: Array<{ recordedAt: string; metric: string; value: number; unit: string }> = [];
    for (const [date, { weight, bf }] of Object.entries(byDate)) {
      if (weight != null && bf != null && bf > 0) {
        // Creatine correction: intracellular water adds ~1.5 kg to
        // total scale weight that shows up in lean mass. Subtract it
        // so the lean-mass line reflects contractile tissue.
        const CREATINE_WATER_KG = 1.5;
        const lm = weight * (1 - bf / 100) - (user.creatine ? CREATINE_WATER_KG : 0);
        out.push({
          recordedAt: `${date}T12:00:00.000Z`,
          metric: 'LEAN_MASS',
          value: lm,
          unit: 'kg',
        });
      }
    }
    return out;
  }, [history, user?.creatine]);

  // Combined history (raw + derived) for the chart series.
  const combinedHistory = useMemo(
    () => [...history, ...leanMassHistory],
    [history, leanMassHistory],
  );

  // Count circumference rows in the window so we can show an
  // empty-state message when there's nothing to plot.
  const circumferenceDataCount = useMemo(
    () => history.filter((h) => CIRCUMFERENCE_GROUP.some((g) => g.metric === h.metric)).length,
    [history],
  );

  // Per-metric "current" values for the cards below.
  const latestByMetric = useMemo(() => {
    const out: Record<string, { value: number; recordedAt: string; unit: string } | null> = {};
    for (const m of allMetrics) {
      const rows = history.filter((h) => h.metric === m);
      if (rows.length === 0) { out[m] = null; continue; }
      // rows come newest-first
      out[m] = { value: rows[0].value, recordedAt: rows[0].recordedAt, unit: rows[0].unit };
    }
    return out;
  }, [history, allMetrics]);

  return (
    <Layout>
      <div className="px-4 py-4 md:px-8 md:py-6 max-w-5xl mx-auto pb-24 md:pb-6">
        <PageHeader
          title="Body composition"
          subtitle={
            <>
              Weight + lean mass + body fat, with circumference deltas.
              Lean mass is auto-derived from weight × (1 − body fat %).
              {user?.creatine && (
                <> Creatine correction subtracts ~1.5 kg intracellular water.</>
              )}
            </>
          }
          action={
            <>
              <PullToRefreshIndicator
                pulledPx={pulledPx}
                refreshing={refreshing}
              />
              <Link
                to="/check-ins"
                className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan hover:underline"
              >
                check-ins →
              </Link>
            </>
          }
        />

        {/* Window selector */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
            window
          </span>
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setWin(w.days)}
              className={classNames(
                'px-3 py-1 text-[11px] font-mono uppercase border rounded transition-colors',
                win === w.days
                  ? 'border-neon-cyan/60 text-neon-cyan bg-neon-cyan/10'
                  : 'border-ink-500/40 text-ink-300 hover:border-ink-300',
              )}
            >
              {w.label}
            </button>
          ))}
          {user?.creatine && (
            <span
              className="ml-auto text-[10px] font-mono text-neon-amber"
              title="Lean mass subtracts ~1.5 kg creatine intracellular water so the line reflects contractile tissue, not water weight."
            >
              ⚗ creatine correction active
            </span>
          )}
        </div>

        {/* Weight + lean mass + body fat */}
        <Panel variant="cyan" title="Weight + lean mass + body fat" className="border-neon-cyan/30 mb-4">
          <OverlayTrendChart
            days={win}
            units={units}
            history={combinedHistory}
            // Pad both Y axes so the line uses the full vertical
            // space instead of hugging the bottom against a 0 baseline.
            yPad={1.5}
            series={WEIGHT_GROUP.map((g, i) => ({
              metric: g.metric,
              color: g.color,
              label: g.label,
              unit: g.unit,
              // Two-axis: weight + LM in kg on the left, BF % on the right.
              yAxis: g.unit === '%' ? 'right' : 'left',
            }))}
          />
        </Panel>

        {/* Circumference group */}
        <Panel variant="magenta" title="Circumferences" className="border-neon-magenta/30 mb-4">
          {circumferenceDataCount === 0 ? (
            <div className="text-[11px] font-mono text-ink-400 italic text-center py-6">
              No circumferences logged yet in this window.
              <br />
              Take more measurements to populate the graph — neck, chest,
              waist, hips, biceps, thigh, calf all count.
            </div>
          ) : (
            <OverlayTrendChart
              days={win}
              units={units}
              history={history}
              yPad={0.5}
              series={CIRCUMFERENCE_GROUP.map((g) => ({
                metric: g.metric,
                color: g.color,
                label: g.label,
                unit: 'cm',
                yAxis: g.yAxis,
              }))}
            />
          )}
        </Panel>

        {/* Per-metric cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {allMetrics.map((m) => (
            <MetricCard
              key={m}
              metric={m}
              latest={latestByMetric[m]}
              history={history.filter((h) => h.metric === m)}
              units={units}
              win={win}
            />
          ))}
        </div>

        {queries.isLoading && (
          <div className="text-[10px] font-mono text-ink-400 mt-4">Loading history…</div>
        )}
      </div>
    </Layout>
  );
}

function MetricCard({
  metric,
  latest,
  history,
  units,
  win,
}: {
  metric: MetricType;
  latest: { value: number; recordedAt: string; unit: string } | null;
  history: Array<{ recordedAt: string; value: number }>;
  units: 'METRIC' | 'IMPERIAL';
  win: number;
}) {
  const meta = METRICS[metric];
  // Compute delta from `win` days ago to today.
  const delta = useMemo(() => {
    if (!latest || history.length === 0) return null;
    const now = Date.now();
    const cutoff = now - win * 24 * 60 * 60 * 1000;
    const baseline = history.find((h) => new Date(h.recordedAt).getTime() >= cutoff)
      ?? history[history.length - 1];
    return latest.value - baseline.value;
  }, [latest, history, win]);

  if (!latest) {
    return (
      <div className="border border-ink-500/30 bg-bg-800/40 rounded p-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
          {meta.label}
        </div>
        <div className="text-[11px] font-mono text-ink-500 italic mt-2">
          never logged
        </div>
        <Link
          to="/check-ins"
          className="text-[10px] font-mono text-neon-cyan hover:underline mt-2 inline-block"
        >
          log {meta.shortLabel.toLowerCase()} →
        </Link>
      </div>
    );
  }

  const conv = convertForDisplay(latest.value, latest.unit, units);
  const trendColor = delta == null ? 'text-ink-400'
    : Math.abs(delta) < 0.05 * Math.abs(latest.value) ? 'text-ink-300'
    : delta > 0 ? 'text-neon-lime' : 'text-neon-magenta';

  const deltaSign = delta != null && delta > 0 ? '+' : '';

  return (
    <div className="border border-ink-500/30 bg-bg-800/40 rounded p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
          {meta.shortLabel}
        </span>
        <span className="text-[10px] font-mono text-ink-500">
          {meta.unit}
        </span>
      </div>
      <div className="font-display text-2xl neon-text-cyan">
        {conv.value.toFixed(conv.value < 10 ? 2 : 1)} {conv.unit}
      </div>
      {delta != null && (
        <div className={classNames('text-[11px] font-mono mt-0.5', trendColor)}>
          {deltaSign}
          {(() => {
            const d = convertForDisplay(delta, latest.unit, units);
            return `${d.value.toFixed(d.value < 10 ? 2 : 1)} ${d.unit}`;
          })()}
          {' '}over {win}d
        </div>
      )}
      <div className="text-[10px] font-mono text-ink-500 mt-2 truncate">
        {new Date(latest.recordedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })}
      </div>
    </div>
  );
}