import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Panel } from './Panel';
import { METRICS, METRICS_BY_CATEGORY, type MetricType } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { convertForDisplay, displayUnit, type UnitSystem } from '@/lib/units';
import { formatRelative } from '@/lib/format';

const NUTRITION_METRICS = METRICS_BY_CATEGORY.NUTRITION;

const DEFAULT_TARGETS: Record<string, number> = {
  CALORIES: 2200,
  PROTEIN_G: 140,
  CARB_G: 240,
  FAT_G: 70,
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

export function NutritionWidget() {
  const { user } = useAuth();
  const system: UnitSystem = user?.units ?? 'METRIC';
  const targets = loadTargets();

  const allQ = useQuery({
    queryKey: ['nutrition', 'all', 'today'],
    queryFn: () => api<{ items: Array<{ metric: MetricType; value: number; recordedAt: string }> }>(
      '/measurements?limit=200',
    ),
    refetchInterval: 60_000,
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todaysMeasurements = (allQ.data?.items ?? []).filter(
    (m) => new Date(m.recordedAt) >= today && NUTRITION_METRICS.includes(m.metric),
  );

  const sumByMetric = new Map<MetricType, number>();
  for (const m of todaysMeasurements) {
    sumByMetric.set(m.metric, (sumByMetric.get(m.metric) ?? 0) + m.value);
  }

  return (
    <Panel variant="lime" title="Nutrition">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-mono text-ink-300">
            {todaysMeasurements.length === 0 ? 'nothing logged' : `${todaysMeasurements.length} entries today`}
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
            const total = sumByMetric.get(m) ?? 0;
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
        {todaysMeasurements.length > 0 && (
          <div className="text-[9px] font-mono text-ink-500 italic pt-1 border-t border-ink-700/30">
            last: {formatRelative(todaysMeasurements[todaysMeasurements.length - 1]!.recordedAt)}
          </div>
        )}
      </div>
    </Panel>
  );
}