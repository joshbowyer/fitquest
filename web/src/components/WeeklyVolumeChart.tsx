import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';
import { formatInUnits } from '@/lib/units';
import type { UnitSystem } from '@/lib/types';

type WeekRow = {
  week: string;
  volume: number; // kg
  sessions: number;
  minutes: number;
};

type Props = {
  data: WeekRow[];
  units: UnitSystem;
};

/**
 * Bar chart of weekly training volume. Last bar is highlighted in the
 * class color so the user can see "this week vs prior weeks" at a
 * glance. The Y axis is in the user's unit (kg for metric, lb for
 * imperial) — volume is stored in kg and converted at display time.
 */
export function WeeklyVolumeChart({ data, units }: Props) {
  if (!data.length) {
    return (
      <div className="text-sm text-slate-400 font-mono py-6 text-center">
        Not enough data yet.
      </div>
    );
  }
  const lastIdx = data.length - 1;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#374151" strokeDasharray="3 3" />
        <XAxis
          dataKey="week"
          tick={{ fontSize: 9, fill: '#94a3b8' }}
          tickFormatter={(d) => d.slice(5)}
        />
        <YAxis
          yAxisId="volume"
          tick={{ fontSize: 9, fill: '#94a3b8' }}
          width={50}
          orientation="left"
        />
        <YAxis
          yAxisId="sessions"
          tick={{ fontSize: 9, fill: '#94a3b8' }}
          width={26}
          orientation="right"
        />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #374151', fontSize: 11 }}
          labelStyle={{ color: '#cbd5e1' }}
          formatter={(value: number, name: string) => {
            if (name === 'volume') {
              return [
                formatInUnits(value, 'kg', units),
                'volume',
              ];
            }
            return [value, name];
          }}
        />
        <Bar yAxisId="volume" dataKey="volume" isAnimationActive={false}>
          {data.map((_, i) => (
            <Cell
              key={i}
              fill={i === lastIdx ? '#5cf6c4' : '#5cf6c455'}
            />
          ))}
        </Bar>
        <Bar
          yAxisId="sessions"
          dataKey="sessions"
          fill="#c45cff66"
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
