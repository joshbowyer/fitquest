import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { api } from '@/lib/api';
import { convertForDisplay, displayUnit, type UnitSystem } from '@/lib/units';

// One row per day from GET /meals/trend?days=N (oldest-first,
// contiguous, zero-filled). Mirrors the API's response shape.
type TrendDay = {
  day: string; // YYYY-MM-DD
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  waterMl: number;
  mealCount: number;
};

type MetricKey = 'calories' | 'proteinG' | 'carbG' | 'fatG' | 'waterMl';

// Metric metadata: label, data key, stored unit (null = unitless
// count like calories/grams that we render as-is), and line color.
const METRICS: Record<
  MetricKey,
  { label: string; short: string; unit: string | null; color: string }
> = {
  calories: { label: 'Calories', short: 'cal', unit: null, color: '#ffaa3a' },
  proteinG: { label: 'Protein', short: 'g', unit: null, color: '#f55cc4' },
  carbG: { label: 'Carbs', short: 'g', unit: null, color: '#14d6e8' },
  fatG: { label: 'Fat', short: 'g', unit: null, color: '#9a6cf2' },
  waterMl: { label: 'Water', short: 'ml', unit: 'ml', color: '#56e88e' },
};

const DAY_OPTIONS = [7, 14, 30] as const;

type Props = {
  system: UnitSystem;
  /** Display height in px. */
  height?: number;
};

/**
 * NutritionTrendChart — per-day nutrition totals over the last N days.
 *
 * Fetches GET /meals/trend?days=N (per-day rollups of the meal log +
 * WATER_ML measurements, timezone-aware and zero-filled so the x-axis
 * is contiguous). The user picks which metric to plot (calories /
 * protein / carbs / fat / water) and the window (7/14/30 days). Water
 * is converted to the user's unit system for display; the macros are
 * grams/calories and render as-is.
 */
export function NutritionTrendChart({ system, height = 180 }: Props) {
  const [metric, setMetric] = useState<MetricKey>('calories');
  const [days, setDays] = useState<number>(14);

  const q = useQuery({
    queryKey: ['meals', 'trend', days],
    queryFn: () => api<{ days: TrendDay[] }>('/meals/trend', { query: { days } }),
    // Keep in step with the daily totals bar / meal log.
    refetchInterval: 60_000,
  });

  const meta = METRICS[metric];

  const chart = useMemo(() => {
    const rows = q.data?.days ?? [];
    const data = rows.map((r) => {
      const raw = r[metric];
      const shown =
        meta.unit != null
          ? convertForDisplay(raw, meta.unit as any, system).value
          : raw;
      return {
        ts: new Date(`${r.day}T00:00:00Z`).getTime(),
        label: r.day,
        value: Math.round(shown * 10) / 10,
        mealCount: r.mealCount,
      };
    });
    const unitLabel =
      meta.unit != null ? displayUnit(meta.unit as any, system) : meta.short;
    const total = data.reduce((s, d) => s + (d.value ?? 0), 0);
    const loggedDays = data.filter((d) => d.value > 0).length;
    const avg = loggedDays > 0 ? total / loggedDays : 0;
    return { data, unitLabel, avg, loggedDays };
  }, [q.data, metric, meta, system]);

  const formatTick = (ts: number) => {
    const d = new Date(ts);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };

  return (
    <div>
      {/* Controls: metric chips + day-range chips */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-1">
          {(Object.keys(METRICS) as MetricKey[]).map((k) => {
            const m = METRICS[k];
            const active = k === metric;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setMetric(k)}
                className={
                  'px-2 py-1 text-[10px] font-mono uppercase tracking-wider border transition-colors ' +
                  (active
                    ? 'text-bg-900 font-bold'
                    : 'text-ink-300 border-ink-500/30 hover:border-ink-300/50')
                }
                style={
                  active
                    ? { background: m.color, borderColor: m.color }
                    : undefined
                }
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={
                'px-2 py-1 text-[10px] font-mono border transition-colors ' +
                (d === days
                  ? 'text-neon-cyan border-neon-cyan/60'
                  : 'text-ink-400 border-ink-500/30 hover:border-ink-300/50')
              }
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary line: average per logged day */}
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[10px] font-mono text-ink-300 tracking-widest uppercase">
          {meta.label} · last {days} days
        </div>
        <div className="text-[11px] font-mono" style={{ color: meta.color }}>
          avg {chart.avg.toFixed(chart.avg < 10 ? 1 : 0)} {chart.unitLabel}
          <span className="text-[9px] text-ink-400 ml-1">
            · {chart.loggedDays} logged {chart.loggedDays === 1 ? 'day' : 'days'}
          </span>
        </div>
      </div>

      {q.isLoading ? (
        <div
          className="border border-ink-500/30 bg-bg-800/40 flex items-center justify-center text-[10px] font-mono text-ink-400"
          style={{ height }}
        >
          loading…
        </div>
      ) : chart.loggedDays === 0 ? (
        <div
          className="border border-dashed border-ink-700/40 flex items-center justify-center text-center text-[10px] font-mono text-ink-400 px-4"
          style={{ height }}
        >
          No meals logged in this window. Track food over time to see trends.
        </div>
      ) : (
        <div style={{ width: '100%', height }}>
          <ResponsiveContainer>
            <AreaChart
              data={chart.data}
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id="fill-nutrition" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={meta.color} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={meta.color} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="#3a3d4a"
                strokeDasharray="2 4"
                vertical={false}
              />
              <XAxis
                dataKey="ts"
                tickFormatter={formatTick}
                stroke="#787888"
                tick={{ fontSize: 9, fontFamily: 'monospace' }}
                interval="preserveStartEnd"
                minTickGap={20}
              />
              <YAxis
                stroke="#787888"
                tick={{ fontSize: 9, fontFamily: 'monospace' }}
                width={36}
                domain={[0, 'auto']}
              />
              <Tooltip
                contentStyle={{
                  background: '#0e0f1a',
                  border: `1px solid ${meta.color}66`,
                  fontFamily: 'monospace',
                  fontSize: 11,
                }}
                labelFormatter={(ts) =>
                  new Date(Number(ts)).toISOString().slice(0, 10)
                }
                formatter={(value: any) => [
                  `${value} ${chart.unitLabel}`,
                  meta.label,
                ]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={meta.color}
                strokeWidth={1.5}
                fill="url(#fill-nutrition)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
