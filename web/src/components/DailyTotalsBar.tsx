import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Panel } from '@/components/Panel';
import { type TodayMealsResponse, type MealEntrySummary } from '@/lib/types';
import { convertForDisplay, type UnitSystem } from '@/lib/units';

type Macros = MealEntrySummary;

/**
 * Top-of-nutrition summary. Shows today's totals from the meal
 * log (cal / p / c / f) + water (from a separate measurements
 * call) + the goal-derived targets. Calorie and protein are
 * shown as horizontal progress bars against the goal; the macro
 * targets are visible in compact stats below.
 *
 * "Targets are now defined in /settings" — the daily goals (cut
 * / maintain / bulk, BMR vs BMR+NEAT, baseline) are in
 * /settings → Goal & Targets. This panel is read-only.
 */
export function DailyTotalsBar() {
  const { user } = useAuth();
  const system: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';

  const todayQ = useQuery({
    queryKey: ['meals', 'today'],
    queryFn: () => api<TodayMealsResponse>('/meals/today'),
  });
  const waterQ = useQuery({
    queryKey: ['measurements', 'today', 'WATER_ML'],
    queryFn: () =>
      api<{ items: Array<{ recordedAt: string; value: number; unit: string }> }>(
        '/measurements?metric=WATER_ML&days=1',
      ),
  });

  const totals = todayQ.data?.dayTotals;
  const t = user?.targets;
  const waterTotal = sumMetric(waterQ.data?.items, 'WATER_ML');
  const waterTargetMl = t?.waterGoalMl ?? 0;
  const waterDisplay = convertForDisplay(waterTotal, 'ml', system);
  const waterTargetDisplay = convertForDisplay(waterTargetMl, 'ml', system);

  if (!totals && !t) return null;
  return (
    <Panel title="Today" variant="cyan" className="mb-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <Stat
          label="Calories"
          value={totals ? totals.calories.toFixed(0) : '0'}
          target={t ? t.calorieGoal : undefined}
          unit="cal"
          color="amber"
        />
        <Stat
          label="Protein"
          value={totals ? totals.proteinG.toFixed(0) : '0'}
          target={t ? t.proteinGoalG : undefined}
          unit="g"
          color="lime"
        />
        <Stat
          label="Carbs"
          value={totals ? totals.carbG.toFixed(0) : '0'}
          unit="g"
          color="cyan"
        />
        <Stat
          label="Fat"
          value={totals ? totals.fatG.toFixed(0) : '0'}
          unit="g"
          color="violet"
        />
        <Stat
          label="Water"
          value={waterDisplay.value.toFixed(0)}
          target={waterTargetDisplay.value}
          unit={waterDisplay.unit}
          color="cyan"
          isWater
        />
      </div>
    </Panel>
  );
}

function Stat({
  label,
  value,
  target,
  unit,
  color,
  isWater,
}: {
  label: string;
  value: string;
  target?: number;
  unit: string;
  color: 'cyan' | 'lime' | 'amber' | 'violet' | 'magenta';
  isWater?: boolean;
}) {
  const numVal = Number(value);
  const pct =
    target != null && target > 0 ? Math.min(100, (numVal / target) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-mono uppercase text-ink-400 tracking-widest">
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-lg font-display tracking-wider neon-text-${color}`}>
          {value}
        </span>
        <span className="text-[10px] text-ink-400">{unit}</span>
        {target != null && (
          <span className="text-[10px] text-ink-500 ml-auto">
            / {target.toFixed(0)} {unit}
          </span>
        )}
      </div>
      {target != null && (
        <div className="h-1.5 bg-bg-800 border border-ink-500/30 overflow-hidden">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: isWater
                ? pct >= 100
                  ? '#9bff5c'
                  : pct >= 60
                  ? '#5ec5e8'
                  : '#3aa0c8'
                : pct >= 100
                ? '#9bff5c'
                : pct >= 60
                ? '#14d6e8'
                : '#ffc34d',
            }}
          />
        </div>
      )}
    </div>
  );
}

function sumMetric(
  items: Array<{ recordedAt: string; value: number; unit: string }> | undefined,
  metric: string,
): number {
  if (!items) return 0;
  // Measurements endpoint returns one row per entry. Sum today's.
  return items.reduce((s, m) => s + (m.value || 0), 0);
}
