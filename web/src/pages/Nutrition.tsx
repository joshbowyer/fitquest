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

      <TrackedItemsPanel
        categoryFilter={['VITAMIN', 'MINERAL', 'FATTY_ACID', 'HERB', 'AMINO_ACID', 'OTHER']}
        title="Supplements"
        variant="violet"
        emptyMessage="No supplements tracked yet. Tap + Add item to start your daily checklist."
        defaultUnitHint="Amounts usually don't vary. Default dose is used each check-off."
        qc={qc}
      />
      <TrackedItemsPanel
        categoryFilter="PROBIOTIC_ONLY"
        title="Probiotics"
        variant="lime"
        emptyMessage="No probiotics tracked. Tap + Add item to add one (CFU recommended)."
        defaultUnitHint="Probiotics are typically measured in CFU (colony-forming units)."
        qc={qc}
      />
      <SubstancesPanel />

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
// Tracked items (supplements + probiotics) + substance events.
//
// Three panels:
//   - Supplements:   vitamins, minerals, fats, herbs, amino acids
//   - Probiotics:    same data model, category=PROBIOTIC, unit=CFU
//   - Substances:    one-shot event log (nicotine / caffeine /
//                    alcohol / electrolytes) with form metadata
//
// Items in the Supplements/Probiotics panels are user-owned (no
// defaults). The user adds what they actually take; the list
// persists across days. Each item gets a daily check-off that
// resets at midnight (because the date key changes).
//
// Creatine is highlighted specifically because it auto-affects the
// lean-mass display (subtracts ~1.5 kg water when logged on ≥3 of
// the last 7 days, computed server-side in /me).
// ============================================================

type TrackedItem = {
  id: string;
  name: string;
  category: 'VITAMIN' | 'MINERAL' | 'FATTY_ACID' | 'PROBIOTIC' | 'HERB' | 'AMINO_ACID' | 'OTHER';
  defaultDose: number;
  doseUnit: 'mg' | 'g' | 'mcg' | 'iu' | 'cfu' | 'capsule' | 'drop' | 'scoop' | 'pill';
  notes: string | null;
  createdAt: string;
  today: {
    logId: string;
    dose: number;
    doseUnit: string;
    checkedAt: string;
  } | null;
};

type TrackedSummary = {
  items: TrackedItem[];
};

const CATEGORY_LABEL: Record<TrackedItem['category'], string> = {
  VITAMIN: 'Vitamin',
  MINERAL: 'Mineral',
  FATTY_ACID: 'Fatty Acid',
  PROBIOTIC: 'Probiotic',
  HERB: 'Herb',
  AMINO_ACID: 'Amino Acid',
  OTHER: 'Other',
};

// All non-probiotic categories go in the Supplements panel.
const SUPPLEMENT_CATEGORIES: TrackedItem['category'][] = [
  'VITAMIN', 'MINERAL', 'FATTY_ACID', 'HERB', 'AMINO_ACID', 'OTHER',
];

type SubstanceCategory = 'NICOTINE' | 'CAFFEINE' | 'ALCOHOL' | 'ELECTROLYTE';

type SubstanceForm = {
  category: SubstanceCategory;
  form: string;
  label: string;
  defaultUnit: string;
};

// Per-category form catalog. Drives the quick chips in the Substances
// panel. Each form has a different recovery/sleep/lung impact that
// the morning report will weave into its narrative.
const SUBSTANCE_FORMS: Record<SubstanceCategory, SubstanceForm[]> = {
  NICOTINE: [
    { category: 'NICOTINE', form: 'cigarette',     label: 'Cigarette',    defaultUnit: 'count' },
    { category: 'NICOTINE', form: 'vape',           label: 'Vape',         defaultUnit: 'session' },
    { category: 'NICOTINE', form: 'zyn',            label: 'Zyn',          defaultUnit: 'pouch' },
    { category: 'NICOTINE', form: 'hookah',         label: 'Hookah',       defaultUnit: 'session' },
    { category: 'NICOTINE', form: 'cigar',          label: 'Cigar',        defaultUnit: 'count' },
    { category: 'NICOTINE', form: 'chew',           label: 'Chewing tob.', defaultUnit: 'piece' },
  ],
  CAFFEINE: [
    { category: 'CAFFEINE', form: 'coffee',         label: 'Coffee',       defaultUnit: 'cup' },
    { category: 'CAFFEINE', form: 'tea',            label: 'Tea',          defaultUnit: 'cup' },
    { category: 'CAFFEINE', form: 'energy_drink',   label: 'Energy drink', defaultUnit: 'can' },
    { category: 'CAFFEINE', form: 'pre_workout',    label: 'Pre-workout',  defaultUnit: 'scoop' },
    { category: 'CAFFEINE', form: 'soda',           label: 'Soda',         defaultUnit: 'can' },
  ],
  ALCOHOL: [
    { category: 'ALCOHOL',  form: 'beer',           label: 'Beer',         defaultUnit: 'drink' },
    { category: 'ALCOHOL',  form: 'wine',           label: 'Wine',         defaultUnit: 'glass' },
    { category: 'ALCOHOL',  form: 'spirits',        label: 'Spirits',      defaultUnit: 'shot' },
    { category: 'ALCOHOL',  form: 'seltzer',        label: 'Hard seltzer', defaultUnit: 'can' },
    { category: 'ALCOHOL',  form: 'cider',          label: 'Cider',        defaultUnit: 'can' },
  ],
  ELECTROLYTE: [
    { category: 'ELECTROLYTE', form: 'lmnt',         label: 'LMNT',         defaultUnit: 'packet' },
    { category: 'ELECTROLYTE', form: 'salt_capsule', label: 'Salt capsule', defaultUnit: 'cap' },
    { category: 'ELECTROLYTE', form: 'liquid_iv',    label: 'Liquid IV',    defaultUnit: 'packet' },
    { category: 'ELECTROLYTE', form: 'coconut_water',label: 'Coconut water',defaultUnit: 'cup' },
  ],
};

