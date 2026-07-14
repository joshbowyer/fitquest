import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { localTodayStartUtc } from '@/lib/timezone';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceArea,
} from 'recharts';
import { api } from '@/lib/api';
import { formatAbsolute, formatDate } from '@/lib/format';
import { useChartColors } from '@/hooks/useChartColors';
import { computeGapBridges } from '@/lib/chartGaps';

type Measurement = {
  id: string;
  metric: string;
  value: number;
  unit: string;
  recordedAt: string;
};

type SubstanceLog = {
  id: string;
  category: 'CAFFEINE' | 'ALCOHOL' | 'NICOTINE' | 'ELECTROLYTE';
  form: string;
  loggedAt: string;
};

type Props = {
  /** Days of history to fetch. */
  days?: number;
  /** Variant picks which overlay to render:
   *  - 'overview'  : BB alone (last N days) — the basic trend
   *  - 'onset'     : BB + sleep onset (right axis: clock time)
   *  - 'duration'  : BB + sleep hours (right axis)
   *  - 'quality'   : BB + sleep quality (right axis)
   *  - 'substances': BB + alcohol/caffeine event dots (right axis)
   */
  variant?: 'overview' | 'onset' | 'duration' | 'quality' | 'substances';
};

/**
 * Body Battery chart, multiple variants. Always renders BB on the
 * left axis (0-100); overlays another series on the right axis
 * depending on the variant. Substances variant uses Scatter dots
 * (one per event) coloured by category.
 *
 * Reuses /measurements and /substances endpoints — no new backend
 * work needed.
 */
