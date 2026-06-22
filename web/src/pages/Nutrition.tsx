import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { TrackedItemCategory, TrackedItemUnit } from '@/lib/types';
import { classNames } from '@/lib/format';
import { convertForDisplay, type UnitSystem } from '@/lib/units';
import { FoodPanel } from '@/components/FoodPanel';
import { MealSections } from '@/components/MealSections';
import { DailyTotalsBar } from '@/components/DailyTotalsBar';

// ============================================================================
// Nutrition page (post FoodYou rewrite)
// ============================================================================
//
// Layout:
//   1. PageHeader (no Targets button — those live in /settings)
//   2. DailyTotalsBar (cal / p / c / f / water + progress vs goal)
//   3. 2-column: left = FoodPanel (search + Ask AI + recent),
//                 right = MealSections (BREAKFAST/LUNCH/DINNER/SNACK)
//   4. TrackedItemsPanel (Supplements)
//   5. TrackedItemsPanel (Probiotics)
//   6. SubstancesPanel
//
// Water macro panel removed (water is now in the daily totals bar).
// Calorie / protein / carb / fat macro panels removed (those numbers
// come from the food tracker's meal sections via DailyTotalsBar).
// ============================================================================

export function NutritionPage() {
  const { user } = useAuth();
  const system: UnitSystem = user?.units ?? 'METRIC';
  const t = user?.targets;

  return (
    <Layout>
      <PageHeader
        title="// Nutrition"
        subtitle={
          t
            ? (() => {
                const w = convertForDisplay(t.waterGoalMl, 'ml', system);
                return `Goal: ${t.goal.toLowerCase()} · ${t.calorieGoal} cal (${user?.calorieSource === 'BMR' ? 'BMR' : user?.calorieSource === 'BMR_NEAT' ? 'BMR+NEAT' : 'maintenance'} ${user?.calorieBaseline ?? 2200}) · ${t.proteinGoalG}g protein · ${w.value.toFixed(0)} ${w.unit} water (35 ml/kg)`;
              })()
            : 'Track your food and water. Daily targets are in /settings.'
        }
      />

      {/* Daily totals summary — derived from meal log + water measurements */}
      <DailyTotalsBar />

      {/* Water intake — preset chips + custom amount. Appends a WATER_ML
          measurement; the totals bar above picks it up on refetch. */}
      <WaterLogPanel units={system} />

      {/* Two-column: Food tracker (left) + Meal sections (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 md:mb-6">
        <FoodPanel />
        <MealSections />
      </div>

      {/* Supplements */}
      <TrackedItemsPanel
        categoryFilter={['VITAMIN', 'MINERAL', 'FATTY_ACID', 'HERB', 'AMINO_ACID', 'OTHER']}
        title="Supplements"
        variant="violet"
        emptyMessage="No supplements tracked yet. Tap + Add item to start your daily checklist."
        defaultUnitHint="Amounts usually don't vary. Default dose is used each check-off."
      />

      {/* Probiotics */}
      <TrackedItemsPanel
        categoryFilter="PROBIOTIC_ONLY"
        title="Probiotics"
        variant="lime"
        emptyMessage="No probiotics tracked. Tap + Add item to add one (CFU recommended)."
        defaultUnitHint="Probiotics are typically measured in CFU (colony-forming units)."
      />

      {/* Substances */}
      <SubstancesPanel />
    </Layout>
  );
}

// ============================================================================
// Re-export the existing TrackedItemsPanel and SubstancesPanel from
// the legacy module so this file is self-contained. The legacy module
// still exists at Nutrition.bak.tsx for reference.
// ============================================================================

// ----------------------------------------------------------------------------
// TrackedItemsPanel
// ----------------------------------------------------------------------------

type TrackedItemDto = {
  id: string;
  name: string;
  category: TrackedItemCategory;
  defaultDose: number;
  doseUnit: TrackedItemUnit;
  notes: string | null;
  createdAt: string;
  today: { logId: string; dose: number; doseUnit: string; checkedAt: string } | null;
};
type TrackedSummaryDto = { items: TrackedItemDto[] };

const CATEGORY_LABEL: Record<TrackedItemCategory, string> = {
  VITAMIN: 'Vitamin',
  MINERAL: 'Mineral',
  FATTY_ACID: 'Fatty Acid',
  PROBIOTIC: 'Probiotic',
  HERB: 'Herb',
  AMINO_ACID: 'Amino Acid',
  OTHER: 'Other',
};

