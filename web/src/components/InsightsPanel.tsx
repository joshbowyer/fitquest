import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Panel } from './Panel';
import { classNames } from '@/lib/format';

type Insight = {
  type: string;
  severity: 'info' | 'positive' | 'warning';
  icon: string;
  title: string;
  message: string;
  metric?: string;
  value?: number;
};
type Correlation = {
  habit: string;
  outcome: string;
  r: number;
  n: number;
  habitLabel: string;
  outcomeLabel: string;
};
type Summary = {
  recovery: { score: number | null };
  correlations: Correlation[];
  insights: Insight[];
};

const SEVERITY_COLOR: Record<Insight['severity'], string> = {
  positive: 'lime',
  warning: 'magenta',
  info: 'cyan',
};

export function InsightsPanel() {
  const q = useQuery({
    queryKey: ['insights', 'summary'],
    queryFn: () => api<Summary>('/insights/summary'),
  });

  const tips = (q.data?.insights || []).slice(0, 3);
  const corrs = (q.data?.correlations || []).filter((c) => Math.abs(c.r) >= 0.4).slice(0, 3);

  return (
    <Panel variant="cyan" title="Insights" scanline>
      <div className="space-y-4">
        {/* Tips */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-2">
            Tips
          </div>
          <div className="space-y-1.5">
            {tips.length === 0 && (
              <div className="text-xs text-ink-300 font-mono">
                Log more data to unlock personalized insights.
              </div>
            )}
            {tips.map((t, i) => {
              const color = SEVERITY_COLOR[t.severity];
              return (
                <div
                  key={i}
                  className={classNames(
                    'flex items-start gap-2 text-xs font-mono p-2 border',
                    `border-neon-${color}/30 bg-neon-${color}/5`
                  )}
                >
                  <span className={`neon-text-${color} text-base leading-none mt-0.5`}>{t.icon}</span>
                  <div className="flex-1">
                    <div className={`font-display tracking-wider text-[10px] uppercase neon-text-${color}`}>
                      {t.title}
                    </div>
                    <div className="text-ink-200 leading-snug mt-0.5">
                      {t.message}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Correlations */}
        {corrs.length > 0 && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-2 flex items-center justify-between">
              <span>Top Correlations</span>
              <span className="text-ink-400 normal-case tracking-normal">last 60d</span>
            </div>
            <div className="space-y-1.5">
              {corrs.map((c, i) => {
                const positive = c.r > 0;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs font-mono border border-ink-500/20 p-1.5"
                  >
                    <div className="flex-1">
                      <div className="text-ink-200">{c.habitLabel}</div>
                      <div className="text-[10px] text-ink-300">→ {c.outcomeLabel} · n={c.n}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-bg-700 border border-ink-500/30 overflow-hidden">
                        <div
                          className={positive ? 'bg-neon-lime' : 'bg-neon-magenta'}
                          style={{ width: `${Math.abs(c.r) * 100}%`, boxShadow: '0 0 4px currentColor' }}
                        />
                      </div>
                      <span className={positive ? 'neon-text-lime' : 'neon-text-magenta'}>
                        r={c.r.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="text-center pt-1">
          <Link
            to="/insights"
            className="text-[10px] font-display tracking-widest neon-text-cyan hover:underline"
          >
            → FULL INSIGHTS
          </Link>
        </div>
      </div>
    </Panel>
  );
}
