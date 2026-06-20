import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { METRICS, METRICS_BY_CATEGORY, type MetricType } from '@/lib/types';
import { classNames, formatMetricWithUnit, formatRelative } from '@/lib/format';
import { convertForDisplay, convertForStorage, displayUnit, type UnitSystem } from '@/lib/units';

// Default daily targets. These are reasonable placeholders — users can
// override via localStorage. Body-comp-aware defaults would be ideal
// (e.g., protein g/kg bodyweight) but for v0 a single set is fine.
const DEFAULT_TARGETS: Record<string, number> = {
  CALORIES: 2200,
  PROTEIN_G: 140,
  CARB_G: 240,
  FAT_G: 70,
  WATER_ML: 2500,
};

const TARGET_STORAGE_KEY = 'fitquest:nutrition:targets';

function loadTargets(): Record<string, number> {
  if (typeof window === 'undefined') return DEFAULT_TARGETS;
  try {
    const raw = localStorage.getItem(TARGET_STORAGE_KEY);
    if (!raw) return DEFAULT_TARGETS;
    return { ...DEFAULT_TARGETS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_TARGETS;
  }
}

function saveTargetsLocal(t: Record<string, number>) {
  try {
    localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

export function NutritionPage() {
  const { user } = useAuth();
  const system: UnitSystem = user?.units ?? 'METRIC';
  const qc = useQueryClient();
  const [targets, setTargets] = useState<Record<string, number>>(loadTargets);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});

  const metrics = METRICS_BY_CATEGORY.NUTRITION;

  // Today's logged values
  const statusQ = useQuery({
    queryKey: ['nutrition', 'today'],
    queryFn: () => api<{ status: Record<string, { logged: boolean; value: number | null; recordedAt: string | null }> }>(
      '/measurements/habits/today',
    ),
  });
  const status = statusQ.data?.status || {};

  // Today's full log (for entries that have been logged multiple times
  // through the day — habit status only shows the latest; we want the
  // sum). Use the measurements/all endpoint.
  const allQ = useQuery({
    queryKey: ['nutrition', 'all', 'today'],
    queryFn: () => api<{ items: Array<{ id: string; metric: MetricType; value: number; recordedAt: string }> }>(
      '/measurements?limit=200',
    ),
  });
  const todayMeasurements = (allQ.data?.items ?? []).filter((m) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(m.recordedAt) >= today && metrics.includes(m.metric);
  });
  const sumByMetric = new Map<MetricType, number>();
  for (const m of todayMeasurements) {
    sumByMetric.set(m.metric, (sumByMetric.get(m.metric) ?? 0) + m.value);
  }

  const batchM = useDelayedMutation<unknown, Array<{ metric: MetricType; value: number }>>({
    mutationFn: (items) => api('/measurements/batch', { method: 'POST', body: { items } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nutrition'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      setDrafts({});
    },
  }, 600);

  function commit(metric: MetricType, addToExisting = false) {
    const raw = drafts[metric];
    if (raw === '' || raw == null) return;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) return;
    const meta = METRICS[metric];
    const stored = convertForStorage(v, displayUnit(meta.unit, system), system);
    // When 'addToExisting', accumulate onto today's total
    const value = addToExisting ? stored.value + (sumByMetric.get(metric) ?? 0) : stored.value;
    batchM.run([{ metric, value }]).then(() => {
      setDrafts((d) => ({ ...d, [metric]: '' }));
    });
  }

  function saveTargets() {
    const next: Record<string, number> = { ...targets };
    for (const [k, v] of Object.entries(targetDrafts)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) next[k] = n;
    }
    setTargets(next);
    saveTargetsLocal(next);
    setTargetDrafts({});
    setEditing(false);
  }

  return (
    <Layout>
      <PageHeader
        title="// Nutrition"
        subtitle="Calories, macros, water. Quick-log throughout the day."
        action={
          <NeonButton onClick={() => setEditing(true)} icon="⚙" variant="cyan">
            Targets
          </NeonButton>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {metrics.map((m) => {
          const meta = METRICS[m];
          const total = sumByMetric.get(m) ?? 0;
          const target = targets[m] ?? meta.defaultMin;
          const pct = target > 0 ? Math.min(100, (total / target) * 100) : 0;
          const lastEntry = todayMeasurements.find((x) => x.metric === m);
          const isWater = m === 'WATER_ML';

          return (
            <Panel key={m} variant="lime" title={meta.label}>
              <div className="space-y-3">
                {/* Progress */}
                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <div className="font-display text-2xl tracking-wider" style={{ color: 'var(--progress-color, #9bff5c)' }}>
                      {(() => {
                        const d = convertForDisplay(total, meta.unit, system);
                        return `${d.value.toFixed(meta.unit === 'kcal' || meta.unit === 'ml' || meta.unit === 'g' ? 0 : 1)} ${d.unit}`;
                      })()}
                    </div>
                    <div className="text-[10px] font-mono text-ink-300">
                      target{' '}
                      <span className="text-ink-100">
                        {(() => {
                          const d = convertForDisplay(target, meta.unit, system);
                          return `${d.value.toFixed(0)} ${d.unit}`;
                        })()}
                      </span>{' '}
                      ({Math.round(pct)}%)
                    </div>
                  </div>
                  <div className="h-2 bg-bg-700 border border-ink-500/30">
                    <div
                      className="h-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 100 ? '#9bff5c' : pct >= 60 ? '#14d6e8' : '#ffc34d',
                        boxShadow: '0 0 6px currentColor',
                      }}
                    />
                  </div>
                </div>

                {/* Quick add row */}
                <div className="flex items-center gap-2">
                  {isWater && (
                    <>
                      <QuickBtn label="+250 ml" onClick={() => {
                        batchM.run([{ metric: m, value: 250 + (sumByMetric.get(m) ?? 0) }]);
                      }} />
                      <QuickBtn label="+500 ml" onClick={() => {
                        batchM.run([{ metric: m, value: 500 + (sumByMetric.get(m) ?? 0) }]);
                      }} />
                    </>
                  )}
                  <input
                    className="input-neon flex-1"
                    type="number"
                    min={0}
                    step={isWater ? 50 : 1}
                    placeholder={isWater ? '+ ml' : 'amount'}
                    value={drafts[m] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [m]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && drafts[m]) commit(m, true);
                    }}
                  />
                  <NeonButton
                    onClick={() => commit(m, true)}
                    loading={batchM.isPending}
                    disabled={!drafts[m]}
                    variant="lime"
                    icon="+"
                    loadingText="…"
                  >
                    Add
                  </NeonButton>
                </div>

                {/* Replace mode (sets to absolute value) */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => commit(m, false)}
                    disabled={!drafts[m] || batchM.isPending}
                    className="text-[10px] font-mono text-ink-400 hover:text-neon-cyan disabled:opacity-40"
                  >
                    Set to absolute value →
                  </button>
                  {lastEntry && (
                    <span className="text-[10px] font-mono text-ink-500 ml-auto">
                      last log {formatRelative(lastEntry.recordedAt)}
                    </span>
                  )}
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-900/80">
          <div className="bg-bg-800 border border-neon-cyan/40 max-w-md w-full mx-4 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="font-display tracking-widest text-ink-50">Daily Targets</div>
              <button onClick={() => setEditing(false)} className="text-ink-400 hover:text-ink-100">✕</button>
            </div>
            <div className="space-y-3">
              {metrics.map((m) => {
                const meta = METRICS[m];
                const d = convertForDisplay(targets[m] ?? meta.defaultMin, meta.unit, system);
                return (
                  <div key={m}>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
                      {meta.label} ({displayUnit(meta.unit, system)})
                    </label>
                    <input
                      className="input-neon w-full"
                      type="number"
                      min={1}
                      value={targetDrafts[m] ?? `${d.value.toFixed(0)}`}
                      onChange={(e) => setTargetDrafts((td) => ({ ...td, [m]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <NeonButton onClick={() => setEditing(false)} variant="cyan">Cancel</NeonButton>
              <NeonButton onClick={saveTargets} icon="⚡" variant="lime">Save</NeonButton>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function QuickBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1 text-[10px] font-mono border border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/10"
    >
      {label}
    </button>
  );
}