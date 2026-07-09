import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Area,
  AreaChart,
} from 'recharts';
import { api } from '@/lib/api';
import { convertForDisplay, displayUnit, type UnitSystem } from '@/lib/units';
import { formatAbsolute } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useChartColors } from '@/hooks/useChartColors';

type Measurement = {
  id: string;
  metric: string;
  value: number;
  unit: string;
  notes: string | null;
  recordedAt: string;
};

type Props = {
  metric: 'HRV' | 'SLEEP_HOURS' | 'SLEEP_QUALITY';
  /** Days of history to fetch. */
  days?: number;
  /** Display height in px. */
  height?: number;
  /** Color for the area fill + line stroke. */
  color?: string;
  /** Use area fill (default true) or plain line. */
  area?: boolean;
  system: UnitSystem;
  /** Show the X axis labels (default true). */
  showAxis?: boolean;
};

/**
 * MetricTrendChart — small area/line chart of a single metric over
 * the last N days. Reusable across Insights / Recovery / Dashboard.
 *
 * Hits the existing `/measurements?metric=X&limit=N` endpoint and
 * buckets samples by day. Fills missing days with `null` so the
 * line shows gaps instead of connecting across them.
 */
export function MetricTrendChart({
  metric,
  days = 30,
  height = 140,
  color,
  area = true,
  system,
  showAxis = true,
}: Props) {
  const colors = useChartColors();
  const lineColor = color || colors.cyan;
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['measurements', metric, days],
    queryFn: () =>
      api<{ items: Measurement[] }>(`/measurements?metric=${metric}&limit=200`),
  });

  const chart = useMemo(() => {
    const items = q.data?.items ?? [];
    if (items.length === 0) return { data: [] as any[], latest: null as Measurement | null };

    // Compute the unit we'll display in (converting from stored metric
    // units if the user prefers imperial).
    const sample = items[0];
    const disp = convertForDisplay(sample.value, sample.unit as any, system);
    const unitLabel = displayUnit(sample.unit as any, system);

    // Bucket per day. Keep the latest sample per day so the line
    // reflects "today's number" rather than averaging across.
    const byDay = new Map<string, Measurement>();
    for (const it of items) {
      const d = it.recordedAt.slice(0, 10); // YYYY-MM-DD
      const existing = byDay.get(d);
      if (!existing || existing.recordedAt < it.recordedAt) byDay.set(d, it);
    }

    // Fill every day in the window so gaps render as nulls (no line).
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const series: Array<{ ts: number; label: string; v: number | null; disp: number | null }> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      const hit = byDay.get(key);
      if (hit) {
        const v = convertForDisplay(hit.value, hit.unit as any, system);
        series.push({
          ts: d.getTime(),
          label: key,
          v: hit.value,
          disp: Math.round(v.value * 100) / 100,
        });
      } else {
        series.push({ ts: d.getTime(), label: key, v: null, disp: null });
      }
    }

    return {
      data: series,
      latest: sample,
      unitLabel,
    };
  }, [q.data, system, days]);

  if (q.isLoading) {
    return (
      <div
        className="border border-ink-500/30 bg-bg-800/40 flex items-center justify-center text-[10px] font-mono text-ink-400"
        style={{ height }}
      >
        loading…
      </div>
    );
  }

  if (chart.data.length === 0 || q.data?.items.length === 0) {
    return (
      <div
        className="border border-dashed border-ink-700/40 flex items-center justify-center text-[10px] font-mono text-ink-400"
        style={{ height }}
      >
        No {labelFor(metric)} logs yet. Track over time to see trends.
      </div>
    );
  }

  const latest = q.data!.items[0];
  const disp = convertForDisplay(latest.value, latest.unit as any, system);
  const formatTick = (ts: number) => {
    const d = new Date(ts);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[10px] font-mono text-ink-300 tracking-widest uppercase">
          {labelFor(metric)}
        </div>
        <div className="text-[11px] font-mono" style={{ color: lineColor }}>
          {disp.value.toFixed(disp.value < 10 ? 1 : 0)} {disp.unit}
          <span className="text-[9px] text-ink-400 ml-1">
            · {formatAbsolute(latest.recordedAt, user?.timezone ?? null).slice(0, 10)}
          </span>
        </div>
      </div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          {area ? (
            <AreaChart data={chart.data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={colors.grid} strokeDasharray="2 4" vertical={false} />
              {showAxis && (
                <XAxis
                  dataKey="ts"
                  tickFormatter={formatTick}
                  stroke={colors.grid}
                  tick={{ fontSize: 9, fontFamily: 'monospace' }}
                  interval="preserveStartEnd"
                  minTickGap={20}
                />
              )}
              {showAxis && (
                <YAxis
                  stroke={colors.grid}
                  tick={{ fontSize: 9, fontFamily: 'monospace' }}
                  width={32}
                  domain={['auto', 'auto']}
                />
              )}
              <Tooltip
                contentStyle={{
                  background: colors.tooltipBg,
                  border: `1px solid ${colors.tooltipBorder}`,
                  fontFamily: 'monospace',
                  fontSize: 11,
                }}
                labelFormatter={(ts) => new Date(Number(ts)).toISOString().slice(0, 10)}
                formatter={(value: any) => (value == null ? ['—', metric] : [value, metric])}
              />
              <Area
                type="monotone"
                dataKey="disp"
                stroke={lineColor}
                strokeWidth={1.5}
                fill={`url(#fill-${metric})`}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            </AreaChart>
          ) : (
            <LineChart data={chart.data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="2 4" vertical={false} />
              {showAxis && (
                <XAxis
                  dataKey="ts"
                  tickFormatter={formatTick}
                  stroke={colors.grid}
                  tick={{ fontSize: 9, fontFamily: 'monospace' }}
                  interval="preserveStartEnd"
                  minTickGap={20}
                />
              )}
              {showAxis && (
                <YAxis stroke={colors.grid} tick={{ fontSize: 9, fontFamily: 'monospace' }} width={32} />
              )}
              <Tooltip
                contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, fontFamily: 'monospace', fontSize: 11 }}
                labelFormatter={(ts) => new Date(Number(ts)).toISOString().slice(0, 10)}
              />
              <Line type="monotone" dataKey="disp" stroke={lineColor} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function labelFor(metric: string): string {
  switch (metric) {
    case 'HRV': return 'Heart Rate Variability';
    case 'SLEEP_HOURS': return 'Sleep';
    case 'SLEEP_QUALITY': return 'Sleep quality';
    default: return metric;
  }
}