export function BodyBatteryChart({ days = 30, variant = 'overview' }: Props) {
  const { user } = useAuth();
  const userTz = user?.timezone ?? null;
  const bbQ = useQuery({
    queryKey: ['measurements', 'BODY_BATTERY', days],
    queryFn: () => api<{ items: Measurement[] }>(`/measurements?metric=BODY_BATTERY&limit=200`),
  });
  const onsetQ = useQuery({
    queryKey: ['measurements', 'SLEEP_ONSET', days],
    queryFn: () => api<{ items: Measurement[] }>(`/measurements?metric=SLEEP_ONSET&limit=200`),
    enabled: variant === 'onset',
  });
  const hoursQ = useQuery({
    queryKey: ['measurements', 'SLEEP_HOURS', days],
    queryFn: () => api<{ items: Measurement[] }>(`/measurements?metric=SLEEP_HOURS&limit=200`),
    enabled: variant === 'duration' || variant === 'overview',
  });
  const qualityQ = useQuery({
    queryKey: ['measurements', 'SLEEP_QUALITY', days],
    queryFn: () => api<{ items: Measurement[] }>(`/measurements?metric=SLEEP_QUALITY&limit=200`),
    enabled: variant === 'quality',
  });
  const subQ = useQuery({
    queryKey: ['substances', days, variant],
    queryFn: () => api<{ items: SubstanceLog[] }>(`/substances?limit=200`),
    enabled: variant === 'substances',
  });

  const chart = useMemo(() => {
    // Per-day pick the LATEST BB row (Garmin can write multiple
    // times per day; we want the latest).
    const pickLast = (items: Measurement[]) => {
      const m = new Map<string, Measurement>();
      for (const it of items) {
        const d = it.recordedAt.slice(0, 10);
        const existing = m.get(d);
        if (!existing || existing.recordedAt < it.recordedAt) m.set(d, it);
      }
      return m;
    };
    const bbMap = pickLast(bbQ.data?.items ?? []);
    const onsetMap = pickLast(onsetQ.data?.items ?? []);
    const hoursMap = pickLast(hoursQ.data?.items ?? []);
    const qualityMap = pickLast(qualityQ.data?.items ?? []);

    // Build a date axis covering the last `days` days.
    const today = localTodayStartUtc(userTz);
    const out: Array<{
      day: string;
      bb: number | null;
      onset: number | null;
      hours: number | null;
      quality: number | null;
      alcoholDot: number | null;
      caffeineDot: number | null;
      nicotineDot: number | null;
    }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      out.push({
        day: key,
        bb: bbMap.get(key)?.value ?? null,
        onset: onsetMap.get(key)?.value ?? null,
        hours: hoursMap.get(key)?.value ?? null,
        quality: qualityMap.get(key)?.value ?? null,
        alcoholDot: null,
        caffeineDot: null,
        nicotineDot: null,
      });
    }

    if (variant === 'substances' && subQ.data) {
      // For each substance log, plot a dot on the day it happened
      // at a Y value mapped to a "presence" column. We use a single
      // BB-height column (e.g. alcohol at 80, caffeine at 60,
      // nicotine at 40) so categories are visually separable.
      for (const s of subQ.data.items) {
        const key = s.loggedAt.slice(0, 10);
        const row = out.find((r) => r.day === key);
        if (!row) continue;
        if (s.category === 'ALCOHOL') row.alcoholDot = 80;
        else if (s.category === 'CAFFEINE') row.caffeineDot = 60;
        else if (s.category === 'NICOTINE') row.nicotineDot = 40;
      }
    }

    return out;
  }, [
    bbQ.data,
    onsetQ.data,
    hoursQ.data,
    qualityQ.data,
    subQ.data,
    days,
    variant,
  ]);

  const isLoading =
    bbQ.isLoading ||
    (variant === 'onset' && onsetQ.isLoading) ||
    ((variant === 'duration' || variant === 'overview') && hoursQ.isLoading) ||
    (variant === 'quality' && qualityQ.isLoading) ||
    (variant === 'substances' && subQ.isLoading);

  const colors = useChartColors();

  if (isLoading) {
    return <div className="text-[10px] font-mono text-ink-400">Loading body battery data…</div>;
  }
  const hasAnyData = chart.some((d) => d.bb != null);
  if (!hasAnyData) {
    return (
      <div className="text-[10px] font-mono text-ink-400 italic">
        No BODY_BATTERY readings in the last {days} days.
        Log your morning Garmin reading on the{' '}
        <a className="text-neon-cyan underline" href="/measurements">/measurements</a>{' '}
        page to start seeing this chart.
      </div>
    );
  }

  return (
    <div className="h-56">
      <ResponsiveContainer>
        <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={colors.grid} strokeDasharray="2 4" />
          <XAxis
            dataKey="day"
            tickFormatter={(d) => formatDate(d)}
            tick={{ fill: colors.axisText, fontSize: 10, fontFamily: 'JetBrains Mono' }}
            stroke={colors.grid}
          />
          <YAxis
            yAxisId="bb"
            orientation="left"
            domain={[0, 100]}
            tick={{ fill: colors.lime, fontSize: 10, fontFamily: 'JetBrains Mono' }}
            stroke={colors.lime}
            strokeOpacity={0.3}
            width={28}
          />
          {/* Right-axis per variant */}
          {variant === 'onset' && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[18, 30]}
              ticks={[18, 21, 24, 27, 30]}
              tickFormatter={(v) => {
                const h = Math.floor(v);
                const m = Math.round((v - h) * 60);
                const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                const ampm = h < 12 ? 'a' : 'p';
                return `${h12}${m ? `:${m.toString().padStart(2, '0')}` : ''}${ampm}`;
              }}
              tick={{ fill: colors.cyan, fontSize: 10, fontFamily: 'JetBrains Mono' }}
              stroke={colors.cyan}
              strokeOpacity={0.3}
            />
          )}
          {variant === 'duration' && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 12]}
              tick={{ fill: colors.cyan, fontSize: 10, fontFamily: 'JetBrains Mono' }}
              stroke={colors.cyan}
              strokeOpacity={0.3}
            />
          )}
          {variant === 'quality' && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 10]}
              tick={{ fill: colors.amber, fontSize: 10, fontFamily: 'JetBrains Mono' }}
              stroke={colors.amber}
              strokeOpacity={0.3}
            />
          )}
          {variant === 'substances' && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              tick={false}
              axisLine={false}
            />
          )}

          {/* Optional shaded "drained" zone (BB < 30). */}
          {variant === 'overview' && (
            <ReferenceArea
              yAxisId="bb"
              y1={0}
              y2={30}
              fill={colors.magenta}
              fillOpacity={0.04}
              stroke="none"
            />
          )}

          <Tooltip
            contentStyle={{
              background: colors.tooltipBg,
              border: `1px solid ${colors.tooltipBorder}`,
              fontFamily: 'JetBrains Mono',
              fontSize: 12,
            }}
            labelStyle={{ color: colors.tooltipText }}
            labelFormatter={(d) => formatAbsolute(d as string)}
            // typed `number` (not `number | null`) to satisfy recharts' TValue constraint; runtime null guard below still applies
            formatter={(value: number, name: string) => {
              if (value == null) return ['—', name];
              if (name === 'BB') return [`${Math.round(value)}/100`, 'Body Battery'];
              if (name === 'Onset') {
                const h = Math.floor(value);
                const m = Math.round((value - h) * 60);
                const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                const ampm = h < 12 ? 'am' : 'pm';
                return [`${h12}${m ? `:${m.toString().padStart(2, '0')}` : ''} ${ampm}`, 'Onset'];
              }
              if (name === 'Hours') return [`${value.toFixed(1)} h`, 'Sleep'];
              if (name === 'Quality') return [`${value}/10`, 'Quality'];
              return [String(value), name];
            }}
          />
          <Legend
            verticalAlign="top"
            height={20}
            wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono' }}
            formatter={(v) => <span style={{ color: colors.axisText }}>{v}</span>}
          />

          {/* BB line — always */}
          <Line
            yAxisId="bb"
            type="monotone"
            dataKey="bb"
            name="BB"
            stroke={colors.lime}
            strokeWidth={2}
            dot={{ r: 2, fill: colors.lime }}
            connectNulls={false}
            style={{ filter: colors.dropShadow('lime', 3) }}
          />
          {/* Dashed bridge across missing days — connects straight
              through instead of leaving a gap, but stays visually
              distinct (extra-dashed / dimmer) from real logged days. */}
          {computeGapBridges(chart, 'bb').map(([a, b]) => (
            <Line
              key={`bb-gap-${a.day}`}
              yAxisId="bb"
              type="linear"
              data={[a, b]}
              dataKey="bb"
              name="BB"
              stroke={colors.lime}
              strokeWidth={2}
              strokeDasharray="4 3"
              strokeOpacity={0.6}
              dot={false}
              legendType="none"
              tooltipType="none"
            />
          ))}

          {/* Overlay line per variant */}
          {variant === 'onset' && (
            <>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="onset"
                name="Onset"
                stroke={colors.cyan}
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 2"
                connectNulls={false}
              />
              {computeGapBridges(chart, 'onset').map(([a, b]) => (
                <Line
                  key={`onset-gap-${a.day}`}
                  yAxisId="right"
                  type="linear"
                  data={[a, b]}
                  dataKey="onset"
                  name="Onset"
                  stroke={colors.cyan}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  strokeOpacity={0.6}
                  dot={false}
                  legendType="none"
                  tooltipType="none"
                />
              ))}
            </>
          )}
          {variant === 'duration' && (
            <>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="hours"
                name="Hours"
                stroke={colors.cyan}
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 2"
                connectNulls={false}
              />
              {computeGapBridges(chart, 'hours').map(([a, b]) => (
                <Line
                  key={`hours-gap-${a.day}`}
                  yAxisId="right"
                  type="linear"
                  data={[a, b]}
                  dataKey="hours"
                  name="Hours"
                  stroke={colors.cyan}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  strokeOpacity={0.6}
                  dot={false}
                  legendType="none"
                  tooltipType="none"
                />
              ))}
            </>
          )}
          {variant === 'quality' && (
            <>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="quality"
                name="Quality"
                stroke={colors.amber}
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 2"
                connectNulls={false}
              />
              {computeGapBridges(chart, 'quality').map(([a, b]) => (
                <Line
                  key={`quality-gap-${a.day}`}
                  yAxisId="right"
                  type="linear"
                  data={[a, b]}
                  dataKey="quality"
                  name="Quality"
                  stroke={colors.amber}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  strokeOpacity={0.6}
                  dot={false}
                  legendType="none"
                  tooltipType="none"
                />
              ))}
            </>
          )}
          {variant === 'substances' && (
            <>
              <Scatter
                yAxisId="right"
                dataKey="alcoholDot"
                name="Alcohol"
                fill={colors.magenta}
                line={false}
                shape="circle"
              />
              <Scatter
                yAxisId="right"
                dataKey="caffeineDot"
                name="Caffeine"
                fill={colors.cyan}
                line={false}
                shape="triangle"
              />
              <Scatter
                yAxisId="right"
                dataKey="nicotineDot"
                name="Nicotine"
                fill={colors.amber}
                line={false}
                shape="diamond"
              />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
