import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { RecoveryPanel } from '@/components/RecoveryPanel';
import { useAuth } from '@/lib/auth';
import { classNames } from '@/lib/format';
import { OverlayTrendChart } from '@/components/OverlayTrendChart';
import { WeeklyVolumeChart } from '@/components/WeeklyVolumeChart';

type Correlation = {
  habit: string;
  outcome: string;
  r: number;
  n: number;
  habitLabel: string;
  outcomeLabel: string;
  /// Days the habit leads the outcome. 0 = same day, 1 =
  /// yesterday's habit predicts today's outcome, etc.
  lagDays: number;
  /// Rolling window length used to compute this correlation
  /// (30 / 60 / 90).
  lookbackDays: number;
};
type CorrelationHistoryPoint = { date: string; r: number; n: number };
type Insight = {
  type: string;
  severity: 'info' | 'positive' | 'warning';
  icon: string;
  title: string;
  message: string;
};
type Summary = {
  recovery: any;
  correlations: Correlation[];
  insights: Insight[];
};
type HistoryPoint = { recordedAt: string; metric: string; value: number };
type WeeklyVolume = {
  week: string;
  volume: number;
  sessions: number;
  minutes: number;
};
type StalenessFlag = {
  kind: string;
  severity: 'info' | 'warning';
  title: string;
  detail: string;
};

const SEVERITY_COLOR: Record<Insight['severity'], string> = {
  positive: 'lime',
  warning: 'magenta',
  info: 'cyan',
};

const DAYS_OPTIONS = [30, 60, 90] as const;
type DaysOpt = (typeof DAYS_OPTIONS)[number];

