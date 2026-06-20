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

      <SupplementsPanel />

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
// ============================================================
// Supplements — daily checkbox tracker. Creatine specifically
// affects lean-mass display (subtracts ~1.5 kg water when logged on
// ≥3 of the last 7 days, server-derived in /me).
// ============================================================

type SupplementItem = {
  name: string;
  daysLast7: number;
  latestDoseMg: number | null;
  latestAt: string;
};

type SupplementSummary = {
  items: SupplementItem[];
  creatine: SupplementItem | null;
  creatineActive: boolean;
};

const QUICK_SUPPLEMENTS = [
  { name: 'Creatine',    defaultDoseMg: 5000 },
  { name: 'Vitamin D3',  defaultDoseMg: 2000 },
  { name: 'Omega-3',     defaultDoseMg: 1000 },
  { name: 'Magnesium',   defaultDoseMg: 300 },
  { name: 'Zinc',        defaultDoseMg: 15 },
];

function SupplementsPanel() {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [customName, setCustomName] = useState('');
  const [customDose, setCustomDose] = useState('');

  const summaryQ = useQuery({
    queryKey: ['supplements', 'summary'],
    queryFn: () => api<SupplementSummary>('/supplements/summary'),
    refetchInterval: 60_000,
  });

  const logM = useDelayedMutation<{ log: { id: string } }, { name: string; doseMg?: number | null }>({
    mutationFn: (body) => api('/supplements', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplements'] });
      qc.invalidateQueries({ queryKey: ['auth'] });
      qc.invalidateQueries({ queryKey: ['user'] });
    },
  }, 400);

  // Was the user already credited with this supplement today?
  const creatine = summaryQ.data?.creatine;
  const creatineDoneToday =
    !!creatine &&
    new Date(creatine.latestAt).toDateString() === new Date().toDateString();

  function isDoneToday(name: string, item?: SupplementItem | null): boolean {
    if (!item) return false;
    return new Date(item.latestAt).toDateString() === new Date().toDateString();
  }

  function togglePick(name: string) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function logOne(name: string, doseMg: number | null) {
    logM.run({ name, doseMg });
    setPicked((p) => {
      const next = new Set(p);
      next.delete(name);
      return next;
    });
  }

  function logCustom() {
    const name = customName.trim();
    if (!name) return;
    const dose = Number(customDose);
    logM.run({ name, doseMg: Number.isFinite(dose) && dose > 0 ? dose : null });
    setCustomName('');
    setCustomDose('');
  }

  const creatineDays = summaryQ.data?.creatine?.daysLast7 ?? 0;

  return (
    <Panel variant="violet" title="Supplements" className="mt-4">
      <div className="text-[10px] font-mono text-ink-300 mb-3">
        Tap to log a dose. Creatine active = logged on ≥3 of the last 7 days
        (auto-applies to lean-mass display).
      </div>

      {/* Quick chips */}
      <div className="flex flex-wrap gap-2 mb-3">
        {QUICK_SUPPLEMENTS.map((s) => {
          const item = summaryQ.data?.items.find((i) => i.name.toLowerCase() === s.name.toLowerCase());
          const doneToday = isDoneToday(s.name, item);
          return (
            <button
              key={s.name}
              onClick={() => logOne(s.name, s.defaultDoseMg)}
              disabled={logM.isPending}
              className={classNames(
                'px-3 py-2 text-xs font-mono border transition-all',
                doneToday
                  ? 'border-neon-lime/60 bg-neon-lime/10 text-neon-lime'
                  : picked.has(s.name)
                  ? 'border-neon-violet bg-neon-violet/10 text-neon-violet'
                  : 'border-ink-500/30 text-ink-200 hover:border-neon-violet/60',
              )}
              title={doneToday ? `Logged today (${s.defaultDoseMg} mg)` : `Log ${s.name} ${s.defaultDoseMg} mg`}
            >
              {doneToday ? '✓ ' : '+ '}{s.name} · {s.defaultDoseMg}mg
            </button>
          );
        })}
      </div>

      {/* Custom entry */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          className="input-neon flex-1 min-w-[160px] text-xs"
          placeholder="Custom supplement…"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
        />
        <input
          className="input-neon w-24 text-xs"
          type="number"
          min={0}
          placeholder="mg"
          value={customDose}
          onChange={(e) => setCustomDose(e.target.value)}
        />
        <NeonButton
          onClick={logCustom}
          loading={logM.isPending}
          disabled={!customName.trim()}
          variant="violet"
          icon="+"
          loadingText="Logging…"
        >
          Log
        </NeonButton>
      </div>

      {/* Creatine active summary */}
      <div
        className={classNames(
          'border p-3 flex items-center justify-between',
          creatineDays >= 3 ? 'border-neon-lime/50 bg-neon-lime/5' : 'border-ink-500/30',
        )}
      >
        <div>
          <div className="text-xs font-mono text-ink-100">
            Creatine ·{' '}
            <span className={creatineDays >= 3 ? 'text-neon-lime' : 'text-ink-300'}>
              {creatineDays} of last 7 days
            </span>
          </div>
          <div className="text-[10px] font-mono text-ink-400 mt-0.5">
            {creatineDays >= 3
              ? 'Creatine active — ~1.5 kg water weight subtracted from lean mass.'
              : `Log on ${3 - creatineDays} more day${3 - creatineDays === 1 ? '' : 's'} for water-weight accounting to apply.`}
          </div>
        </div>
        <div
          className="text-[10px] font-mono px-2 py-1 border"
          style={{
            color: creatineDays >= 3 ? '#9bff5c' : '#3f3f46',
            borderColor: creatineDays >= 3 ? '#9bff5c66' : '#27272a',
          }}
        >
          {creatineDoneToday ? '✓ TODAY' : 'NOT YET'}
        </div>
      </div>
    </Panel>
  );
}
