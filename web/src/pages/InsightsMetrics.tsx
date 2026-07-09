import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { api, ApiError } from '@/lib/api';
import { classNames, formatRelative } from '@/lib/format';
import { convertForDisplay, type UnitSystem } from '@/lib/units';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { METRICS_BY_CATEGORY, METRICS, type MetricType } from '@/lib/types';

type Factor = {
  label: string;
  signal: 'positive' | 'negative' | 'neutral';
  weight: number;
  note: string;
};

type BaselineWindow = {
  avg: number | null;
  delta: number | null;
  deltaPct: number | null;
  coverageDays: number;
  lastValue: number | null;
  lastRecordedAt: string | null;
};

type Baselines = {
  metric: string;
  windows: {
    last7: BaselineWindow;
    prior7: BaselineWindow;
    last30: BaselineWindow;
    prior30: BaselineWindow;
    last90: BaselineWindow;
    prior90: BaselineWindow;
  };
  geneticMax: number | null;
  relatedMetrics: Record<string, number | null>;
};

type MetricInsightRow = {
  id: string;
  metric: MetricType;
  summary: string;
  factors: Factor[];
  model: string | null;
  createdAt: string;
  updatedAt: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  BODY_COMP: 'Body composition',
  STRENGTH: 'Strength',
  HYPERTROPHY: 'Circumferences',
  CARDIO: 'Cardio',
  CALISTHENICS: 'Calisthenics',
  SLEEP: 'Sleep',
  NUTRITION: 'Nutrition',
  WELLNESS: 'Wellness',
};

const CATEGORY_VARIANT: Record<string, 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet'> = {
  BODY_COMP: 'lime',
  STRENGTH: 'cyan',
  HYPERTROPHY: 'magenta',
  CARDIO: 'amber',
  CALISTHENICS: 'violet',
  SLEEP: 'cyan',
  NUTRITION: 'cyan',
  WELLNESS: 'lime',
};

type InsightPostResp = {
  insight: { metric: MetricType; summary: string; factors: Factor[]; generatedAt: string };
  cached: boolean;
  promptVersion: number;
};

type InsightGetResp = { insight: MetricInsightRow; promptVersion: number };

/**
 * Per-metric AI deep-dive. Renders every measurable metric (≈30)
 * grouped by category, each with:
 *   - current value (in user's units)
 *   - 7/30/90-day averages + deltas
 *   - sparkline-style coverage indicator
 *   - "Generate insight" button → LLM summary + factors
 *
 * Card states:
 *   - never logged     → muted card + "log" link
 *   - data but no LLM  → "Generate insight" button
 *   - LLM cached       → summary + factor chips + "regenerate"
 *   - generating       → loading state
 *
 * Heavy: only the metrics the user actually has data for get
 * rendered fully; never-logged metrics collapse to a single line.
 */
