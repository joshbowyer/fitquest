import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Panel } from './Panel';
import { classNames } from '@/lib/format';

type Component = {
  metric: string;
  rawValue: number | null;
  subscore: number | null;
  weight: number;
  contribution: number;
  reason: string;
  available: boolean;
};
type Recovery = {
  score: number | null;
  components: Component[];
  dataPoints: number;
  totalMetrics: number;
  trend: number | null;
  date: string;
};

const METRIC_LABELS: Record<string, string> = {
  HRV: 'HRV',
  SLEEP_HOURS: 'Sleep hrs',
  RESTING_HR: 'Resting HR',
  SLEEP_QUALITY: 'Sleep Q',
  SORENESS: 'Soreness',
  STRESS: 'Stress',
  ENERGY: 'Energy',
  MOOD: 'Mood',
};

const METRIC_COLORS: Record<string, 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet'> = {
  HRV: 'cyan',
  SLEEP_HOURS: 'violet',
  RESTING_HR: 'lime',
  SLEEP_QUALITY: 'violet',
  SORENESS: 'magenta',
  STRESS: 'magenta',
  ENERGY: 'amber',
  MOOD: 'amber',
};

function scoreColor(score: number | null): 'lime' | 'cyan' | 'amber' | 'magenta' {
  if (score == null) return 'cyan';
  if (score >= 80) return 'lime';
  if (score >= 60) return 'cyan';
  if (score >= 40) return 'amber';
  return 'magenta';
}

function scoreLabel(score: number | null): string {
  if (score == null) return 'NO DATA';
  if (score >= 80) return 'PRIMED';
  if (score >= 60) return 'READY';
  if (score >= 40) return 'CAUTION';
  return 'DEPLETED';
}

export function RecoveryPanel() {
  const q = useQuery({
    queryKey: ['insights', 'recovery'],
    queryFn: () => api<Recovery>('/insights/recovery'),
  });
  const r = q.data;
  const score = r?.score ?? null;
  const color = scoreColor(score);
  const trend = r?.trend ?? null;
  const trendDelta = score != null && trend != null ? score - trend : null;

  return (
    <Panel variant="lime" title="Recovery" scanline>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div>
            <div className={`font-display text-5xl neon-text-${color} leading-none`}
              style={score != null ? { textShadow: `0 0 12px currentColor, 0 0 24px currentColor` } : undefined}
            >
              {score ?? '—'}
            </div>
            <div className={`text-[10px] font-display tracking-widest mt-1 neon-text-${color}`}>
              {scoreLabel(score)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">7-day avg</div>
            <div className="font-mono text-lg text-ink-100">
              {trend ?? '—'}
            </div>
            {trendDelta != null && Math.abs(trendDelta) >= 1 && (
              <div className={classNames(
                'text-[10px] font-mono mt-0.5',
                trendDelta > 0 ? 'neon-text-lime' : 'neon-text-magenta'
              )}>
                {trendDelta > 0 ? '↑' : '↓'} {Math.abs(trendDelta)} vs avg
              </div>
            )}
          </div>
        </div>

        <div className="text-[10px] font-mono text-ink-300">
          based on {r?.dataPoints ?? 0}/{r?.totalMetrics ?? 8} metrics
        </div>

        <div className="space-y-1.5">
          {(r?.components || []).map((c) => {
            const c_color = METRIC_COLORS[c.metric] || 'cyan';
            const pct = c.subscore ?? 0;
            return (
              <div key={c.metric} className="space-y-0.5">
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className={c.available ? 'text-ink-200' : 'text-ink-400'}>
                    {METRIC_LABELS[c.metric] || c.metric}
                  </span>
                  <span className={c.available ? `neon-text-${c_color}` : 'text-ink-400'}>
                    {c.available ? `${c.subscore}/100` : '—'}
                  </span>
                </div>
                <div className="h-1 bg-bg-700 border border-ink-500/30 overflow-hidden">
                  <div
                    className={classNames(
                      'h-full transition-all duration-700',
                      !c.available && 'opacity-30',
                      c_color === 'cyan' && 'bg-neon-cyan',
                      c_color === 'magenta' && 'bg-neon-magenta',
                      c_color === 'lime' && 'bg-neon-lime',
                      c_color === 'amber' && 'bg-neon-amber',
                      c_color === 'violet' && 'bg-neon-violet'
                    )}
                    style={{ width: `${pct}%`, boxShadow: c.available ? '0 0 4px currentColor' : 'none' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