export function InsightsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const system = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';

  const [overlayDays, setOverlayDays] = useState<DaysOpt>(90);
  /// Lag toggle: 0 = same day, 1 = yesterday's habit predicts
  /// today's outcome, 2 = two days ago. We always render one
  /// full set per page so the user can see all lags side by
  /// side; the toggle only re-queries the summary endpoint with
  /// ?lag=N so the trend sparkline lookup matches.
  const [lag, setLag] = useState<0 | 1 | 2>(0);
  /// Window for the trend sparklines. The snapshots are written
  /// for 30/60/90; default to 60 since it balances recency and
  /// sample size.
  const [trendWindow, setTrendWindow] = useState<30 | 60 | 90>(60);

  const summaryQ = useQuery({
    queryKey: ['insights', 'summary'],
    queryFn: () => api<Summary>('/insights/summary'),
  });
  const corrQ = useQuery({
    queryKey: ['insights', 'correlations', lag],
    queryFn: () =>
      api<{ items: Correlation[] }>(`/insights/correlations?lag=${lag}`),
  });
  const volumeQ = useQuery({
    queryKey: ['insights', 'weekly-volume'],
    queryFn: () => api<{ items: WeeklyVolume[] }>('/insights/weekly-volume'),
  });
  const stalenessQ = useQuery({
    queryKey: ['insights', 'anti-staleness'],
    queryFn: () => api<{ flags: StalenessFlag[] }>('/insights/anti-staleness'),
  });

  // Pull 90 days of HRV + sleep history for the overlay chart. The
  // /measurements endpoint returns one series per metric when given
  // a metric name; we fan out and merge into a single history array.
  const hrvQ = useQuery({
    queryKey: ['insights', 'history', 'HRV', overlayDays],
    queryFn: () =>
      api<{ items: HistoryPoint[] }>(
        `/measurements?metric=HRV&days=${overlayDays}`,
      ),
  });
  const sleepQ = useQuery({
    queryKey: ['insights', 'history', 'SLEEP_HOURS', overlayDays],
    queryFn: () =>
      api<{ items: HistoryPoint[] }>(
        `/measurements?metric=SLEEP_HOURS&days=${overlayDays}`,
      ),
  });
  const weightQ = useQuery({
    queryKey: ['insights', 'history', 'WEIGHT', overlayDays],
    queryFn: () =>
      api<{ items: HistoryPoint[] }>(
        `/measurements?metric=WEIGHT&days=${overlayDays}`,
      ),
  });

  const tips = summaryQ.data?.insights || [];
  // Use the lag-filtered list for the table; falls back to the
  // summary's correlations when the lag query hasn't returned yet.
  const corrs = (corrQ.data?.items ?? summaryQ.data?.correlations ?? []).slice(0, 10);
  const strong = corrs.filter((c) => Math.abs(c.r) >= 0.7);
  const moderate = corrs.filter((c) => Math.abs(c.r) >= 0.4 && Math.abs(c.r) < 0.7);

  const history = [
    ...(hrvQ.data?.items ?? []),
    ...(sleepQ.data?.items ?? []),
    ...(weightQ.data?.items ?? []),
  ];

  const overlaySeries = [
    { metric: 'HRV', color: '#c45cff', label: 'HRV', unit: 'ms', yAxis: 'left' as const },
    {
      metric: 'SLEEP_HOURS',
      color: '#9bff5c',
      label: 'Sleep',
      unit: 'h',
      yAxis: 'right' as const,
    },
  ];
  const overlaySeries2 = [
    {
      metric: 'WEIGHT',
      color: '#ffc34d',
      label: 'Weight',
      unit: system === 'IMPERIAL' ? 'lb' : 'kg',
      yAxis: 'left' as const,
    },
  ];

  return (
    <Layout>
      <PageHeader
        title="// Insights"
        subtitle="Deep-dive trends, correlations, anti-staleness diagnostics."
      />

      {/* Top row: 90-day overlays */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">
          Overlay window
        </span>
        {DAYS_OPTIONS.map((d) => (
          <button
            key={d}
            onClick={() => setOverlayDays(d)}
            className={classNames(
              'text-[10px] px-2 py-0.5 rounded border font-mono',
              overlayDays === d
                ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
                : 'border-slate-700 text-slate-400 hover:border-slate-500',
            )}
          >
            {d}d
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Panel variant="magenta" title={`HRV vs Sleep · ${overlayDays}d`}>
          <OverlayTrendChart
            days={overlayDays}
            units={system}
            series={overlaySeries}
            history={history}
          />
          <div className="text-[10px] font-mono text-slate-400 mt-1">
            When HRV drops while sleep holds steady, training is likely
            the stressor. When both drop together, life-stress.
          </div>
        </Panel>
        <Panel variant="amber" title={`Body weight · ${overlayDays}d`}>
          <OverlayTrendChart
            days={overlayDays}
            units={system}
            series={overlaySeries2}
            history={history}
          />
          <div className="text-[10px] font-mono text-slate-400 mt-1">
            Daily weigh-ins reveal the trend beneath the noise.
          </div>
        </Panel>
      </div>

      {/* Weekly volume */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4 mb-6">
        <Panel variant="lime" title="Weekly volume + sessions (12w)">
          <WeeklyVolumeChart data={volumeQ.data?.items ?? []} units={system} />
          {volumeQ.data && volumeQ.data.items.length > 1 && (
            <div className="mt-2 text-[10px] font-mono text-slate-400">
              {(() => {
                const items = volumeQ.data.items;
                const last = items[items.length - 1];
                const prev4 = items.slice(-5, -1);
                if (prev4.length === 0) return null;
                const avgPrev = prev4.reduce((s, w) => s + w.volume, 0) / prev4.length;
                if (avgPrev === 0) return null;
                const delta = ((last.volume - avgPrev) / avgPrev) * 100;
                const sign = delta >= 0 ? '+' : '';
                return (
                  <span>
                    This week: <b className="text-cyan-300">{sign}{delta.toFixed(0)}%</b> vs prior 4w avg
                  </span>
                );
              })()}
            </div>
          )}
        </Panel>
        <RecoveryPanel />
      </div>

      {/* Anti-staleness */}
      <Panel
        variant="violet"
        title="Anti-staleness diagnostics"
        subtitle="Detected patterns that suggest a programming change."
        className="mb-6"
      >
        {stalenessQ.isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (stalenessQ.data?.flags ?? []).length === 0 ? (
          <p className="text-sm text-slate-400 font-mono">
            No issues detected. Keep training — your patterns look healthy.
          </p>
        ) : (
          <div className="space-y-2">
            {(stalenessQ.data?.flags ?? []).map((f, i) => {
              const color = f.severity === 'warning' ? 'magenta' : 'cyan';
              return (
                <div
                  key={i}
                  className={classNames(
                    'flex items-start gap-3 text-sm font-mono p-3 border',
                    `border-neon-${color}/30 bg-neon-${color}/5`,
                  )}
                >
                  <span className={`neon-text-${color} text-xl leading-none`}>
                    {f.severity === 'warning' ? '⚠' : 'ℹ'}
                  </span>
                  <div>
                    <div className={`font-display tracking-widest text-xs uppercase neon-text-${color}`}>
                      {f.title}
                    </div>
                    <div className="text-slate-200 leading-snug mt-1">
                      {f.detail}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Tips */}
      {tips.length > 0 && (
        <Panel variant="cyan" title="Tips" className="mb-6">
          <div className="space-y-2">
            {tips.map((t, i) => {
              const color = SEVERITY_COLOR[t.severity];
              return (
                <div
                  key={i}
                  className={classNames(
                    'flex items-start gap-3 text-sm font-mono p-3 border',
                    `border-neon-${color}/30 bg-neon-${color}/5`,
                  )}
                >
                  <span className={`neon-text-${color} text-2xl leading-none`}>{t.icon}</span>
                  <div className="flex-1">
                    <div className={`font-display tracking-widest text-xs uppercase neon-text-${color}`}>
                      {t.title}
                    </div>
                    <div className="text-slate-100 leading-snug mt-1">
                      {t.message}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Correlations */}
      <Panel
        variant="lime"
        title="Correlations"
        action={
          <button
            type="button"
            onClick={() => api('/insights/correlations/snapshot', { method: 'POST' })
              .then(() => qc.invalidateQueries({ queryKey: ['insights', 'correlations'] }))}
            className="text-[10px] font-mono uppercase tracking-widest text-lime-300 hover:underline"
            title="Recompute tonight's correlation snapshot now (normally runs at 03:30 local)"
          >
            ⟳ refresh snapshot
          </button>
        }
      >
        <div className="text-[10px] font-mono text-slate-400 mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Pearson r between your habits and training outcomes (need ≥7 paired days).</span>
          <span className="inline-flex items-center gap-1">
            <span className="text-slate-500">lag:</span>
            {([0, 1, 2] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLag(l)}
                className={classNames(
                  'px-1.5 py-0.5 border text-[10px] font-mono',
                  lag === l
                    ? 'border-lime-400 text-lime-300 bg-lime-400/10'
                    : 'border-slate-700 text-slate-400 hover:border-slate-500',
                )}
                title={
                  l === 0
                    ? "Same day: today's habit vs today's outcome"
                    : l === 1
                      ? "Lag 1d: yesterday's habit predicts today's outcome"
                      : "Lag 2d: habit two days ago predicts today's outcome"
                }
              >
                {l === 0 ? 't-0' : `t-${l}`}
              </button>
            ))}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="text-slate-500">trend window:</span>
            {([30, 60, 90] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setTrendWindow(w)}
                className={classNames(
                  'px-1.5 py-0.5 border text-[10px] font-mono',
                  trendWindow === w
                    ? 'border-cyan-400 text-cyan-300 bg-cyan-400/10'
                    : 'border-slate-700 text-slate-400 hover:border-slate-500',
                )}
              >
                {w}d
              </button>
            ))}
          </span>
        </div>
        {corrs.length === 0 ? (
          <div className="text-sm text-slate-400 font-mono text-center py-6">
            Not enough data yet. Log habits alongside workouts for a week to start seeing patterns.
          </div>
        ) : (
          <>
            {strong.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] font-display tracking-widest uppercase text-lime-300 mb-2">
                  ▣ Strong (|r| ≥ 0.7)
                </div>
                <CorrelationTable items={strong} lookbackDays={trendWindow} lagDays={lag} />
              </div>
            )}
            {moderate.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] font-display tracking-widest uppercase text-cyan-300 mb-2">
                  ▣ Moderate (0.4 ≤ |r| &lt; 0.7)
                </div>
                <CorrelationTable items={moderate} lookbackDays={trendWindow} lagDays={lag} />
              </div>
            )}
          </>
        )}
      </Panel>
    </Layout>
  );
}

/**
 * Tiny inline SVG sparkline. Takes an array of {date, r} points
 * and renders the r trajectory from -1 to +1 with a zero line.
 * Used in the trend column so the user can see at a glance
 * whether a correlation is strengthening, fading, or oscillating.
 */
function CorrelationSparkline({ points }: { points: CorrelationHistoryPoint[] }) {
  if (points.length === 0) {
    return <div className="text-[9px] text-slate-600">no history</div>;
  }
  const w = 90;
  const h = 22;
  const pad = 2;
  const xs = points.map((_, i) =>
    points.length === 1 ? pad : pad + (i / (points.length - 1)) * (w - pad * 2),
  );
  // Map r in [-1, 1] to y in [pad, h - pad] (top = +1, bottom = -1).
  const ys = points.map((p) => pad + (1 - (Math.max(-1, Math.min(1, p.r)) + 1) / 2) * (h - pad * 2));
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i]!.toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  const positive = last.r >= 0;
  return (
    <svg width={w} height={h} className="block">
      <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke="#334155" strokeDasharray="2 3" />
      <path
        d={path}
        fill="none"
        stroke={positive ? '#a3e635' : '#e879f9'}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={xs[xs.length - 1]}
        cy={ys[ys.length - 1]}
        r={1.6}
        fill={positive ? '#a3e635' : '#e879f9'}
      />
    </svg>
  );
}

function CorrelationTable({
  items,
  lookbackDays,
  lagDays,
}: {
  items: Correlation[];
  lookbackDays: number;
  lagDays: number;
}) {
  // We fire one history query per row. Each row only contains a
  // handful of points (~12 weeks of nightly snapshots), so this
  // stays cheap; react-query deduplicates identical keys.
  return (
    <div className="border border-slate-700/60">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-slate-400 border-b border-slate-700/60">
            <th className="text-left p-2">Habit</th>
            <th className="text-left p-2">Outcome</th>
            <th className="text-right p-2">r</th>
            <th className="text-right p-2">n</th>
            <th className="text-left p-2 pl-4">Effect</th>
            <th className="text-left p-2 pl-4">12w trend</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <CorrelationRow
              key={`${c.habit}-${c.outcome}-${c.lagDays}-${c.lookbackDays}`}
              c={c}
              lookbackDays={lookbackDays}
              lagDays={lagDays}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CorrelationRow({
  c,
  lookbackDays,
  lagDays,
}: {
  c: Correlation;
  lookbackDays: number;
  lagDays: number;
}) {
  const positive = c.r > 0;
  const width = Math.abs(c.r) * 100;
  const historyQ = useQuery({
    queryKey: [
      'correlation-history',
      c.habit,
      c.outcome,
      lookbackDays,
      lagDays,
    ],
    queryFn: () =>
      api<{ points: CorrelationHistoryPoint[] }>(
        `/insights/correlations/history?habit=${c.habit}&outcome=${c.outcome}&lookbackDays=${lookbackDays}&lagDays=${lagDays}&weeks=12`,
      ),
  });
  return (
    <tr className="border-b border-slate-800 last:border-0">
      <td className="p-2 text-slate-200">{c.habitLabel}</td>
      <td className="p-2 text-slate-300">
        {c.outcomeLabel}
        {c.lagDays > 0 && (
          <span className="ml-1 text-[9px] text-amber-300/80">t-{c.lagDays}d</span>
        )}
      </td>
      <td className={`p-2 text-right ${positive ? 'text-lime-300' : 'text-fuchsia-400'}`}>
        {c.r > 0 ? '+' : ''}{c.r.toFixed(2)}
      </td>
      <td className="p-2 text-right text-slate-400">{c.n}</td>
      <td className="p-2 pl-4 w-32">
        <div className="h-1.5 bg-slate-800 border border-slate-700 overflow-hidden">
          <div
            className={positive ? 'bg-lime-400' : 'bg-fuchsia-500'}
            style={{ width: `${width}%`, boxShadow: '0 0 4px currentColor' }}
          />
        </div>
      </td>
      <td className="p-2 pl-4">
        {historyQ.isLoading ? (
          <div className="text-[9px] text-slate-600">…</div>
        ) : (
          <CorrelationSparkline points={historyQ.data?.points ?? []} />
        )}
      </td>
    </tr>
  );
}
