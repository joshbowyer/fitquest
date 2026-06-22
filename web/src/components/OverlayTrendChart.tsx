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
import { convertForDisplay, formatInUnits } from '@/lib/units';
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
 *
 * Values are converted from the base metric unit (kg, ms, h) into
 * the user's chosen unit system before plotting, so the Y axis and
 * line always reflect the user's preferred units. This was a bug
 * where imperial users saw kg values on the Y axis but lb in the
 * tooltip — visually identical numbers, mismatched meaning.
 */
export function OverlayTrendChart({ days, units, series, history }: Props) {
  // Convert raw history values once per render. Recharts only sees
  // the converted numbers, so the line, Y axis, and tooltip all agree.
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
        // Convert from base unit to user's display unit. Recharts then
        // plots this single number, so the Y axis and the line are
        // both in display units and the tooltip formatter can pass
        // through unchanged.
        const s = series.find((x) => x.metric === h.metric);
        const baseUnit = s?.unit ?? '';
        const conv = convertForDisplay(h.value, baseUnit as any, units);
        byDate[key][h.metric] = conv.value;
      }
    }
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date, ...vals }));
  }, [days, history, series, units]);

  // Map each series to its display-unit label so the legend and
  // tooltip can show "Weight · lb" instead of "Weight · kg" in
  // imperial mode.
  const seriesWithDisplayUnit = useMemo(
    () => series.map((s) => ({ ...s, displayUnit: convertForDisplay(0, s.unit as any, units).unit })),
    [series, units],
  );

  const leftSeries = seriesWithDisplayUnit.filter((s) => s.yAxis === 'left');
  const rightSeries = seriesWithDisplayUnit.filter((s) => s.yAxis === 'right');

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
            // value is already in display units; format with the
            // series' display-unit label.
            const s = seriesWithDisplayUnit.find((x) => x.metric === name);
            if (!s) return [`${Math.round(value * 10) / 10}`, name];
            return [`${Math.round(value * 10) / 10} ${s.displayUnit}`, s.label];
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 10 }}
          formatter={(name) => {
            const s = seriesWithDisplayUnit.find((x) => x.metric === name);
            return s ? `${s.label} (${s.displayUnit})` : name;
          }}
        />
        {seriesWithDisplayUnit.map((s) => (
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