const SUBSTANCE_CATEGORY_LABEL: Record<SubstanceCategory, string> = {
  NICOTINE: 'Nicotine',
  CAFFEINE: 'Caffeine',
  ALCOHOL: 'Alcohol',
  ELECTROLYTE: 'Electrolyte',
};

const SUBSTANCE_VARIANT: Record<SubstanceCategory, 'magenta' | 'amber' | 'violet' | 'lime'> = {
  NICOTINE: 'magenta',
  CAFFEINE: 'amber',
  ALCOHOL: 'violet',
  ELECTROLYTE: 'lime',
};

// ============================================================================
// TrackedItemsPanel — shared between Supplements + Probiotics
// ============================================================================

function TrackedItemsPanel({
  categoryFilter,
  title,
  variant,
  emptyMessage,
  defaultUnitHint,
  qc,
}: {
  categoryFilter: TrackedItem['category'][] | 'PROBIOTIC_ONLY';
  title: string;
  variant: 'cyan' | 'magenta' | 'amber' | 'lime' | 'violet';
  emptyMessage: string;
  defaultUnitHint: string;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const summaryQ = useQuery({
    queryKey: ['supplements', 'tracked'],
    queryFn: () => api<TrackedSummary>('/supplements/tracked'),
    refetchInterval: 60_000,
  });

  const items = (summaryQ.data?.items ?? []).filter((i) =>
    categoryFilter === 'PROBIOTIC_ONLY'
      ? i.category === 'PROBIOTIC'
      : categoryFilter.includes(i.category),
  );

  const checkM = useDelayedMutation<{ log: { id: string } }, { id: string }>({
    mutationFn: ({ id }) =>
      api(`/supplements/tracked/${id}/check`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplements', 'tracked'] }),
  }, 300);
  const uncheckM = useDelayedMutation<{ ok: boolean }, { id: string }>({
    mutationFn: ({ id }) => api(`/supplements/tracked/${id}/check`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplements', 'tracked'] }),
  }, 300);
  const removeM = useDelayedMutation<{ ok: boolean }, { id: string }>({
    mutationFn: ({ id }) => api(`/supplements/tracked/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplements', 'tracked'] }),
  }, 400);

  const [adding, setAdding] = useState(false);

  // Creatine summary (only relevant for the Supplements panel)
  const creatineItem = items.find((i) => i.name.toLowerCase() === 'creatine');
  const creatineDoneToday = !!creatineItem?.today;

  function toggleItem(item: TrackedItem) {
    if (item.today) {
      uncheckM.run({ id: item.id });
    } else {
      checkM.run({ id: item.id });
    }
  }

  return (
    <Panel variant={variant} title={title} className="mt-4">
      <div className="text-[10px] font-mono text-ink-300 mb-3">
        {categoryFilter === 'PROBIOTIC_ONLY'
          ? 'Daily probiotics. No defaults — items appear as you add them. Resets at midnight.'
          : 'No defaults — items appear as you add them. Resets at midnight; amounts usually do not vary.'}
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-slate-400 font-mono py-2 text-center">
          {emptyMessage}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mb-3">
          {items.map((item) => {
            const done = !!item.today;
            return (
              <div
                key={item.id}
                className={classNames(
                  'group inline-flex items-stretch border text-xs font-mono overflow-hidden',
                  done
                    ? 'border-neon-lime/60 bg-neon-lime/10 text-neon-lime'
                    : 'border-ink-500/30 text-ink-200 hover:border-ink-300',
                )}
                title={
                  done
                    ? `Logged today at ${new Date(item.today!.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                    : `Tap to log ${item.defaultDose}${formatUnitShort(item.doseUnit)} of ${item.name}`
                }
              >
                <button
                  onClick={() => toggleItem(item)}
                  disabled={checkM.isPending || uncheckM.isPending}
                  className="px-3 py-2 flex items-center gap-1.5"
                >
                  <span className={done ? 'text-neon-lime' : 'text-ink-500'}>
                    {done ? '✓' : '○'}
                  </span>
                  <span>{item.name}</span>
                  <span className="text-ink-400 text-[10px]">
                    · {item.defaultDose}{formatUnitShort(item.doseUnit)}
                  </span>
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Remove "${item.name}" from your tracked items?`)) {
                      removeM.run({ id: item.id });
                    }
                  }}
                  className={classNames(
                    'px-2 border-l text-base leading-none',
                    done
                      ? 'border-neon-lime/30 text-neon-lime/60 hover:text-neon-magenta hover:bg-neon-magenta/10'
                      : 'border-ink-500/30 text-ink-500 hover:text-neon-magenta hover:bg-neon-magenta/10',
                  )}
                  title="Remove from your tracked items"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-ink-500/15 pt-2">
        <span className="text-[10px] font-mono text-ink-400">
          {defaultUnitHint}
        </span>
        <NeonButton
          size="sm"
          variant={variant}
          onClick={() => setAdding(true)}
          icon="+"
        >
          Add item
        </NeonButton>
      </div>

      {/* Creatine highlight (Supplements panel only) */}
      {categoryFilter !== 'PROBIOTIC_ONLY' && creatineItem && (
        <div className="mt-2 text-[10px] font-mono text-ink-400">
          Creatine:{' '}
          <span className={creatineDoneToday ? 'text-neon-lime' : 'text-ink-300'}>
            {creatineDoneToday ? '✓ today' : '○ not yet today'}
          </span>
          {' '}— water-weight accounting fires at ≥3 of last 7 days.
        </div>
      )}

      {adding && (
        <AddTrackedItemModal
          defaultCategory={categoryFilter === 'PROBIOTIC_ONLY' ? 'PROBIOTIC' : 'VITAMIN'}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            qc.invalidateQueries({ queryKey: ['supplements', 'tracked'] });
          }}
        />
      )}
    </Panel>
  );
}

function formatUnitShort(u: string): string {
  // Display unit compactly. mg stays mg; long names get a compact form.
  if (u === 'mcg') return 'mcg';
  if (u === 'capsule') return 'cap';
  return u;
}

function AddTrackedItemModal({
  defaultCategory,
  onClose,
  onAdded,
}: {
  defaultCategory: TrackedItem['category'];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<TrackedItem['category']>(defaultCategory);
  const [dose, setDose] = useState('');
  const [unit, setUnit] = useState<TrackedItem['doseUnit']>(
    defaultCategory === 'PROBIOTIC' ? 'cfu' : 'mg',
  );
  const [notes, setNotes] = useState('');

  const addM = useDelayedMutation<{ item: TrackedItem; deduplicated: boolean }>({
    mutationFn: () =>
      api('/supplements/tracked', {
        method: 'POST',
        body: {
          name: name.trim(),
          category,
          defaultDose: Number(dose) || 0,
          doseUnit: unit,
          notes: notes.trim() || null,
        },
      }),
    onSuccess: (r) => {
      if (r.deduplicated) {
        alert(`"${name}" is already in your list.`);
      }
      onAdded();
    },
  }, 500);

  const valid =
    name.trim().length > 0 &&
    Number(dose) > 0 &&
    Number(dose) <= 100000;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-900/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-800 border border-neon-violet/40 max-w-md w-full p-5 panel-violet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="font-display tracking-widest text-ink-50">Add tracked item</div>
          <button onClick={onClose} className="text-ink-300 hover:text-ink-100">✕</button>
        </div>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-xs uppercase text-slate-500">Name</span>
            <input
              autoFocus
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vitamin D3, Magnesium Glycinate, Culturelle, ..."
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs uppercase text-slate-500">Category</span>
              <select
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                value={category}
                onChange={(e) => {
                  const next = e.target.value as TrackedItem['category'];
                  setCategory(next);
                  // When switching to PROBIOTIC, suggest cfu; otherwise mg.
                  if (next === 'PROBIOTIC' && unit !== 'cfu') setUnit('cfu');
                  if (next !== 'PROBIOTIC' && unit === 'cfu') setUnit('mg');
                }}
              >
                {(['VITAMIN', 'MINERAL', 'FATTY_ACID', 'PROBIOTIC', 'HERB', 'AMINO_ACID', 'OTHER'] as const).map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs uppercase text-slate-500">Dose</span>
                <input
                  type="number"
                  step="any"
                  min="0"
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                  value={dose}
                  onChange={(e) => setDose(e.target.value)}
                  placeholder="2000"
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase text-slate-500">Unit</span>
                <select
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as TrackedItem['doseUnit'])}
                >
                  {(['mg', 'g', 'mcg', 'iu', 'cfu', 'capsule', 'drop', 'scoop', 'pill'] as const).map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <label className="block">
            <span className="text-xs uppercase text-slate-500">Notes <span className="text-slate-600">(optional)</span></span>
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="with breakfast, before bed, ..."
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <NeonButton variant="cyan" onClick={onClose}>
            Cancel
          </NeonButton>
          <NeonButton
            variant="violet"
            onClick={() => addM.run()}
            disabled={!valid || addM.isPending}
            loading={addM.isPending}
            loadingText="Adding…"
          >
            Add to my list
          </NeonButton>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SubstancesPanel — one-shot event log with form-keyed chips
// ============================================================================

type SubstanceLog = {
  id: string;
  category: SubstanceCategory;
  form: string;
  amount: number | null;
  unit: string | null;
  context: string | null;
  loggedAt: string;
};

type SubstanceSummary = {
  items: Array<{ category: string; form: string; count: number; lastLoggedAt: string }>;
  days: number;
};

function SubstancesPanel() {
  const qc = useQueryClient();
  const summaryQ = useQuery({
    queryKey: ['substances', 'summary'],
    queryFn: () => api<SubstanceSummary>('/substances/summary'),
    refetchInterval: 60_000,
  });
  const recentQ = useQuery({
    queryKey: ['substances', 'recent'],
    queryFn: () => api<{ items: SubstanceLog[] }>('/substances?days=7'),
    refetchInterval: 60_000,
  });

  const logM = useDelayedMutation<{ log: SubstanceLog }, { category: SubstanceCategory; form: string; amount?: number; unit?: string; context?: string }>({
    mutationFn: (body) => api('/substances', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['substances'] });
    },
  }, 300);

  const delM = useDelayedMutation<{ ok: boolean }, { id: string }>({
    mutationFn: ({ id }) => api(`/substances/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['substances'] }),
  }, 200);

  return (
    <Panel variant="cyan" title="Substances (last 7 days)" className="mt-4">
      <div className="text-[10px] font-mono text-ink-300 mb-3">
        Event log — each tap records one consumption. Used by the morning
        report to give honest feedback on nicotine, caffeine, alcohol, and
        electrolyte intake. Not framed as a penalty.
      </div>

      {(['NICOTINE', 'CAFFEINE', 'ALCOHOL', 'ELECTROLYTE'] as const).map((cat) => {
        const variant = SUBSTANCE_VARIANT[cat];
        return (
          <div key={cat} className="mb-3">
            <div className="text-[10px] font-display tracking-widest uppercase text-slate-400 mb-1">
              {SUBSTANCE_CATEGORY_LABEL[cat]}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUBSTANCE_FORMS[cat].map((f) => (
                <button
                  key={`${cat}:${f.form}`}
                  onClick={() => {
                    logM.run({ category: cat, form: f.form, amount: 1, unit: f.defaultUnit });
                  }}
                  disabled={logM.isPending}
                  className={classNames(
                    'px-2.5 py-1 text-[11px] font-mono border transition-all',
                    'border-ink-500/30 text-ink-200 hover:border-neon-cyan/60',
                  )}
                  title={`Log 1 ${f.defaultUnit} of ${f.label}`}
                >
                  + {f.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {/* Recent entries */}
      {(recentQ.data?.items ?? []).length > 0 && (
        <div className="mt-3 pt-2 border-t border-ink-500/15">
          <div className="text-[10px] font-display tracking-widest uppercase text-slate-400 mb-1.5">
            Recent
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {(recentQ.data?.items ?? []).slice(0, 12).map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between text-[11px] font-mono py-1 px-1 hover:bg-slate-800/40 group"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="text-slate-400 shrink-0">
                    {new Date(l.loggedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span className={classNames(
                    'shrink-0',
                    `neon-text-${SUBSTANCE_VARIANT[l.category]}`,
                  )}>
                    {l.category.toLowerCase()}
                  </span>
                  <span className="text-slate-200 truncate">
                    {l.form.replace(/_/g, ' ')}
                    {l.amount != null ? ` · ${l.amount}${l.unit ?? ''}` : ''}
                  </span>
                  {l.context && (
                    <span className="text-slate-500 text-[10px] italic truncate">— {l.context}</span>
                  )}
                </div>
                <button
                  onClick={() => delM.run({ id: l.id })}
                  className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 text-xs shrink-0"
                  title="Delete this log"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