const SUPPLEMENT_CATEGORIES: TrackedItemCategory[] = [
  'VITAMIN', 'MINERAL', 'FATTY_ACID', 'HERB', 'AMINO_ACID', 'OTHER',
];

type SubstanceCategory = 'NICOTINE' | 'CAFFEINE' | 'ALCOHOL' | 'ELECTROLYTE';

type SubstanceForm = {
  category: SubstanceCategory;
  form: string;
  label: string;
  defaultUnit: string;
};

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

function TrackedItemsPanel({
  categoryFilter,
  title,
  variant,
  emptyMessage,
  defaultUnitHint,
}: {
  categoryFilter: TrackedItemCategory[] | 'PROBIOTIC_ONLY';
  title: string;
  variant: 'cyan' | 'magenta' | 'amber' | 'lime' | 'violet';
  emptyMessage: string;
  defaultUnitHint: string;
}) {
  const qc = useQueryClient();
  const summaryQ = useQuery({
    queryKey: ['supplements', 'tracked'],
    queryFn: () => api<TrackedSummaryDto>('/supplements/tracked'),
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
  const creatineItem = items.find((i) => i.name.toLowerCase() === 'creatine');
  const creatineDoneToday = !!creatineItem?.today;
  function toggleItem(item: TrackedItemDto) {
    if (item.today) uncheckM.run({ id: item.id });
    else checkM.run({ id: item.id });
  }
  return (
    <Panel variant={variant} title={title} className="mt-4">
      <div className="text-[10px] font-mono text-ink-300 mb-3">
        {categoryFilter === 'PROBIOTIC_ONLY'
          ? 'Daily probiotics. No defaults — items appear as you add them. Resets at midnight.'
          : 'No defaults — items appear as you add them. Resets at midnight; amounts usually do not vary.'}
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-slate-400 font-mono py-2 text-center">{emptyMessage}</div>
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
        <span className="text-[10px] font-mono text-ink-400">{defaultUnitHint}</span>
        <NeonButton size="sm" variant={variant} onClick={() => setAdding(true)} icon="+">
          Add item
        </NeonButton>
      </div>
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
  if (u === 'mcg') return 'mcg';
  if (u === 'capsule') return 'cap';
  return u;
}

function AddTrackedItemModal({
  defaultCategory,
  onClose,
  onAdded,
}: {
  defaultCategory: TrackedItemCategory;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<TrackedItemCategory>(defaultCategory);
  const [dose, setDose] = useState('');
  const [unit, setUnit] = useState<TrackedItemUnit>(
    defaultCategory === 'PROBIOTIC' ? 'cfu' : 'mg',
  );
  const [notes, setNotes] = useState('');
  const addM = useDelayedMutation<{ item: TrackedItemDto; deduplicated: boolean }>({
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
      if (r.deduplicated) alert(`"${name}" is already in your list.`);
      onAdded();
    },
  }, 500);
  const valid = name.trim().length > 0 && Number(dose) > 0 && Number(dose) <= 100000;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg-900/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-bg-800 border border-neon-violet/40 max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
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
                  const next = e.target.value as TrackedItemCategory;
                  setCategory(next);
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
                  type="number" step="any" min="0"
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
                  onChange={(e) => setUnit(e.target.value as TrackedItemUnit)}
                >
                  {(['mg', 'g', 'mcg', 'iu', 'cfu', 'capsule', 'drop', 'scoop', 'pill'] as const).map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <label className="block">
            <span className="text-xs uppercase text-slate-500">Notes (optional)</span>
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="with breakfast, before bed, ..."
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <NeonButton variant="cyan" onClick={onClose}>Cancel</NeonButton>
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

// ----------------------------------------------------------------------------
// SubstancesPanel
// ----------------------------------------------------------------------------

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
  const recentQ = useQuery({
    queryKey: ['substances', 'recent'],
    queryFn: () => api<{ items: SubstanceLog[] }>('/substances?days=7'),
    refetchInterval: 60_000,
  });
  /// Tracks the key of the most recently-pressed substance button
  /// so we can flash it lime for 400ms after the tap. Optimistic
  /// updates happen via query cache mutation so the Recent list
  /// shows the new entry immediately, before the network round-trip.
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const logM = useDelayedMutation<{ log: SubstanceLog }, { category: SubstanceCategory; form: string; amount?: number; unit?: string; context?: string }>({
    mutationFn: (body) => api('/substances', { method: 'POST', body }),
    onMutate: (vars) => {
      // Optimistic insert: push a placeholder row into the cached
      // 'recent' list so the Recent panel updates instantly. The
      // id is fake ('optimistic-<ts>') so the row renders, but it
      // gets replaced by the real server row when the query
      // invalidates. If the POST fails we roll back by removing
      // the optimistic row.
      const key = `${vars.category}:${vars.form}`;
      const optimistic: SubstanceLog = {
        id: `optimistic-${Date.now()}`,
        category: vars.category,
        form: vars.form,
        amount: vars.amount ?? null,
        unit: vars.unit ?? null,
        context: vars.context ?? null,
        loggedAt: new Date().toISOString(),
      };
      qc.setQueryData<{ items: SubstanceLog[] }>(['substances', 'recent'], (prev) => ({
        items: [optimistic, ...(prev?.items ?? [])],
      }));
      setFlashKey(key);
      window.setTimeout(() => {
        setFlashKey((curr) => (curr === key ? null : curr));
      }, 450);
      return { optimisticId: optimistic.id };
    },
    onError: (_e, _vars, ctx) => {
      // Rollback: remove the optimistic row we inserted.
      if (ctx?.optimisticId) {
        qc.setQueryData<{ items: SubstanceLog[] }>(['substances', 'recent'], (prev) => ({
          items: (prev?.items ?? []).filter((l) => l.id !== ctx.optimisticId),
        }));
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['substances'] }),
  }, 300);
  const delM = useDelayedMutation<{ ok: boolean }, { id: string }>({
    mutationFn: ({ id }) => api(`/substances/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['substances'] }),
  }, 200);
  return (
    <Panel variant="cyan" title="Substances (last 7 days)" className="mt-4">
      <div className="text-[10px] font-mono text-ink-300 mb-3">
        Event log — each tap records one consumption. Used by the morning
        report to give honest feedback on nicotine, caffeine, alcohol,
        and electrolyte intake. Not framed as a penalty.
      </div>
      {(['NICOTINE', 'CAFFEINE', 'ALCOHOL', 'ELECTROLYTE'] as const).map((cat) => (
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
                  'px-2.5 py-1 text-[11px] font-mono border transition-colors duration-300',
                  flashKey === `${cat}:${f.form}`
                    // The flash overrides hover/pending for the brief
                    // 450ms window so the user sees a satisfying
                    // confirmation that the tap registered.
                    ? 'border-neon-lime text-neon-lime bg-neon-lime/15 shadow-[0_0_8px_rgba(155,255,92,0.5)]'
                    : 'border-ink-500/30 text-ink-200 hover:border-neon-cyan/60',
                )}
                title={`Log 1 ${f.defaultUnit} of ${f.label}`}
              >
                {flashKey === `${cat}:${f.form}` ? '✓' : '+'} {f.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {(recentQ.data?.items ?? []).length > 0 && (
        <div className="mt-3 pt-2 border-t border-ink-500/15">
          <div className="text-[10px] font-display tracking-widest uppercase text-slate-400 mb-1.5">Recent</div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {(recentQ.data?.items ?? []).slice(0, 12).map((l) => (
              <div key={l.id} className="flex items-center justify-between text-[11px] font-mono py-1 px-1 hover:bg-slate-800/40 group">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-slate-400 shrink-0">
                    {new Date(l.loggedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span className={classNames('shrink-0', `neon-text-${SUBSTANCE_VARIANT[l.category]}`)}>
                    {l.category.toLowerCase()}
                  </span>
                  <span className="text-slate-200 truncate">
                    {l.form.replace(/_/g, ' ')}
                    {l.amount != null ? ` · ${l.amount}${l.unit ?? ''}` : ''}
                  </span>
                  {l.context && <span className="text-slate-500 text-[10px] italic truncate">— {l.context}</span>}
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

// ============================================================================
// WaterLogPanel
// ============================================================================
//
// Inline "log a glass" UI. Preset chips for the common amounts + a
// custom ml input + Undo last. Each tap appends a WATER_ML
// measurement; the totals bar refetches on success.

function WaterLogPanel({ units }: { units: UnitSystem }) {
  const qc = useQueryClient();
  const [custom, setCustom] = useState('');
  const customNum = Number(custom);

  const todayQ = useQuery({
    queryKey: ['measurements', 'today', 'WATER_ML'],
    queryFn: () =>
      api<{ items: Array<{ id: string; recordedAt: string; value: number; unit: string }> }>(
        '/measurements?metric=WATER_ML&days=1',
      ),
    refetchInterval: 60_000,
  });
  const total = (todayQ.data?.items ?? []).reduce((s, m) => s + m.value, 0);
  const totalDisplay = convertForDisplay(total, 'ml', units);

  const logM = useDelayedMutation<{ item: { id: string } }, number>({
    mutationFn: (ml) =>
      api('/measurements', {
        method: 'POST',
        body: { metric: 'WATER_ML', value: ml, unit: 'ml' },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['measurements', 'today', 'WATER_ML'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      setCustom('');
    },
  }, 300);
  const undoM = useDelayedMutation<{ ok: boolean }, string>({
    mutationFn: (id) => api(`/measurements/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['measurements', 'today', 'WATER_ML'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
    },
  }, 250);

  // Preset chips sized for both unit systems. Imperial uses fl oz
  // (small glass ~8oz, large ~16oz); metric uses ml (250/350/500).
  // Tooltips explain the size.
  const presets: { ml: number; label: string; title: string }[] =
    units === 'IMPERIAL'
      ? [
          { ml: 237, label: '+8 oz',   title: 'Small glass (~8 fl oz / 237 ml)' },
          { ml: 355, label: '+12 oz',  title: 'Tall glass / can (~12 fl oz / 355 ml)' },
          { ml: 473, label: '+16 oz',  title: 'Large cup / bottle (~16 fl oz / 473 ml)' },
          { ml: 710, label: '+24 oz',  title: 'Big bottle (~24 fl oz / 710 ml)' },
        ]
      : [
          { ml: 200, label: '+200',    title: 'Small cup (~200 ml)' },
          { ml: 250, label: '+250',    title: 'Standard glass (~250 ml)' },
          { ml: 350, label: '+350',    title: 'Tall glass / can (~350 ml)' },
          { ml: 500, label: '+500',    title: 'Bottle (~500 ml)' },
          { ml: 750, label: '+750',    title: 'Large bottle (~750 ml)' },
        ];

  // Most recent entry (top of the list) — the one Undo deletes.
  const lastEntry = (todayQ.data?.items ?? [])[0];

  return (
    <Panel variant="cyan" title="Water intake" className="mb-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {presets.map((p) => (
          <button
            key={p.ml}
            type="button"
            onClick={() => logM.run(p.ml)}
            disabled={logM.isPending}
            className="px-3 h-8 text-[11px] font-mono border border-ink-500/40 text-ink-200 hover:border-neon-cyan/60 hover:bg-neon-cyan/5"
            title={p.title}
          >
            {p.label}
          </button>
        ))}
        <div className="flex items-center gap-1 ml-auto">
          <input
            type="number"
            min="1"
            step="1"
            placeholder={units === 'IMPERIAL' ? 'fl oz' : 'ml'}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="w-20 input-neon text-xs"
            title={units === 'IMPERIAL' ? 'Custom amount in fl oz' : 'Custom amount in ml'}
          />
          {units === 'IMPERIAL' && (
            <span className="text-[10px] font-mono text-ink-400">fl oz</span>
          )}
          <NeonButton
            size="sm"
            variant="cyan"
            disabled={!Number.isFinite(customNum) || customNum <= 0 || logM.isPending}
            loading={logM.isPending}
            loadingText="…"
            onClick={() => {
              if (units === 'IMPERIAL') {
                // convert fl oz to ml for storage
                logM.run(Math.round(customNum * 29.5735));
              } else {
                logM.run(Math.round(customNum));
              }
            }}
          >
            Log
          </NeonButton>
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono text-ink-300">
        <span>
          {todayQ.isLoading ? '…' : `${totalDisplay.value.toFixed(0)} ${totalDisplay.unit} logged today`}
          {lastEntry && (
            <span className="ml-2 text-ink-500">
              · last {new Date(lastEntry.recordedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </span>
        {lastEntry && (
          <button
            type="button"
            onClick={() => undoM.run(lastEntry.id)}
            disabled={undoM.isPending}
            className="text-ink-400 hover:text-rose-400"
            title="Delete the most recent water entry"
          >
            ↶ undo last
          </button>
        )}
      </div>
    </Panel>
  );
}
