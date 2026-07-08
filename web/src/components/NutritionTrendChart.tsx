import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { api } from '@/lib/api';
import { convertForDisplay, displayUnit, type UnitSystem } from '@/lib/units';
import { classNames } from '@/lib/format';

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

// Metric metadata: label, stored unit (null = render as-is, e.g.
// calories/grams), line color, and which Y axis it plots against.
// Calories + water are big numbers (~2000) so they share the LEFT
// axis; the macros are grams (~100-300) so they share the RIGHT
// axis — otherwise calories would flatten the macro lines into the
// baseline.
const METRICS: Record<
  MetricKey,
  {
    label: string;
    short: string;
    unit: string | null;
    color: string;
    axis: 'left' | 'right';
  }
> = {
  calories: { label: 'Calories', short: 'cal', unit: null, color: '#ffaa3a', axis: 'left' },
  waterMl: { label: 'Water', short: 'ml', unit: 'ml', color: '#56e88e', axis: 'left' },
  proteinG: { label: 'Protein', short: 'g', unit: null, color: '#f55cc4', axis: 'right' },
  carbG: { label: 'Carbs', short: 'g', unit: null, color: '#14d6e8', axis: 'right' },
  fatG: { label: 'Fat', short: 'g', unit: null, color: '#9a6cf2', axis: 'right' },
};

const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];
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
 * is contiguous). All metrics are shown as toggleable lines (all on by
 * default), mirroring the substance + activity-stream charts. Calories
 * and water plot on the left Y axis; the macros (grams) plot on the
 * right — different scales would otherwise flatten the macro lines.
 * Water is converted to the user's unit system for display.
 */
export function NutritionTrendChart({ system, height = 220 }: Props) {
  const [active, setActive] = useState<Set<MetricKey>>(new Set(METRIC_KEYS));
  const [days, setDays] = useState<number>(14);

  const q = useQuery({
    queryKey: ['meals', 'trend', days],
    queryFn: () => api<{ days: TrendDay[] }>('/meals/trend', { query: { days } }),
    // Keep in step with the daily totals bar / meal log.
    refetchInterval: 60_000,
  });

  const chart = useMemo(() => {
    const rows = q.data?.days ?? [];
    const data = rows.map((r) => {
      const row: Record<string, number | string> = {
        ts: new Date(`${r.day}T00:00:00Z`).getTime(),
        label: r.day,
        mealCount: r.mealCount,
      };
      for (const k of METRIC_KEYS) {
        const meta = METRICS[k];
        const raw = r[k];
        const shown =
          meta.unit != null
            ? convertForDisplay(raw, meta.unit as any, system).value
            : raw;
        row[k] = Math.round(shown * 10) / 10;
      }
      return row;
    });
    // Any nutrition logged in the window at all?
    const hasData = data.some((d) =>
      METRIC_KEYS.some((k) => (d[k] as number) > 0),
    );
    return { data, hasData };
  }, [q.data, system]);

  const unitLabelFor = (k: MetricKey) => {
    const meta = METRICS[k];
    return meta.unit != null ? displayUnit(meta.unit as any, system) : meta.short;
  };

  const toggle = (k: MetricKey) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const formatTick = (ts: number) => {
    const d = new Date(ts);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };

  return (
    <div className="space-y-2">
      {/* Controls: metric toggles + day-range chips */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {METRIC_KEYS.map((k) => {
            const meta = METRICS[k];
            const isOn = active.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggle(k)}
                className={classNames(
                  'px-2 py-0.5 text-[9px] font-mono tracking-widest uppercase border transition-all',
                  isOn
                    ? 'border-current'
                    : 'border-ink-500/30 text-ink-400 hover:text-ink-200',
                )}
                style={isOn ? { color: meta.color } : undefined}
              >
                {meta.label}
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
              className={classNames(
                'px-2 py-0.5 text-[9px] font-mono border transition-colors',
                d === days
                  ? 'text-neon-cyan border-neon-cyan/60'
                  : 'text-ink-400 border-ink-500/30 hover:text-ink-200',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div
          className="border border-ink-500/30 bg-bg-800/40 flex items-center justify-center text-[10px] font-mono text-ink-400"
          style={{ height }}
        >
          loading…
        </div>
      ) : !chart.hasData ? (
        <div
          className="border border-dashed border-ink-700/40 flex items-center justify-center text-center text-[10px] font-mono text-ink-400 px-4"
          style={{ height }}
        >
          No meals logged in this window. Track food over time to see trends.
        </div>
      ) : (
        <div style={{ width: '100%', height }}>
          <ResponsiveContainer>
            <LineChart
              data={chart.data}
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            >
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
              {/* Left axis: calories + water (large values) */}
              <YAxis
                yAxisId="left"
                stroke="#787888"
                tick={{ fontSize: 9, fontFamily: 'monospace' }}
                width={40}
                domain={[0, 'auto']}
              />
              {/* Right axis: macros in grams (small values) */}
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#787888"
                tick={{ fontSize: 9, fontFamily: 'monospace' }}
                width={32}
                domain={[0, 'auto']}
              />
              <Tooltip
                contentStyle={{
                  background: '#0e0f1a',
                  border: '1px solid rgba(20,214,232,0.4)',
                  fontFamily: 'monospace',
                  fontSize: 11,
                }}
                labelFormatter={(ts) =>
                  new Date(Number(ts)).toISOString().slice(0, 10)
                }
                formatter={(value: any, _name: string, entry: any) => {
                  const k = entry?.dataKey as MetricKey;
                  const unit = k ? unitLabelFor(k) : '';
                  return [`${value} ${unit}`, METRICS[k]?.label ?? _name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'monospace' }} />
              {METRIC_KEYS.map((k) => {
                if (!active.has(k)) return null;
                const meta = METRICS[k];
                return (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={k}
                    name={meta.label}
                    stroke={meta.color}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                    yAxisId={meta.axis}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
