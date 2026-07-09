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
import type { UnitSystem } from '@/lib/units';
import { useChartColors } from '@/hooks/useChartColors';

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
  const colors = useChartColors();
  if (!data.length) {
    return (
      <div className="text-sm text-ink-300 font-mono py-6 text-center">
        Not enough data yet.
      </div>
    );
  }
  const lastIdx = data.length - 1;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
        <XAxis
          dataKey="week"
          tick={{ fontSize: 9, fill: colors.axisText }}
          tickFormatter={(d) => d.slice(5)}
        />
        <YAxis
          yAxisId="volume"
          tick={{ fontSize: 9, fill: colors.axisText }}
          width={50}
          orientation="left"
        />
        <YAxis
          yAxisId="sessions"
          tick={{ fontSize: 9, fill: colors.axisText }}
          width={26}
          orientation="right"
        />
        <Tooltip
          contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, fontSize: 11 }}
          labelStyle={{ color: colors.tooltipText }}
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
              fill={colors.lime}
              fillOpacity={i === lastIdx ? 1 : 0.33}
            />
          ))}
        </Bar>
        <Bar
          yAxisId="sessions"
          dataKey="sessions"
          fill={colors.magenta}
          fillOpacity={0.4}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
