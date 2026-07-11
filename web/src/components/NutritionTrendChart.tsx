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
} from 'recharts';
import { api } from '@/lib/api';
import { convertForDisplay, displayUnit, type UnitSystem } from '@/lib/units';
import { classNames } from '@/lib/format';
import { useChartColors } from '@/hooks/useChartColors';

// One row per day from GET /meals/trend?days=N (oldest-first,
// contiguous, zero-filled). Mirrors the API's response shape.
type TrendDay = {
  day: string; // YYYY-MM-DD
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  waterMl: number;
  mealCount: number;
};

type MetricKey = 'calories' | 'proteinG' | 'carbG' | 'fatG' | 'waterMl';

// Metric metadata: label, stored unit (null = render as-is, e.g.
// calories/grams), and line color. Water is the only metric with a
// unit system — converted via convertForDisplay at chart-build time so
// each metric gets its own natural Y-axis range.
type MetricMeta = {
  label: string;
  short: string;
  unit: string | null;
  color: string;
};

// Static part of the metric metadata (label/unit are constant);
// the theme-aware `color` is filled in inside NutritionTrendChart.
const METRICS_STATIC: Record<MetricKey, Omit<MetricMeta, 'color'>> = {
  calories: { label: 'Calories', short: 'cal', unit: null },
  waterMl:  { label: 'Water',    short: 'ml',  unit: 'ml' },
  proteinG: { label: 'Protein',  short: 'g',   unit: null },
  carbG:    { label: 'Carbs',    short: 'g',   unit: null },
  fatG:     { label: 'Fat',      short: 'g',   unit: null },
};

// UI render order. Explicit (not Object.keys-derived) so the visual
// stacking matches the user-requested sequence: water → calories →
// protein → fat → carbs. All five keys are present, just ordered.
const DISPLAY_ORDER: MetricKey[] = ['waterMl', 'calories', 'proteinG', 'fatG', 'carbG'];

const DAY_OPTIONS = [7, 14, 30] as const;

type Props = {
  system: UnitSystem;
  /** Display height per mini-chart in px. */
  height?: number;
};

type ChartRow = Record<string, number | string>;

/**
 * NutritionTrendChart — per-day nutrition totals over the last N days.
 *
 * Fetches GET /meals/trend?days=N (per-day rollups of the meal log +
 * WATER_ML measurements, timezone-aware and zero-filled so the x-axis
 * is contiguous). Renders five stacked mini-charts (water / calories /
 * protein / fat / carbs), each with its own natural Y axis — replacing
 * the previous single dual-axis chart, where the calorie range was
 * crushing water day-over-day variation into a flat line. Water is
 * converted to the user's unit system; calories + macros render as-is.
 */
