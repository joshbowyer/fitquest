import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { localTodayStartUtc } from '@/lib/timezone';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { api } from '@/lib/api';
import { formatSleepOnset } from '@/lib/units';
import { formatAbsolute } from '@/lib/format';
import { useChartColors } from '@/hooks/useChartColors';
import { computeGapBridges } from '@/lib/chartGaps';

type Measurement = {
  id: string;
  metric: string;
  value: number;
  unit: string;
  recordedAt: string;
};

/**
 * 3-line sleep overview: onset (line), quality (line), duration
 * (bars). Reuses the metric block grid style from elsewhere.
 *
 * Onset is a 24h clock wrapped so 11:30pm shows at the right edge
 * of the chart (visually intuitive — late sleep drifts right).
 * Quality is on a 0-10 scale; duration on 0-12h. The chart normalises
 * them onto a shared X-axis (date) with separate Y axes per metric
 * so the visual shape stays consistent even when scales differ.
 *
 * Fetches via the existing `/measurements?metric=X` endpoint.
 */
export function SleepOverviewChart({ days = 30 }: { days?: number }) {
  const { user } = useAuth();
  const userTz = user?.timezone ?? null;
  const onsetsQ = useQuery({
    queryKey: ['measurements', 'SLEEP_ONSET', days],
    queryFn: () =>
      api<{ items: Measurement[] }>(`/measurements?metric=SLEEP_ONSET&limit=200`),
  });
  const hoursQ = useQuery({
    queryKey: ['measurements', 'SLEEP_HOURS', days],
    queryFn: () =>
      api<{ items: Measurement[] }>(`/measurements?metric=SLEEP_HOURS&limit=200`),
  });
  const qualityQ = useQuery({
    queryKey: ['measurements', 'SLEEP_QUALITY', days],
    queryFn: () =>
      api<{ items: Measurement[] }>(`/measurements?metric=SLEEP_QUALITY&limit=200`),
  });

  const chart = useMemo(() => {
    // Per-day pick the LAST entry (newest) — matches the rest of
    // the dashboard's "today's value" semantics for wellness metrics.
    const pickLast = (items: Measurement[]) => {
      const m = new Map<string, Measurement>();
      for (const it of items) {
        const d = it.recordedAt.slice(0, 10);
        const existing = m.get(d);
        if (!existing || existing.recordedAt < it.recordedAt) m.set(d, it);
      }
      return m;
    };

    const onsetMap = pickLast(onsetsQ.data?.items ?? []);
    const hoursMap = pickLast(hoursQ.data?.items ?? []);
    const qualityMap = pickLast(qualityQ.data?.items ?? []);

    /**
     * Wrap post-midnight onset values into a continuous 18-36 scale so
     * 12:20am (0.34) plots AFTER 11:30pm (23.5) on the chart. Without
     * this, the post-midnight value would either fall below the Y-axis
     * domain (18-30) or compress at the bottom edge. Range 18-36 covers
     * 6pm-12pm next day, which is the realistic window of human sleep
     * onset times.
     */
    const wrapOnset = (v: number | null): number | null => {
      if (v == null) return null;
      if (v < 12) return v + 24; // post-midnight → 24-36
      return v;                   // 18-24 stays as-is
    };

    // Build a date axis covering the last `days` days.
    const today = localTodayStartUtc(userTz);
    const out: Array<{
      day: string;
      onset: number | null;
      hours: number | null;
      quality: number | null;
    }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      out.push({
        day: key,
        onset: wrapOnset(onsetMap.get(key)?.value ?? null),
        hours: hoursMap.get(key)?.value ?? null,
        quality: qualityMap.get(key)?.value ?? null,
      });
    }
    return out;
  }, [onsetsQ.data, hoursQ.data, qualityQ.data, days]);

  const isLoading = onsetsQ.isLoading || hoursQ.isLoading || qualityQ.isLoading;

  const colors = useChartColors();

  if (isLoading) {
    return <div className="text-[10px] font-mono text-ink-400">Loading sleep data…</div>;
  }

  return (
    <div className="h-56">
      <ResponsiveContainer>
        <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={colors.grid} strokeDasharray="2 4" />
          <XAxis
            dataKey="day"
            tickFormatter={(d) => {
              const date = new Date(d);
              return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            }}
            tick={{ fill: colors.axisText, fontSize: 10, fontFamily: 'JetBrains Mono' }}
            stroke={colors.grid}
          />
          {/* Onset: continuous 18-36 scale so post-midnight onsets
              (wrapped to 24-36) plot chronologically after evening
              onsets (18-24). Tick formatter unwraps 24-36 → 0-12 for
              label display. */}
          <YAxis
            yAxisId="onset"
            orientation="right"
            domain={[18, 36]}
            ticks={[18, 21, 24, 27, 30, 33, 36]}
            tickFormatter={(v) => {
              // Unwrap 24-36 → 0-12 for label display
              const unwrapped = v >= 24 ? v - 24 : v;
              const h = Math.floor(unwrapped);
              const m = Math.round((unwrapped - h) * 60);
              const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
              const ampm = h < 12 ? 'a' : 'p';
              return `${h12}${m ? `:${m.toString().padStart(2, '0')}` : ''}${ampm}`;
            }}
            tick={{ fill: colors.lime, fontSize: 10, fontFamily: 'JetBrains Mono' }}
            stroke={colors.lime}
            strokeOpacity={0.3}
          />
          {/* Quality: 1-10 scale */}
          <YAxis
            yAxisId="quality"
            orientation="left"
            domain={[0, 10]}
            tick={{ fill: colors.amber, fontSize: 10, fontFamily: 'JetBrains Mono' }}
            stroke={colors.amber}
            strokeOpacity={0.3}
            width={28}
          />
          {/* Duration: 0-12 hours scale on the same left axis, but
              visualised as bars so it doesn't compete with the
              quality line. */}
          <Tooltip
            contentStyle={{
              background: colors.tooltipBg,
              border: `1px solid ${colors.tooltipBorder}`,
              fontFamily: 'JetBrains Mono',
              fontSize: 12,
            }}
            labelStyle={{ color: colors.tooltipText }}
            labelFormatter={(d) => formatAbsolute(d as string)}
            formatter={(value: number, name: string) => {
              if (value == null) return ['—', name];
              if (name === 'Onset') return [formatSleepOnset(value >= 24 ? value - 24 : value), 'Onset'];
              if (name === 'Quality') return [`${value}/10`, 'Quality'];
              return [`${value.toFixed(1)} h`, 'Duration'];
            }}
          />
          <Legend
            verticalAlign="top"
            height={20}
            wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono' }}
            formatter={(v) => <span style={{ color: colors.axisText }}>{v}</span>}
          />
          <Bar
            yAxisId="quality"
            dataKey="hours"
            name="Duration"
            fill={colors.cyan}
            fillOpacity={0.18}
            stroke={colors.cyan}
            strokeOpacity={0.6}
          />
          <Line
            yAxisId="onset"
            type="monotone"
            dataKey="onset"
            name="Onset"
            stroke={colors.lime}
            strokeWidth={2}
            dot={{ r: 2, fill: colors.lime }}
            connectNulls={false}
            style={{ filter: colors.dropShadow('lime', 3) }}
          />
          {/* Dashed bridge across missing days (e.g. a skipped sleep
              log) — connects straight through instead of leaving a
              gap, but stays visually distinct from real logged days. */}
          {computeGapBridges(chart, 'onset').map(([a, b]) => (
            <Line
              key={`onset-gap-${a.day}`}
              yAxisId="onset"
              type="linear"
              data={[a, b]}
              dataKey="onset"
              name="Onset"
              stroke={colors.lime}
              strokeWidth={2}
              strokeDasharray="4 3"
              strokeOpacity={0.6}
              dot={false}
              legendType="none"
              tooltipType="none"
            />
          ))}
          <Line
            yAxisId="quality"
            type="monotone"
            dataKey="quality"
            name="Quality"
            stroke={colors.amber}
            strokeWidth={2}
            dot={{ r: 2, fill: colors.amber }}
            connectNulls={false}
            style={{ filter: colors.dropShadow('amber', 3) }}
          />
          {computeGapBridges(chart, 'quality').map(([a, b]) => (
            <Line
              key={`quality-gap-${a.day}`}
              yAxisId="quality"
              type="linear"
              data={[a, b]}
              dataKey="quality"
              name="Quality"
              stroke={colors.amber}
              strokeWidth={2}
              strokeDasharray="4 3"
              strokeOpacity={0.6}
              dot={false}
              legendType="none"
              tooltipType="none"
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
