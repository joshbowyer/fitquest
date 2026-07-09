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
import { useChartColors } from '@/hooks/useChartColors';

// One row per day from GET /substances/trend?days=N (oldest-first,
// contiguous, zero-filled). Each category is a count of logs that day.
type TrendDay = {
  day: string; // YYYY-MM-DD
  CAFFEINE: number;
  ALCOHOL: number;
  NICOTINE: number;
  ELECTROLYTE: number;
};

type Cat = 'CAFFEINE' | 'ALCOHOL' | 'NICOTINE' | 'ELECTROLYTE';

type CategoryMeta = { key: Cat; label: string; color: string; borderColor: string };

// Static labels only — colors are resolved from useChartColors() below
// so the chart adapts to the active light/dark theme.
const CATEGORIES_STATIC: { key: Cat; label: string }[] = [
  { key: 'CAFFEINE',    label: 'Caffeine'    },
  { key: 'ALCOHOL',     label: 'Alcohol'     },
  { key: 'NICOTINE',    label: 'Nicotine'    },
  { key: 'ELECTROLYTE', label: 'Electrolyte' },
];

const DAY_OPTIONS = [7, 14, 30] as const;

type Props = {
  /** Display height in px. */
  height?: number;
};

/**
 * SubstanceTrendChart — per-day count per substance category over the
 * last N days.
 *
 * Fetches GET /substances/trend?days=N (per-day counts, timezone-aware
 * and zero-filled). Each category is its own line — the y-axis is a
 * count of logs ("how many times"), NOT a dose, because the units
 * differ across categories (drinks vs mg vs puffs) and a shared dose
 * axis would be misleading. Categories can be toggled on/off via the
 * legend chips.
 */
export function SubstanceTrendChart({ height = 180 }: Props) {
  const colors = useChartColors();
  const CATEGORIES: CategoryMeta[] = [
    { ...CATEGORIES_STATIC[0], color: colors.amber, borderColor: colors.withAlpha('amber', 0.4) },
    { ...CATEGORIES_STATIC[1], color: colors.magenta, borderColor: colors.withAlpha('magenta', 0.4) },
    { ...CATEGORIES_STATIC[2], color: colors.violet, borderColor: colors.withAlpha('violet', 0.4) },
    { ...CATEGORIES_STATIC[3], color: colors.lime, borderColor: colors.withAlpha('lime', 0.4) },
  ];
  const [days, setDays] = useState<number>(14);
  const [hidden, setHidden] = useState<Set<Cat>>(new Set());

  const q = useQuery({
    queryKey: ['substances', 'trend', days],
    queryFn: () =>
      api<{ days: TrendDay[] }>('/substances/trend', { query: { days } }),
    refetchInterval: 60_000,
  });

  const chart = useMemo(() => {
    const rows = q.data?.days ?? [];
    const data = rows.map((r) => ({
      ts: new Date(`${r.day}T00:00:00Z`).getTime(),
      label: r.day,
      CAFFEINE: r.CAFFEINE,
      ALCOHOL: r.ALCOHOL,
      NICOTINE: r.NICOTINE,
      ELECTROLYTE: r.ELECTROLYTE,
    }));
    const totalLogs = data.reduce(
      (s, d) => s + d.CAFFEINE + d.ALCOHOL + d.NICOTINE + d.ELECTROLYTE,
      0,
    );
    return { data, totalLogs };
  }, [q.data]);

  const toggle = (c: Cat) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const formatTick = (ts: number) => {
    const d = new Date(ts);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };

  return (
    <div>
      {/* Controls: category toggles + day-range chips */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => {
            const off = hidden.has(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggle(c.key)}
                className={
                  'px-2 py-1 text-[10px] font-mono uppercase tracking-wider border transition-colors ' +
                  (off
                    ? 'text-ink-500 border-ink-700/40 line-through'
                    : 'border-transparent')
                }
                style={off ? undefined : { color: c.color, borderColor: c.borderColor }}
              >
                {c.label}
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
              className={
                'px-2 py-1 text-[10px] font-mono border transition-colors ' +
                (d === days
                  ? 'text-neon-cyan border-neon-cyan/60'
                  : 'text-ink-400 border-ink-500/30 hover:border-ink-300/50')
              }
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[10px] font-mono text-ink-300 tracking-widest uppercase">
          Substance logs · last {days} days
        </div>
        <div className="text-[11px] font-mono text-ink-300">
          {chart.totalLogs} total {chart.totalLogs === 1 ? 'log' : 'logs'}
        </div>
      </div>

      {q.isLoading ? (
        <div
          className="border border-ink-500/30 bg-bg-800/40 flex items-center justify-center text-[10px] font-mono text-ink-400"
          style={{ height }}
        >
          loading…
        </div>
      ) : chart.totalLogs === 0 ? (
        <div
          className="border border-dashed border-ink-700/40 flex items-center justify-center text-center text-[10px] font-mono text-ink-400 px-4"
          style={{ height }}
        >
          No substances logged in this window. Log over time to see trends.
        </div>
      ) : (
        <div style={{ width: '100%', height }}>
          <ResponsiveContainer>
            <LineChart
              data={chart.data}
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                stroke={colors.grid}
                strokeDasharray="2 4"
                vertical={false}
              />
              <XAxis
                dataKey="ts"
                tickFormatter={formatTick}
                stroke={colors.grid}
                tick={{ fontSize: 9, fontFamily: 'monospace' }}
                interval="preserveStartEnd"
                minTickGap={20}
              />
              <YAxis
                stroke={colors.grid}
                tick={{ fontSize: 9, fontFamily: 'monospace' }}
                width={28}
                allowDecimals={false}
                domain={[0, 'auto']}
              />
              <Tooltip
                contentStyle={{
                  background: colors.tooltipBg,
                  border: `1px solid ${colors.tooltipBorder}`,
                  fontFamily: 'monospace',
                  fontSize: 11,
                }}
                labelFormatter={(ts) =>
                  new Date(Number(ts)).toISOString().slice(0, 10)
                }
              />
              <Legend
                wrapperStyle={{ fontSize: 10, fontFamily: 'monospace' }}
              />
              {CATEGORIES.filter((c) => !hidden.has(c.key)).map((c) => (
                <Line
                  key={c.key}
                  type="monotone"
                  dataKey={c.key}
                  name={c.label}
                  stroke={c.color}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