export function NutritionTrendChart({ system, height = 90 }: Props) {
  const colors = useChartColors();
  const METRICS: Record<MetricKey, MetricMeta> = {
    calories: { ...METRICS_STATIC.calories, color: colors.amber },
    waterMl:  { ...METRICS_STATIC.waterMl,  color: colors.lime },
    proteinG: { ...METRICS_STATIC.proteinG, color: colors.magenta },
    carbG:    { ...METRICS_STATIC.carbG,    color: colors.cyan },
    fatG:     { ...METRICS_STATIC.fatG,     color: colors.violet },
  };
  const [days, setDays] = useState<number>(14);

  const q = useQuery({
    queryKey: ['meals', 'trend', days],
    queryFn: () => api<{ days: TrendDay[] }>('/meals/trend', { query: { days } }),
    // Keep in step with the daily totals bar / meal log.
    refetchInterval: 60_000,
  });

  const chart = useMemo(() => {
    const rows = q.data?.days ?? [];
    const data: ChartRow[] = rows.map((r) => {
      const row: ChartRow = {
        ts: new Date(`${r.day}T00:00:00Z`).getTime(),
      };
      for (const k of DISPLAY_ORDER) {
        const meta = METRICS[k];
        const raw = r[k];
        const shown =
          meta.unit != null
            ? convertForDisplay(raw, meta.unit as any, system).value
            : raw;
        row[k] = Math.round(shown * 10) / 10;
      }
      return row;
    });
    // Any nutrition logged in the window at all?
    const hasData = data.some((d) =>
      DISPLAY_ORDER.some((k) => (d[k] as number) > 0),
    );
    return { data, hasData };
  }, [q.data, system]);

  const formatTick = (ts: number) => {
    const d = new Date(ts);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };

  return (
    <div className="space-y-3">
      {/* Day-range chips apply to all 5 mini-charts. Each metric has
          its own chart now, so no per-metric show/hide buttons. */}
      <div className="flex justify-end gap-1">
        {DAY_OPTIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={classNames(
              'px-2 py-0.5 text-[9px] font-mono border transition-colors',
              d === days
                ? 'text-neon-cyan border-neon-cyan/60'
                : 'text-ink-400 border-ink-500/30 hover:text-ink-200',
            )}
          >
            {d}d
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div
          className="border border-ink-500/30 bg-bg-800/40 flex items-center justify-center text-[10px] font-mono text-ink-400"
          style={{ height }}
        >
          loading…
        </div>
      ) : !chart.hasData ? (
        <div
          className="border border-dashed border-ink-700/40 flex items-center justify-center text-center text-[10px] font-mono text-ink-400 px-4"
          style={{ height }}
        >
          No meals logged in this window. Track food over time to see trends.
        </div>
      ) : (
        <div className="space-y-3">
          {DISPLAY_ORDER.map((k, idx) => {
            const meta = METRICS[k];
            const unit =
              meta.unit != null
                ? displayUnit(meta.unit as any, system)
                : meta.short;
            return (
              <MetricRow
                key={k}
                metric={k}
                data={chart.data}
                color={meta.color}
                label={meta.label}
                unit={unit}
                showAxis={idx === DISPLAY_ORDER.length - 1}
                height={height}
                gridColor={colors.grid}
                tooltipBg={colors.tooltipBg}
                tooltipBorder={colors.tooltipBorder}
                formatTick={formatTick}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * MetricRow — one mini line chart for a single nutrition metric.
 *
 * Header shows the metric label (in its theme color) + unit. The
 * chart below uses its own YAxis (so each metric scales naturally)
 * and a shared grid. The XAxis date labels are only rendered on the
 * bottom-most chart in the stack — the others still draw the line +
 * YAxis so each reads as its own chart, just without redundant date
 * labels stacked one on top of another.
 */
function MetricRow({
  metric,
  data,
  color,
  label,
  unit,
  showAxis,
  height,
  gridColor,
  tooltipBg,
  tooltipBorder,
  formatTick,
}: {
  metric: MetricKey;
  data: ChartRow[];
  color: string;
  label: string;
  unit: string;
  showAxis: boolean;
  height: number;
  gridColor: string;
  tooltipBg: string;
  tooltipBorder: string;
  formatTick: (ts: number) => string;
}) {
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
            {/* Always declare the XAxis with dataKey="ts" so Recharts
                registers the numeric timestamp domain — even when
                showAxis is false (the axis ticks/hide itself). Without
                this, the tooltip's labelFormatter gets called with the
                row INDEX (as a string) instead of the ms timestamp, and
                `new Date(Number("3")).toISOString().slice(0,10)` returns
                "1970-01-01" (unix epoch + 3 seconds = 1970-01-01). This is
                why 4 of 5 charts showed "1970-01-01" while the carbs
                chart (the only one rendered with showAxis=true) showed
                the real date — it was the only one with the XAxis
                properly registered, so it was the only one passing the
                actual ms value through to labelFormatter.
            */}
            <XAxis
              dataKey="ts"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={formatTick}
              stroke={gridColor}
              tick={{ fontSize: 9, fontFamily: 'monospace' }}
              interval="preserveStartEnd"
              minTickGap={20}
              hide={!showAxis}
            />
            <Tooltip
              contentStyle={{
                background: tooltipBg,
                border: `1px solid ${tooltipBorder}`,
                fontFamily: 'monospace',
                fontSize: 11,
              }}
              labelFormatter={(ts) => {
                // Recharts passes the active "label" for the hovered
                // point — which by default is the XAxis dataKey value
                // for that row. In our data the XAxis dataKey is "ts"
                // and it's a number (ms since epoch). Number(ts) is a
                // defensive coercion in case Recharts ever hands us
                // a string. NaN/Infinity guard returns '—' instead of
                // the misleading "1970-01-01" that `new Date(NaN).toISOString()`
                // would otherwise produce.
                const ms = Number(ts);
                if (!Number.isFinite(ms)) return '—';
                return new Date(ms).toISOString().slice(0, 10);
              }}
              formatter={(value: any) => [`${value} ${unit}`, label]}
            />
            <Line
              type="monotone"
              dataKey={metric}
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}