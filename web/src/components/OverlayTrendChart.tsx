import { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { formatInUnits } from '@/lib/units';
import type { UnitSystem, MetricType } from '@/lib/types';

type Series = {
  metric: MetricType;
  color: string;
  label: string;
  unit: string; // base metric unit ('ms', 'h', etc.)
  yAxis: 'left' | 'right';
};

type Props = {
  /** All series must share the same time window. */
  days: number;
  units: UnitSystem;
  series: Series[];
  // API data: array of { recordedAt, metric, value }
  history: Array<{ recordedAt: string; metric: string; value: number }>;
};

/**
 * Multi-series time-series overlay for the /insights deep-dive page.
 * Renders up to 2-3 metrics on the same time axis with dual Y axes,
 * so the user can see "HRV dropping while training volume rises"
 * patterns at a glance.
 *
 * Time bucketing: one point per day. If a metric is logged multiple
 * times on the same day, the last value wins.
 */
export function OverlayTrendChart({ days, units, series, history }: Props) {
  const data = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {};
    // Pre-fill empty days so the X axis is continuous.
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      byDate[key] = {};
    }
    // History comes newest-first from the API. For each day, keep the
    // first occurrence (which is the latest) so duplicates collapse.
    for (const h of history) {
      const key = h.recordedAt.slice(0, 10);
      if (!byDate[key]) byDate[key] = {};
      if (byDate[key][h.metric] === undefined) {
        byDate[key][h.metric] = h.value;
      }
    }
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date, ...vals }));
  }, [days, history]);

  const leftSeries = series.filter((s) => s.yAxis === 'left');
  const rightSeries = series.filter((s) => s.yAxis === 'right');

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#374151" strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 9, fill: '#94a3b8' }}
          tickFormatter={(d) => d.slice(5)}
          interval={Math.max(1, Math.floor(days / 8))}
        />
        {leftSeries.length > 0 && (
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 9, fill: '#94a3b8' }}
            width={36}
            orientation="left"
          />
        )}
        {rightSeries.length > 0 && (
          <YAxis
            yAxisId="right"
            tick={{ fontSize: 9, fill: '#94a3b8' }}
            width={36}
            orientation="right"
          />
        )}
        <Tooltip
          contentStyle={{
            background: '#0f172a',
            border: '1px solid #374151',
            fontSize: 11,
          }}
          labelStyle={{ color: '#cbd5e1' }}
          formatter={(value: number, name: string) => {
            const s = series.find((x) => x.metric === name);
            if (!s) return [value, name];
            return [formatInUnits(value, s.unit, units), s.label];
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 10 }}
          formatter={(name) => {
            const s = series.find((x) => x.metric === name);
            return s ? s.label : name;
          }}
        />
        {series.map((s) => (
          <Line
            key={s.metric}
            yAxisId={s.yAxis}
            type="monotone"
            dataKey={s.metric}
            stroke={s.color}
            strokeWidth={1.5}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