export function InsightsMetricsPage() {
  const { user } = useAuth();
  const units: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';
  const qc = useQueryClient();

  // Single fetch: every baseline + every cached insight. We split
  // per-metric in the rendered cards so loading states are
  // localised.
  const baselinesQ = useQuery({
    queryKey: ['metric-baselines-all', 'metric-baselines'],
    queryFn: async () => {
      // Build a flat {metric: Baselines} map by fanning out requests.
      // Done with Promise.allSettled so one failure doesn't poison the
      // whole page.
      const allMetrics = Object.values(METRICS_BY_CATEGORY).flat();
      const settled = await Promise.allSettled(
        allMetrics.map((m) =>
          api<{ data: Baselines; promptVersion: number }>(`/insights/metric/${m}/baselines`)
            .then((r) => [m, r.data] as const),
        ),
      );
      const out: Record<string, Baselines> = {};
      for (const r of settled) if (r.status === 'fulfilled') out[r.value[0]] = r.value[1];
      return out;
    },
  });

  const cachedQ = useQuery({
    queryKey: ['metric-insights', 'cached'],
    queryFn: async () => {
      // Hit GET /insights/metric/:metric for each metric. 404 → no
      // insight yet; 200 → cached row. Parallel fan-out, same
      // allSettled trick.
      const allMetrics = Object.values(METRICS_BY_CATEGORY).flat();
      const settled = await Promise.allSettled(
        allMetrics.map((m) =>
          api<InsightGetResp>(`/insights/metric/${m}`).then((r) => [m, r.insight] as const),
        ),
      );
      const out: Record<string, MetricInsightRow> = {};
      for (const r of settled) if (r.status === 'fulfilled') out[r.value[0]] = r.value[1];
      return out;
    },
    retry: false,
  });

  const grouped = useMemo(() => {
    const out: Record<string, MetricType[]> = {};
    for (const cat of Object.keys(METRICS_BY_CATEGORY)) {
      out[cat] = [...METRICS_BY_CATEGORY[cat as keyof typeof METRICS_BY_CATEGORY]];
    }
    return out;
  }, []);

  // Coverage gap count: metrics with no data in 30 days.
  const coverageGaps = useMemo(() => {
    const baselines = baselinesQ.data ?? {};
    const gaps: Array<{ metric: MetricType; daysSince: number | null }> = [];
    for (const cat of Object.keys(METRICS_BY_CATEGORY)) {
      for (const m of METRICS_BY_CATEGORY[cat as keyof typeof METRICS_BY_CATEGORY]) {
        const b = baselines[m];
        const last = b?.windows.last30.lastRecordedAt
          ? new Date(b.windows.last30.lastRecordedAt).getTime()
          : null;
        const daysSince = last ? Math.round((Date.now() - last) / (24 * 60 * 60 * 1000)) : null;
        if (last == null || daysSince == null || daysSince > 7) {
          gaps.push({ metric: m, daysSince });
        }
      }
    }
    return gaps;
  }, [baselinesQ.data]);

  // Pull-to-refresh: invalidate the same two top-level queries
  // the CategorySection `onRefresh` callback already targets
  // (`['metric-baselines-all', 'metric-baselines']` and
  // `['metric-insights', 'cached']`). Doing it here means a
  // pull gesture refreshes the page without threading state
  // through CategorySection.
  const { pulledPx, refreshing } = usePullToRefresh<HTMLDivElement>({
    scrollSelector: 'main',
    onRefresh: () => {
      qc.invalidateQueries({ queryKey: ['metric-insights', 'cached'] });
      qc.invalidateQueries({ queryKey: ['metric-baselines-all'] });
    },
  });

  return (
    <Layout>
      <div className="px-4 py-4 md:px-8 md:py-6 max-w-5xl mx-auto pb-24 md:pb-6">
        <PageHeader
          title="Insights — metrics"
          subtitle="Per-metric deep-dive. Windowed averages, deltas, and an LLM-written narrative for every measurable metric. Click 'Generate' on any metric to write its insight (cached for 7 days)."
          action={
            <div className="flex items-center gap-3">
              {pulledPx > 4 && (
                <span
                  aria-hidden
                  className="text-[10px] font-mono uppercase tracking-widest text-ink-300"
                >
                  {refreshing
                    ? 'Refreshing…'
                    : pulledPx > 0
                      ? `Release to refresh (${Math.round(pulledPx)}px)`
                      : 'Pull to refresh'}
                </span>
              )}
              <Link
                to="/insights"
                className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan hover:underline"
              >
                ← correlations
              </Link>
            </div>
          }
        />

        {/* Coverage gaps summary — quick at-a-glance list of metrics
            the user hasn't touched in over a week. Most actionable
            affordance on the page. */}
        {coverageGaps.length > 0 && (
          <Panel variant="amber" title="Coverage gaps" className="border-neon-amber/30 mb-4">
            <div className="text-[10px] font-mono text-ink-300 mb-2">
              Metrics with no data in the last week. Log them via{' '}
              <Link to="/check-ins" className="text-neon-cyan hover:underline">check-ins</Link>
              {' '}or the per-metric "log" link below.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {coverageGaps.slice(0, 16).map(({ metric, daysSince }) => (
                <Link
                  key={metric}
                  to="/check-ins"
                  className="text-[10px] font-mono px-2 py-0.5 border border-ink-500/30 text-ink-300 hover:border-neon-cyan hover:text-neon-cyan"
                >
                  {METRICS[metric].shortLabel}
                  <span className="text-ink-500 ml-1">
                    {daysSince == null ? 'never' : `${daysSince}d ago`}
                  </span>
                </Link>
              ))}
              {coverageGaps.length > 16 && (
                <span className="text-[10px] font-mono text-ink-400">
                  +{coverageGaps.length - 16} more
                </span>
              )}
            </div>
          </Panel>
        )}

        {baselinesQ.isLoading && (
          <div className="text-[10px] font-mono text-ink-400">Loading baselines…</div>
        )}

        {Object.keys(grouped).map((cat) => (
          <CategorySection
            key={cat}
            category={cat}
            metrics={grouped[cat]}
            units={units}
            baselines={baselinesQ.data ?? {}}
            cached={cachedQ.data ?? {}}
            onRefresh={() => {
              qc.invalidateQueries({ queryKey: ['metric-insights', 'cached'] });
              qc.invalidateQueries({ queryKey: ['metric-baselines-all'] });
            }}
          />
        ))}
      </div>
    </Layout>
  );
}

