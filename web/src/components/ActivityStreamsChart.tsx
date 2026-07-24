import { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useChartColors } from '@/hooks/useChartColors';

export type StreamPoint = {
  t: number;
  lat: number | null;
  lon: number | null;
  ele: number | null;
  hr: number | null;
  cad: number | null;
  pwr: number | null;
  spd: number | null;
  dist: number | null;
};

type StreamKey = 'pace' | 'hr' | 'ele' | 'cad' | 'pwr';

type Props = {
  points: StreamPoint[];
  system: 'METRIC' | 'IMPERIAL';
  /** Display height per mini-chart in px. */
  height?: number;
};

type SeriesMeta = { label: string; color: string; unit: string };

const SERIES_META_STATIC: Record<StreamKey, Omit<SeriesMeta, 'color'>> = {
  pace: { label: 'Pace',       unit: 'min/mi' },
  hr:   { label: 'Heart Rate', unit: 'bpm' },
  ele:  { label: 'Elevation',  unit: 'm' }, // adjusted per system at render time
  cad:  { label: 'Cadence',    unit: 'spm' },
  pwr:  { label: 'Power',      unit: 'W' },
};

const DISPLAY_ORDER: StreamKey[] = ['pace', 'hr', 'ele', 'cad', 'pwr'];

type ChartRow = Record<string, number | null | number>;

export function ActivityStreamsChart({ points, system, height = 100 }: Props) {
  const colors = useChartColors();

  const SERIES_META: Record<StreamKey, SeriesMeta> = {
    pace: { ...SERIES_META_STATIC.pace, color: colors.cyan, unit: system === 'IMPERIAL' ? 'min/mi' : 'min/km' },
    hr:   { ...SERIES_META_STATIC.hr,   color: colors.magenta },
    ele:  { ...SERIES_META_STATIC.ele,  color: colors.lime, unit: system === 'IMPERIAL' ? 'ft' : 'm' },
    cad:  { ...SERIES_META_STATIC.cad,  color: colors.amber },
    pwr:  { ...SERIES_META_STATIC.pwr,  color: colors.periwinkle },
  };

  const { data, renderedKeys } = useMemo(() => {
    if (points.length === 0) return { data: [], renderedKeys: [] as StreamKey[] };

    const speeds = points.map((p) => p.spd ?? null);
    const rows: ChartRow[] = points.map((p, i) => {
      let paceSecPerKm: number | null = null;
      const win = speeds.slice(Math.max(0, i - 2), i + 3).filter((s) => s != null) as number[];
      if (win.length > 0) {
        const avg = win.reduce((s, v) => s + v, 0) / win.length;
        if (avg > 0.1) {
          paceSecPerKm = 1000 / avg;
          if (system === 'IMPERIAL') {
            paceSecPerKm = paceSecPerKm * 1.609344;
          }
        }
      }
      let eleDisp: number | null = p.ele;
      if (eleDisp != null && system === 'IMPERIAL') eleDisp = eleDisp * 3.28084;

      return {
        t: p.t,
        hr: p.hr,
        ele: eleDisp != null ? Math.round(eleDisp * 10) / 10 : null,
        cad: p.cad,
        pwr: p.pwr,
        pace: paceSecPerKm != null ? Math.round(paceSecPerKm) : null,
      };
    });

    // Determine which metrics have at least one non-null value
    const hasNonNull = (k: StreamKey) => rows.some((r) => r[k] != null);
    const rendered = DISPLAY_ORDER.filter(hasNonNull);

    return { data: rows, renderedKeys: rendered };
  }, [points, system]);

  if (points.length < 2) {
    return (
      <div className="text-[10px] font-mono text-ink-400 italic text-center py-4 border border-dashed border-ink-700/30">
        Not enough samples for a chart.
      </div>
    );
  }

  function fmtTimeLabel(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  const isLastRendered = (k: StreamKey, idx: number) => {
    return idx === renderedKeys.length - 1;
  };

  return (
    <div className="space-y-3">
      {renderedKeys.length === 0 ? (
        <div className="text-[10px] font-mono text-ink-400 italic text-center py-4 border border-dashed border-ink-700/30">
          No stream data available.
        </div>
      ) : (
        <div className="space-y-3">
          {renderedKeys.map((k, idx) => {
            const meta = SERIES_META[k];
            const showAxis = isLastRendered(k, idx);
            return (
              <MetricRow
                key={k}
                metric={k}
                data={data}
                color={meta.color}
                label={meta.label}
                unit={meta.unit}
                showAxis={showAxis}
                height={height}
                gridColor={colors.grid}
                axisText={colors.axisText}
                tooltipBg={colors.tooltipBg}
                tooltipBorder={colors.tooltipBorder}
                formatTick={fmtTimeLabel}
                system={system}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetricRow({
  metric,
  data,
  color,
  label,
  unit,
  showAxis,
  height,
  gridColor,
  axisText,
  tooltipBg,
  tooltipBorder,
  formatTick,
  system,
}: {
  metric: StreamKey;
  data: ChartRow[];
  color: string;
  label: string;
  unit: string;
  showAxis: boolean;
  height: number;
  gridColor: string;
  axisText: string;
  tooltipBg: string;
  tooltipBorder: string;
  formatTick: (seconds: number) => string;
  system: 'METRIC' | 'IMPERIAL';
}) {
  // Per-metric domain choice: pace/hr/ele benefit from dataMin/dataMax (variation matters more than absolute 0)
  const yDomain: [string | number, string | number] = metric === 'pace' || metric === 'hr' || metric === 'ele'
    ? ['dataMin', 'dataMax']
    : [0, 'auto'];

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div
          className="text-[10px] font-display tracking-widest uppercase"
          style={{ color }}
        >
          {label}
        </div>
        <div className="text-[9px] font-mono text-ink-400">{unit}</div>
      </div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <LineChart
            data={data}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              stroke={gridColor}
              strokeDasharray="2 4"
              vertical={false}
            />
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={formatTick}
              stroke={gridColor}
              tick={{ fontSize: 9, fontFamily: 'monospace', fill: axisText }}
              interval="preserveStartEnd"
              minTickGap={20}
              hide={!showAxis}
            />
            <YAxis
              stroke={gridColor}
              tick={{ fontSize: 9, fontFamily: 'monospace', fill: axisText }}
              width={72}
              domain={yDomain}
              tickCount={4}
              tickFormatter={(v) => `${v} ${unit}`}
            />
            <Tooltip
              contentStyle={{
                background: tooltipBg,
                border: `1px solid ${tooltipBorder}`,
                fontFamily: 'monospace',
                fontSize: 11,
              }}
              labelFormatter={(t) => `t = ${formatTick(Number(t))}`}
              formatter={(value: any) => {
                if (value == null) return ['—', label];
                if (metric === 'pace' && typeof value === 'number') {
                  const m = Math.floor(value / 60);
                  const s = Math.floor(value % 60);
                  return [`${m}:${s.toString().padStart(2, '0')} /${system === 'IMPERIAL' ? 'mi' : 'km'}`, label];
                }
                if (metric === 'ele' && typeof value === 'number') {
                  return [`${Math.round(value)} ${unit}`, label];
                }
                return [value, label];
              }}
            />
            <Line
              type="monotone"
              dataKey={metric}
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
