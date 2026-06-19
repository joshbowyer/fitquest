import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { RecoveryPanel } from '@/components/RecoveryPanel';
import { classNames } from '@/lib/format';

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

const SEVERITY_COLOR: Record<Insight['severity'], string> = {
  positive: 'lime',
  warning: 'magenta',
  info: 'cyan',
};

export function InsightsPage() {
  const q = useQuery({
    queryKey: ['insights', 'summary'],
    queryFn: () => api<Summary>('/insights/summary'),
  });

  const tips = q.data?.insights || [];
  const corrs = (q.data?.correlations || []).slice(0, 10);
  const strong = corrs.filter((c) => Math.abs(c.r) >= 0.7);
  const moderate = corrs.filter((c) => Math.abs(c.r) >= 0.4 && Math.abs(c.r) < 0.7);
  const weak = corrs.filter((c) => Math.abs(c.r) < 0.4);

  return (
    <Layout>
      <PageHeader
        title="// Insights"
        subtitle="Recovery score, top correlations, and personalized tips."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-4 mb-6">
        <RecoveryPanel />

        <Panel variant="cyan" title="Tips">
          <div className="space-y-2">
            {tips.length === 0 && (
              <div className="text-sm text-ink-300 font-mono">
                Log more data to unlock personalized insights.
              </div>
            )}
            {tips.map((t, i) => {
              const color = SEVERITY_COLOR[t.severity];
              return (
                <div
                  key={i}
                  className={classNames(
                    'flex items-start gap-3 text-sm font-mono p-3 border',
                    `border-neon-${color}/30 bg-neon-${color}/5`
                  )}
                >
                  <span className={`neon-text-${color} text-2xl leading-none`}>{t.icon}</span>
                  <div className="flex-1">
                    <div className={`font-display tracking-widest text-xs uppercase neon-text-${color}`}>
                      {t.title}
                    </div>
                    <div className="text-ink-100 leading-snug mt-1">
                      {t.message}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <Panel variant="lime" title="Correlations (last 60 days)">
        <div className="text-[10px] font-mono text-ink-300 mb-3">
          Pearson r between your habit metrics and training outcomes. Sample size (n) shown — need ≥7 paired days to appear.
        </div>

        {corrs.length === 0 ? (
          <div className="text-sm text-ink-300 font-mono text-center py-6">
            Not enough data yet. Log habits alongside workouts for a week to start seeing patterns.
          </div>
        ) : (
          <>
            {strong.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] font-display tracking-widest uppercase neon-text-lime mb-2">
                  ▣ Strong (|r| ≥ 0.7)
                </div>
                <CorrelationTable items={strong} />
              </div>
            )}
            {moderate.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] font-display tracking-widest uppercase neon-text-cyan mb-2">
                  ▣ Moderate (0.4 ≤ |r| &lt; 0.7)
                </div>
                <CorrelationTable items={moderate} />
              </div>
            )}
            {weak.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] font-display tracking-widest uppercase text-ink-300 mb-2">
                  ▣ Weak (|r| &lt; 0.4)
                </div>
                <CorrelationTable items={weak} />
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
    <div className="border border-ink-500/30">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-ink-300 border-b border-ink-500/30">
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
              <tr key={i} className="border-b border-ink-500/20 last:border-0">
                <td className="p-2 text-ink-100">{c.habitLabel}</td>
                <td className="p-2 text-ink-200">{c.outcomeLabel}</td>
                <td className={`p-2 text-right ${positive ? 'neon-text-lime' : 'neon-text-magenta'}`}>
                  {c.r > 0 ? '+' : ''}{c.r.toFixed(2)}
                </td>
                <td className="p-2 text-right text-ink-300">{c.n}</td>
                <td className="p-2 pl-4 w-32">
                  <div className="h-1.5 bg-bg-700 border border-ink-500/30 overflow-hidden">
                    <div
                      className={positive ? 'bg-neon-lime' : 'bg-neon-magenta'}
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