function CategorySection({
  category,
  metrics,
  units,
  baselines,
  cached,
  onRefresh,
}: {
  category: string;
  metrics: MetricType[];
  units: UnitSystem;
  baselines: Record<string, Baselines>;
  cached: Record<string, MetricInsightRow>;
  onRefresh: () => void;
}) {
  const variant = CATEGORY_VARIANT[category] ?? 'cyan';
  return (
    <section className={classNames('panel relative p-4 mb-4 border', `border-neon-${variant}/30`)}>
      <header className="flex items-center justify-between mb-3 pb-2 border-b border-current/10">
        <h2 className={classNames('font-display tracking-widest text-xs uppercase', `text-neon-${variant}`)}>
          {CATEGORY_LABELS[category] ?? category}
        </h2>
        <span className="text-[10px] font-mono text-ink-400">
          {metrics.length} metrics
        </span>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {metrics.map((m) => (
          <ErrorBoundary key={m}>
            <MetricDeepDive
              metric={m}
              units={units}
              baseline={baselines[m]}
              insight={cached[m]}
              onRefresh={onRefresh}
            />
          </ErrorBoundary>
        ))}
      </div>
    </section>
  );
}

function MetricDeepDive({
  metric,
  units,
  baseline,
  insight,
  onRefresh,
}: {
  metric: MetricType;
  units: UnitSystem;
  baseline: Baselines | undefined;
  insight: MetricInsightRow | undefined;
  onRefresh: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const meta = METRICS[metric];

  // Generate / regenerate. force=true is implicit on first click
  // (no cached row) and explicit on the "Regenerate" button.
  const generateM = useDelayedMutation<InsightPostResp, boolean>(
    {
      mutationFn: (force) =>
        api<InsightPostResp>(`/insights/metric/${metric}${force ? '?force=1' : ''}`, { method: 'POST' }),
      onError: (e) => setErr(e instanceof ApiError ? e.message : 'Generation failed'),
      onSuccess: () => {
        setErr(null);
        onRefresh();
      },
    },
    800,
  );

  // Never logged state.
  if (!baseline || baseline.windows.last30.lastValue == null) {
    return (
      <div className="border border-ink-500/30 bg-bg-800/40 rounded p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
            {meta.shortLabel}
          </span>
          <span className="text-[10px] font-mono text-ink-500">{meta.unit || '—'}</span>
        </div>
        <div className="text-[11px] font-mono text-ink-500 italic mt-1">
          No data yet.
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

  const w = baseline.windows;
  const last = w.last30.lastValue ?? w.last7.lastValue ?? w.last90.lastValue;
  const lastDate = w.last30.lastRecordedAt ?? w.last7.lastRecordedAt ?? w.last90.lastRecordedAt;
  const lastUnit = meta.unit || '';
  const conv = last != null ? convertForDisplay(last, lastUnit, units) : null;

  return (
    <div className="border border-ink-500/30 bg-bg-800/40 rounded p-3">
      <div className="flex items-baseline justify-between mb-1 gap-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400 truncate">
          {meta.shortLabel}
        </span>
        <span className="text-[10px] font-mono text-ink-500 shrink-0">
          {lastUnit}
        </span>
      </div>
      <div className="font-display text-xl neon-text-cyan tabular-nums">
        {conv ? `${conv.value.toFixed(conv.value < 10 ? 2 : 1)} ${conv.unit}` : '—'}
      </div>

      {/* Windowed mini-stats */}
      <div className="grid grid-cols-3 gap-2 mt-2 mb-2">
        <WindowTile label="7d"   win={w.last7}   units={units} baseUnit={lastUnit} />
        <WindowTile label="30d"  win={w.last30}  units={units} baseUnit={lastUnit} />
        <WindowTile label="90d"  win={w.last90}  units={units} baseUnit={lastUnit} />
      </div>

      {lastDate && (
        <div className="text-[10px] font-mono text-ink-500 mb-2">
          last logged {formatRelative(lastDate)}
        </div>
      )}

      {/* LLM insight section */}
      {insight ? (
        <InsightBody
          insight={insight}
          generating={generateM.isPending}
          onRegenerate={() => {
            setErr(null);
            generateM.run(true);
          }}
        />
      ) : (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-ink-500/15">
          <span className="text-[10px] font-mono text-ink-400 italic">
            No AI narrative yet.
          </span>
          <NeonButton
            size="sm"
            variant="violet"
            loading={generateM.isPending}
            loadingText="Generating…"
            onClick={() => {
              setErr(null);
              generateM.run(false);
            }}
          >
            Generate
          </NeonButton>
        </div>
      )}

      {err && (
        <div className="mt-2 text-[10px] text-rose-300 font-mono">{err}</div>
      )}
    </div>
  );
}

function WindowTile({
  label,
  win,
  units,
  baseUnit,
}: {
  label: string;
  win: BaselineWindow;
  units: UnitSystem;
  baseUnit: string;
}) {
  if (win.avg == null) {
    return (
      <div className="border border-ink-500/20 px-2 py-1">
        <div className="text-[9px] font-mono uppercase tracking-widest text-ink-400">{label}</div>
        <div className="text-[11px] font-mono text-ink-500 italic mt-0.5">—</div>
      </div>
    );
  }
  const conv = convertForDisplay(win.avg, baseUnit, units);
  const deltaColor =
    win.deltaPct == null ? 'text-ink-400' :
    Math.abs(win.deltaPct) < 0.05 ? 'text-ink-400' :
    win.deltaPct > 0 ? 'text-neon-lime' : 'text-neon-magenta';
  return (
    <div className="border border-ink-500/20 px-2 py-1">
      <div className="text-[9px] font-mono uppercase tracking-widest text-ink-400">{label}</div>
      <div className="text-[11px] font-mono tabular-nums">
        {conv.value.toFixed(conv.value < 10 ? 1 : 0)} <span className="text-ink-400">{conv.unit}</span>
      </div>
      {win.deltaPct != null && (
        <div className={classNames('text-[10px] font-mono tabular-nums', deltaColor)}>
          {win.deltaPct > 0 ? '+' : ''}
          {(win.deltaPct * 100).toFixed(0)}%
        </div>
      )}
      <div className="text-[9px] font-mono text-ink-500">
        {win.coverageDays}d
      </div>
    </div>
  );
}

function InsightBody({
  insight,
  generating,
  onRegenerate,
}: {
  insight: MetricInsightRow;
  generating: boolean;
  onRegenerate: () => void;
}) {
  return (
    <div className="pt-2 border-t border-ink-500/15">
      <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1 flex items-center justify-between">
        <span>AI narrative</span>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={generating}
          className="text-[10px] font-mono text-violet-300 hover:underline disabled:opacity-50"
          title="Regenerate using latest data"
        >
          {generating ? 'regenerating…' : 'regenerate'}
        </button>
      </div>
      <div className="text-[11px] font-mono text-ink-200 leading-snug">
        {insight.summary}
      </div>
      {insight.factors.length > 0 && (
        <ul className="mt-2 space-y-1">
          {insight.factors.map((f, i) => (
            <li key={`${f.label}-${i}`} className="flex items-baseline gap-1.5 text-[10px] font-mono">
              <span
                className={classNames(
                  f.signal === 'positive' ? 'text-neon-lime' :
                  f.signal === 'negative' ? 'text-neon-magenta' :
                  'text-cyan-300',
                )}
              >
                {f.signal === 'positive' ? '▲' : f.signal === 'negative' ? '▼' : '◆'}
              </span>
              <span className="text-ink-100 font-display uppercase tracking-widest text-[10px]">
                {f.label}
              </span>
              <span className="text-ink-300 flex-1 truncate" title={f.note}>
                {f.note}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 text-[9px] font-mono text-ink-500">
        generated {formatRelative(insight.updatedAt)}
        {insight.model && ` · ${insight.model}`}
      </div>
    </div>
  );
}