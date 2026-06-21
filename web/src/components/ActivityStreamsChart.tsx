import { useMemo, useState } from 'react';
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
import { classNames } from '@/lib/format';

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
  /** Default series to highlight. */
  defaultSeries?: StreamKey;
};

const SERIES_META: Record<StreamKey, { label: string; color: string; unit: (s: 'METRIC' | 'IMPERIAL') => string; }> = {
  pace: { label: 'Pace',     color: '#14d6e8', unit: () => 'min/mi' },
  hr:   { label: 'Heart Rate', color: '#ff2bd6', unit: () => 'bpm' },
  ele:  { label: 'Elevation', color: '#9bff5c', unit: (s) => s === 'IMPERIAL' ? 'ft' : 'm' },
  cad:  { label: 'Cadence',  color: '#ffc34d', unit: () => 'spm' },
  pwr:  { label: 'Power',    color: '#7d7bff', unit: () => 'W' },
};

/**
 * Multi-series line chart of a workout's trackpoint streams. User can
 * pick which series to show via pills (defaults to HR + pace + ele).
 *
 * For METRIC, pace is computed as 1000 / (avg speed in m/s over a
 * 10s window), expressed as seconds-per-km (or per-mi in IMPERIAL).
 * For workouts without speed samples, pace falls back to "—".
 */
export function ActivityStreamsChart({ points, system, defaultSeries }: Props) {
  // Default to all five streams turned on.
  const [active, setActive] = useState<Set<StreamKey>>(
    new Set(
      defaultSeries
        ? new Set<StreamKey>([defaultSeries, 'pace', 'ele', 'cad', 'pwr'])
        : (['pace', 'hr', 'ele', 'cad', 'pwr'] as StreamKey[]),
    ),
  );

  const data = useMemo(() => {
    if (points.length === 0) return [];
    // Smooth speed over a 5-sample window for stable pace
    const speeds = points.map((p) => p.spd ?? null);
    return points.map((p, i) => {
      let paceSecPerKm: number | null = null;
      const win = speeds.slice(Math.max(0, i - 2), i + 3).filter((s) => s != null) as number[];
      if (win.length > 0) {
        const avg = win.reduce((s, v) => s + v, 0) / win.length;
        if (avg > 0.1) {
          // seconds per km = 1000 / avg(m/s)
          paceSecPerKm = 1000 / avg;
          if (system === 'IMPERIAL') {
            // convert to sec/mile
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
        spd: p.spd,
      };
    });
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

  function toggleSeries(k: StreamKey) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {/* Series toggles */}
      <div className="flex flex-wrap gap-1">
        {(Object.keys(SERIES_META) as StreamKey[]).map((k) => {
          const meta = SERIES_META[k];
          const isOn = active.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggleSeries(k)}
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
      <div style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#3a3d4a" strokeDasharray="2 4" />
            <XAxis
              dataKey="t"
              tickFormatter={fmtTimeLabel}
              stroke="#787888"
              tick={{ fontSize: 9, fontFamily: 'monospace' }}
              label={{ value: 'time', position: 'insideBottom', offset: -2, fill: '#585868', fontSize: 9, fontFamily: 'monospace' }}
            />
            {/* Left Y axis: HR / Cadence / Power (bpm, spm, W) */}
            <YAxis
              yAxisId="left"
              stroke="#787888"
              tick={{ fontSize: 9, fontFamily: 'monospace' }}
              width={36}
              domain={['auto', 'auto']}
            />
            {/* Right Y axis: Elevation / Pace */}
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#787888"
              tick={{ fontSize: 9, fontFamily: 'monospace' }}
              width={42}
              domain={['auto', 'auto']}
              tickFormatter={(v) => {
                if (active.has('pace') && active.has('ele')) return String(Math.round(v));
                return String(Math.round(v));
              }}
            />
            <Tooltip
              contentStyle={{
                background: '#0e0f1a',
                border: '1px solid rgba(20,214,232,0.4)',
                fontFamily: 'monospace',
                fontSize: 11,
              }}
              labelFormatter={(t) => `t = ${fmtTimeLabel(Number(t))}`}
              formatter={(value: any, name: string) => {
                if (value == null) return ['—', name];
                if (name === 'Pace' && typeof value === 'number') {
                  const m = Math.floor(value / 60);
                  const s = Math.floor(value % 60);
                  return [`${m}:${s.toString().padStart(2, '0')} /${system === 'IMPERIAL' ? 'mi' : 'km'}`, name];
                }
                if (name === 'Elevation' && typeof value === 'number') {
                  return [`${Math.round(value)} ${system === 'IMPERIAL' ? 'ft' : 'm'}`, name];
                }
                return [value, name];
              }}
            />
            {(Object.keys(SERIES_META) as StreamKey[]).map((k) => {
              if (!active.has(k)) return null;
              const meta = SERIES_META[k];
              const axis = (k === 'ele' || k === 'pace') ? 'right' : 'left';
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
                  connectNulls
                  yAxisId={axis}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}