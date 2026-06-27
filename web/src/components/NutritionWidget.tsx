import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { localTodayStartUtc } from '@/lib/timezone';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Panel } from './Panel';
import { METRICS, type MetricType } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { convertForDisplay, type UnitSystem } from '@/lib/units';

const DEFAULT_TARGETS: Record<string, number> = {
  CALORIES: 2200,
  PROTEIN_G: 140,
  WATER_ML: 2500,
};

function loadTargets(): Record<string, number> {
  if (typeof window === 'undefined') return DEFAULT_TARGETS;
  try {
    const raw = localStorage.getItem('fitquest:nutrition:targets');
    if (!raw) return DEFAULT_TARGETS;
    return { ...DEFAULT_TARGETS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_TARGETS;
  }
}

type MealsTodayResponse = {
  date: string;
  dayTotals: {
    calories: number;
    proteinG: number;
    carbG: number;
    fatG: number;
  };
};

/**
 * Dashboard Nutrition widget. Aggregates today's macros from two
 * sources:
 *   - Calories / protein / carbs / fat → /meals/today (food log)
 *   - Water                            → /measurements (WATER_ML rows)
 *
 * Old version pulled everything from /measurements, which is empty
 * for food — that's why the widget always showed 0 for calories and
 * protein even when the user had meals logged.
 */
export function NutritionWidget() {
  const { user } = useAuth();
  const userTz = user?.timezone ?? null;
  const system: UnitSystem = user?.units ?? 'METRIC';
  const targets = loadTargets();

  const mealsQ = useQuery({
    queryKey: ['nutrition', 'meals', 'today'],
    queryFn: () => api<MealsTodayResponse>('/meals/today'),
    refetchInterval: 60_000,
  });
  const waterQ = useQuery({
    queryKey: ['nutrition', 'water', 'today'],
    queryFn: () => api<{ items: Array<{ metric: MetricType; value: number; recordedAt: string }> }>(
      // Filter by metric=WATER_ML — the user has 3000+ measurements
      // across all metrics, so an unfiltered limit=200 query pushes
      // WATER_ML rows out of the page (they're older entries).
      '/measurements?metric=WATER_ML&limit=200',
    ),
    refetchInterval: 60_000,
  });

  // Build the metric → total map from BOTH endpoints. Water wins
  // from the measurements query; calories/protein/carb/fat from
  // the meals query.
  const totals = new Map<MetricType, number>();
  const dayTotals = mealsQ.data?.dayTotals;
  if (dayTotals) {
    totals.set('CALORIES', dayTotals.calories);
    totals.set('PROTEIN_G', dayTotals.proteinG);
  }

  // Water: sum WATER_ML rows for today.
  const today = localTodayStartUtc(userTz);
  let waterTotal = 0;
  let waterLastAt: string | null = null;
  for (const m of waterQ.data?.items ?? []) {
    if (m.metric !== 'WATER_ML') continue;
    if (new Date(m.recordedAt) < today) continue;
    waterTotal += m.value;
    if (!waterLastAt || m.recordedAt > waterLastAt) waterLastAt = m.recordedAt;
  }
  totals.set('WATER_ML', waterTotal);

  const NUTRITION_METRICS: MetricType[] = ['CALORIES', 'PROTEIN_G', 'WATER_ML'];

  return (
    <Panel variant="lime" title="Nutrition">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-mono text-ink-300">
            {dayTotals || waterTotal > 0 ? 'today' : 'nothing logged'}
          </div>
          <Link
            to="/nutrition"
            className="text-[10px] font-display tracking-widest neon-text-lime hover:underline"
          >
            → LOG
          </Link>
        </div>
        <div className="space-y-1.5">
          {NUTRITION_METRICS.map((m) => {
            const meta = METRICS[m];
            const total = totals.get(m) ?? 0;
            const target = targets[m] ?? meta.defaultMin;
            const pct = target > 0 ? Math.min(100, (total / target) * 100) : 0;
            const disp = convertForDisplay(total, meta.unit, system);
            return (
              <div key={m}>
                <div className="flex items-baseline justify-between text-[10px] font-mono">
                  <span className="text-ink-200">{meta.shortLabel}</span>
                  <span className={pct >= 100 ? 'neon-text-lime' : 'text-ink-300'}>
                    {disp.value.toFixed(0)} {disp.unit} · {Math.round(pct)}%
                  </span>
                </div>
                <div className="h-1 bg-bg-700 border border-ink-500/30 mt-0.5">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${pct}%`,
                      background: pct >= 100 ? '#9bff5c' : pct >= 60 ? '#14d6e8' : '#ffc34d',
                      boxShadow: '0 0 4px currentColor',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {waterLastAt && (
          <div className="text-[9px] font-mono text-ink-500 italic pt-1 border-t border-ink-700/30">
            last: {new Date(waterLastAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
        )}
      </div>
    </Panel>
  );
}