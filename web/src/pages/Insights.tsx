import { useQuery } from '@tanstack/react-query';
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
};
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
  const system = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';

  const [overlayDays, setOverlayDays] = useState<DaysOpt>(90);

  const summaryQ = useQuery({
    queryKey: ['insights', 'summary'],
    queryFn: () => api<Summary>('/insights/summary'),
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
  const corrs = (summaryQ.data?.correlations || []).slice(0, 10);
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
      <Panel variant="lime" title="Correlations (last 60 days)">
        <div className="text-[10px] font-mono text-slate-400 mb-3">
          Pearson r between your habit metrics and training outcomes. Sample size (n) shown — need ≥7 paired days to appear.
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
                <CorrelationTable items={strong} />
              </div>
            )}
            {moderate.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] font-display tracking-widest uppercase text-cyan-300 mb-2">
                  ▣ Moderate (0.4 ≤ |r| &lt; 0.7)
                </div>
                <CorrelationTable items={moderate} />
              </div>
            )}
          </>
        )}
      </Panel>
    </Layout>
  );
}

function CorrelationTable({ items }: { items: Correlation[] }) {
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
          </tr>
        </thead>
        <tbody>
          {items.map((c, i) => {
            const positive = c.r > 0;
            const width = Math.abs(c.r) * 100;
            return (
              <tr key={i} className="border-b border-slate-800 last:border-0">
                <td className="p-2 text-slate-200">{c.habitLabel}</td>
                <td className="p-2 text-slate-300">{c.outcomeLabel}</td>
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
