import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from './Modal';
import { NeonButton } from './NeonButton';
import { ActionTile, QuickActionGrid } from './QuickActionGrid';
import { WorkoutLogger } from './WorkoutLogger';
import { QuickLogModal as CheckInsQuickLogModal, type DueMetricDto } from './CheckInsPanel';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { classNames } from '@/lib/format';
import { convertForDisplay, type UnitSystem } from '@/lib/units';

/**
 * Window event the parent page dispatches when a non-tile UI
 * element (e.g. the WORKOUT daily row) wants to open the Activity
 * log modal. Keeps the openModal state inside TodayActions without
 * forcing the parent to thread props down.
 */
export const OPEN_ACTIVITY_EVENT = 'fitquest:open-activity';

/**
 * /today action grid + modals. Each tile opens a focused log modal
 * for its category. Designed for one-tap logging from the
 * dashboard.
 *
 * Tile list:
 *  - Water       inline-form (kept in the parent Today page; passed
 *                as a slot so the parent can render it however it wants)
 *  - Food        → FoodLogModal: search OFF/USDA + saved-foods + manual
 *  - Supplements → SupplementLogModal: pick from UserTrackedItem
 *  - Probiotics  → SupplementLogModal with PROBIOTIC filter
 *  - Electrolytes→ SubstanceLogModal with category=ELECTROLYTE
 *  - Caffeine    → SubstanceLogModal with category=CAFFEINE
 *  - Alcohol     → SubstanceLogModal with category=ALCOHOL
 *  - Nicotine    → SubstanceLogModal with category=NICOTINE
 *  - Activity    → WorkoutLogger (the existing reusable component)
 *  - Prayer      → PrayerLogModal
 *  - Check-ins   → CheckIns QuickLogModal (existing in CheckInsPanel)
 *
 * Each modal is wrapped in its own <Modal> so the layout stays
 * consistent. They share a `useDelayedMutation` to disable the
 * tile + flash a green border on success.
 */

type SubstancesResponse = { items: Array<{ id: string; category: string; form: string; amount: number | null; unit: string | null; context: string | null; loggedAt: string }> };
type MeasurementsResponse = { items: Array<{ id: string; metric: string; value: number; recordedAt: string }> };
type SavedFoodDto = {
  id: string;
  name: string;
  brand: string | null;
  servingSizeG: number | null;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  useCount: number;
  lastUsedAt: string | null;
};
type FoodSearchHit = {
  source: 'OFF' | 'USDA' | 'MANUAL';
  sourceId: string;
  name: string;
  brand: string | null;
  servingSizeG: number | null;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
};

type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';

type TrackedItem = {
  id: string;
  name: string;
  category: 'VITAMIN' | 'MINERAL' | 'FATTY_ACID' | 'PROBIOTIC' | 'HERB' | 'AMINO_ACID' | 'OTHER';
  defaultDose: number;
  doseUnit: string;
};

type CheckInsDueResponse = {
  byCadence: Record<'AM' | 'PM' | 'WEEKLY', DueMetricDto[]>;
};

const PRAYER_LABELS: Record<string, string> = {
  ROSARY: 'Rosary',
  MASS: 'Mass',
  SCRIPTURE: 'Scripture Reading',
  CONTEMPLATION: 'Contemplation',
  LITURGY_HOURS: 'Liturgy of the Hours',
  CONFESSION: 'Confession',
  OTHER: 'Other Prayer',
};

const MEAL_LABELS: Record<MealType, string> = {
  BREAKFAST: 'Breakfast',
  LUNCH: 'Lunch',
  DINNER: 'Dinner',
  SNACK: 'Snack',
};

/**
 * Canonical forms per substance category. Shown alongside the
 * user's recently-logged forms so the picker isn't empty on first
 * use. User can still type a free-form value at the bottom for
 * anything not listed.
 *
 * Keep these short — long lists overwhelm the modal. Add a form
 * here when a category becomes commonly logged but the user has
 * never tried it.
 */
const CANONICAL_FORMS: Record<string, string[]> = {
  CAFFEINE: [
    'espresso', 'coffee', 'cold brew', 'latte', 'cappuccino', 'americano',
    'green tea', 'black tea', 'matcha', 'energy drink', 'pre-workout',
    'yerba mate', 'guarana',
  ],
  ALCOHOL: [
    'wine', 'red wine', 'white wine', 'beer', 'ipa', 'lager', 'stout',
    'whiskey', 'bourbon', 'scotch', 'vodka', 'rum', 'gin', 'tequila',
    'mezcal', 'cocktail', 'sake', 'cider', 'seltzer',
  ],
  NICOTINE: [
    'cigarette', 'cigar', 'pipe', 'vape', 'e-cigarette', 'nicotine gum',
    'nicotine pouch', 'pouch', 'zyn', 'on!', 'chew', 'dip', 'snus',
    'hookah', 'snuff',
  ],
  ELECTROLYTE: [
    'liquid iv', 'lmnt', 'nuun', 'pedialyte', 'salt tablet', 'potassium',
    'magnesium', 'sodium bicarb', 'coconut water', 'pickle juice',
    'sole water',
  ],
};

function inferMealType(): MealType {
  const h = new Date().getHours();
  if (h < 11) return 'BREAKFAST';
  if (h < 15) return 'LUNCH';
  if (h < 21) return 'DINNER';
  return 'SNACK';
}

export function TodayActions() {
  const qc = useQueryClient();
  const [openModal, setOpenModal] = useState<null | 'food' | 'supplements' | 'probiotics' | 'electrolytes' | 'caffeine' | 'alcohol' | 'nicotine' | 'activity' | 'prayer' | 'checkIns'>(null);
  const [prayerType, setPrayerType] = useState<keyof typeof PRAYER_LABELS | null>(null);
  const [checkInsMetric, setCheckInsMetric] = useState<DueMetricDto | null>(null);

  // Listen for the global "open Activity modal" event so other
  // surfaces (e.g. the WORKOUT daily row, the wall-mode shell) can
  // dispatch a programmatic trigger without prop-drilling.
  useEffect(() => {
    const handler = () => setOpenModal('activity');
    window.addEventListener(OPEN_ACTIVITY_EVENT, handler);
    return () => window.removeEventListener(OPEN_ACTIVITY_EVENT, handler);
  }, []);

  function close() {
    setOpenModal(null);
    setPrayerType(null);
    setCheckInsMetric(null);
    // Invalidate any queries that may have changed so the tile
    // summaries refresh next render.
    qc.invalidateQueries({ queryKey: ['today'] });
    qc.invalidateQueries({ queryKey: ['meals', 'today'] });
    qc.invalidateQueries({ queryKey: ['substances'] });
    qc.invalidateQueries({ queryKey: ['supplements'] });
    qc.invalidateQueries({ queryKey: ['measurements'] });
  }

  return (
    <>
      <QuickActionGrid>
        <WaterTile />
        <ActionTile
          glyph="◉"
          label="Food"
          accent="cyan"
          onClick={() => setOpenModal('food')}
          summary={<FoodSummary />}
        />
        <ActionTile
          glyph="℘"
          label="Supplements"
          accent="amber"
          onClick={() => setOpenModal('supplements')}
          summary={<SupplementSummary category={null} />}
        />
        <ActionTile
          glyph="⌬"
          label="Probiotics"
          accent="lime"
          onClick={() => setOpenModal('probiotics')}
          summary={<SupplementSummary category="PROBIOTIC" />}
        />
        <ActionTile
          glyph="⚡"
          label="Electrolytes"
          accent="cyan"
          onClick={() => setOpenModal('electrolytes')}
          summary={<SubstanceSummary category="ELECTROLYTE" days={1} />}
        />
        <ActionTile
          glyph="☕"
          label="Caffeine"
          accent="amber"
          onClick={() => setOpenModal('caffeine')}
          summary={<SubstanceSummary category="CAFFEINE" days={1} />}
        />
        <ActionTile
          glyph="🍷"
          label="Alcohol"
          accent="magenta"
          onClick={() => setOpenModal('alcohol')}
          summary={<SubstanceSummary category="ALCOHOL" days={7} />}
        />
        <ActionTile
          glyph="🚬"
          label="Nicotine"
          accent="magenta"
          onClick={() => setOpenModal('nicotine')}
          summary={<SubstanceSummary category="NICOTINE" days={1} />}
        />
        <ActionTile
          glyph="⚔"
          label="Activity"
          accent="cyan"
          onClick={() => setOpenModal('activity')}
          summary={<ActivitySummary />}
        />
        <ActionTile
          glyph="✝"
          label="Prayer"
          accent="violet"
          onClick={() => setOpenModal('prayer')}
          summary={<PrayerSummary />}
        />
        <ActionTile
          glyph="✓"
          label="Check-ins"
          accent="periwinkle"
          onClick={() => setOpenModal('checkIns')}
          summary={<CheckInsSummary onPick={setCheckInsMetric} />}
        />
      </QuickActionGrid>

      {openModal === 'food' && (
        <FoodLogModal open onClose={close} />
      )}
      {openModal === 'supplements' && (
        <SupplementLogModal open onClose={close} category={null} />
      )}
      {openModal === 'probiotics' && (
        <SupplementLogModal open onClose={close} category="PROBIOTIC" />
      )}
      {openModal === 'electrolytes' && (
        <SubstanceLogModal open onClose={close} category="ELECTROLYTE" days={1} label="Electrolyte" />
      )}
      {openModal === 'caffeine' && (
        <SubstanceLogModal open onClose={close} category="CAFFEINE" days={1} label="Caffeine" />
      )}
      {openModal === 'alcohol' && (
        <SubstanceLogModal open onClose={close} category="ALCOHOL" days={7} label="Alcohol" />
      )}
      {openModal === 'nicotine' && (
        <SubstanceLogModal open onClose={close} category="NICOTINE" days={1} label="Nicotine" />
      )}
      {openModal === 'activity' && (
        <WorkoutLoggerModal open onClose={close} />
      )}
      {openModal === 'prayer' && !prayerType && (
        <PrayerPickerModal open onClose={close} onPick={setPrayerType} />
      )}
      {openModal === 'prayer' && prayerType && (
        <PrayerLogModal open onClose={close} prayerType={prayerType} onSwitch={() => setPrayerType(null)} />
      )}
      {openModal === 'checkIns' && (
        <CheckInsPickerModal open onClose={close} onPick={setCheckInsMetric} />
      )}
      {openModal === 'checkIns' && checkInsMetric && (
        <CheckInsQuickLogModal
          open
          item={checkInsMetric}
          onClose={() => {
            setCheckInsMetric(null);
            close();
          }}
        />
      )}
    </>
  );
}

/* ============================================================
 * Tile summaries (small queries that run in the background so
 * each tile can show its current state without opening the modal)
 * ============================================================ */

function WaterTile() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['today', 'water'],
    queryFn: () => api<MeasurementsResponse>('/measurements?metric=WATER_ML&limit=200'),
    refetchInterval: 60_000,
  });
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const system: UnitSystem = (user?.units ?? 'METRIC') as UnitSystem;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let totalMl = 0;
  for (const m of q.data?.items ?? []) {
    if (new Date(m.recordedAt) >= today) totalMl += m.value;
  }
  const targetMl = user?.targets?.waterGoalMl ?? 2500;
  const pct = Math.min(100, Math.round((totalMl / targetMl) * 100));
  // Display in the user's preferred unit. Storage stays in ml.
  const totalDisp = convertForDisplay(totalMl, 'ml', system);
  const summaryStr = `${totalDisp.value.toFixed(1)} ${totalDisp.unit} · ${pct}%`;
  const logM = useMutation({
    mutationFn: (ml: number) =>
      api<{ id: string }>('/measurements', {
        method: 'POST',
        body: { metric: 'WATER_ML', value: ml, unit: 'ml', source: 'MANUAL' },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today', 'water'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['nutrition', 'water', 'today'] });
      setOpen(false);
      setValue('');
    },
  });
  return (
    <>
      <ActionTile
        glyph="💧"
        label="Water"
        accent="cyan"
        onClick={() => setOpen(true)}
        summary={<span className="text-ink-100">{summaryStr}</span>}
      />
      <Modal open={open} onClose={() => setOpen(false)} title="Log water" width="max-w-sm">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {[250, 500, 750, 1000].map((ml) => {
              // Pill labels show the user's preferred unit. POST
              // payload always uses ml (storage unit).
              const disp = convertForDisplay(ml, 'ml', system);
              const val = disp.value >= 100 ? Math.round(disp.value) : disp.value.toFixed(0);
              return (
                <button
                  key={ml}
                  type="button"
                  disabled={logM.isPending}
                  onClick={() => logM.mutate(ml)}
                  className="px-3 py-1.5 text-sm font-mono border border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10 rounded disabled:opacity-50"
                >
                  +{val} {disp.unit}
                </button>
              );
            })}
            </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="custom ml"
              autoFocus
              className="flex-1 bg-bg-900 border border-ink-700/40 px-2 py-1.5 text-sm font-mono rounded"
            />
            <button
              type="button"
              disabled={logM.isPending || !value}
              onClick={() => logM.mutate(Number(value))}
              className="px-3 py-1.5 text-sm font-mono border border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10 rounded disabled:opacity-50"
            >
              Log
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function FoodSummary() {
  const q = useQuery({
    queryKey: ['meals', 'today'],
    queryFn: () => api<{ dayTotals: { calories: number; proteinG: number } }>('/meals/today'),
  });
  const t = q.data?.dayTotals;
  return t ? (
    <span className="text-ink-100">
      {Math.round(t.calories)} kcal · {Math.round(t.proteinG)}g protein
    </span>
  ) : (
    <span className="text-ink-500">nothing logged</span>
  );
}

function SupplementSummary({ category }: { category: TrackedItem['category'] | null }) {
  const q = useQuery({
    queryKey: ['supplements', 'tracked'],
    queryFn: () => api<{ items: TrackedItem[] }>('/supplements/tracked'),
  });
  let total = q.data?.items.length ?? 0;
  let checkedToday = 0;
  if (q.data && category) {
    total = q.data.items.filter((i) => i.category === category).length;
  }
  return total > 0 ? (
    <span className="text-ink-100">
      {total} tracked · {checkedToday}/{total} today
    </span>
  ) : (
    <span className="text-ink-500">none tracked</span>
  );
}

function SubstanceSummary({ category, days }: { category: string; days: number }) {
  const q = useQuery({
    queryKey: ['substances', category, days],
    queryFn: () => api<SubstancesResponse>(`/substances?days=${days}`),
  });
  const count = (q.data?.items ?? []).filter((s) => s.category === category).length;
  return count > 0 ? (
    <span className="text-ink-100">
      {count} {count === 1 ? 'serving' : 'servings'} · last {days}d
    </span>
  ) : (
    <span className="text-ink-500">none logged</span>
  );
}

function ActivitySummary() {
  const q = useQuery({
    queryKey: ['today', 'workout'],
    queryFn: () => api<{ items: any[] }>('/workouts?limit=200'),
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCount = (q.data?.items ?? []).filter((w) => new Date(w.performedAt) >= today).length;
  return todayCount > 0 ? (
    <span className="text-neon-lime">✓ logged today</span>
  ) : (
    <span className="text-ink-500">not logged</span>
  );
}

function PrayerSummary() {
  // /spiritual returns the last 30 prayer logs (newest first).
  // Filter to today for the tile summary.
  const q = useQuery({
    queryKey: ['spiritual', 'logs'],
    queryFn: () => api<{ logs: Array<{ id: string; type: string | null; loggedAt: string }> }>('/spiritual'),
    refetchInterval: 60_000,
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayLogs = (q.data?.logs ?? []).filter((l) => new Date(l.loggedAt) >= today);
  return todayLogs.length > 0 ? (
    <span className="text-neon-lime">✓ {todayLogs.length} prayer{todayLogs.length === 1 ? '' : 's'} today</span>
  ) : (
    <span className="text-ink-500">not logged</span>
  );
}

function CheckInsSummary({ onPick }: { onPick: (m: DueMetricDto) => void }) {
  const q = useQuery({
    queryKey: ['check-ins', 'due'],
    queryFn: () => api<CheckInsDueResponse>('/check-ins/due'),
  });
  let total = 0;
  if (q.data) {
    total = Object.values(q.data.byCadence).reduce((s, arr) => s + arr.length, 0);
  }
  if (total === 0) {
    return <span className="text-neon-lime">✓ all caught up</span>;
  }
  // Tap on the tile summary opens the picker. Provide a small inline
  // list of the first few overdue items.
  return (
    <span className="text-ink-100">
      {total} due · tap to pick
    </span>
  );
}

/* ============================================================
 * Food log modal: search OFF/USDA + saved foods + Ask AI
 * multi-item entry.
 * ============================================================ */

function FoodLogModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'search' | 'ask'>('search');
  const [meal, setMeal] = useState<MealType>(inferMealType());

  return (
    <Modal open={open} onClose={onClose} title="Log food" width="max-w-2xl">
      <div className="space-y-4">
        {/* Mode selector + meal picker */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {(['search', 'ask'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={classNames(
                  'px-3 py-1 text-[10px] font-display tracking-widest uppercase border rounded',
                  mode === m
                    ? 'border-neon-cyan/60 text-neon-cyan bg-neon-cyan/10'
                    : 'border-ink-700/40 text-ink-300 hover:border-neon-cyan/40',
                )}
              >
                {m === 'search' ? 'Search' : 'Ask AI'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mr-1">Meal:</span>
            {(Object.keys(MEAL_LABELS) as MealType[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMeal(m)}
                className={classNames(
                  'px-2 py-0.5 text-xs border rounded',
                  meal === m
                    ? 'border-neon-cyan/60 text-neon-cyan bg-neon-cyan/10'
                    : 'border-ink-700/40 text-ink-300 hover:border-neon-cyan/40',
                )}
              >
                {MEAL_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {mode === 'search' ? <FoodSearchMode meal={meal} onClose={onClose} /> : <FoodAskAiMode meal={meal} onClose={onClose} />}
      </div>
    </Modal>
  );
}

/**
 * Search mode — debounced OFF/USDA query + saved foods for
 * quick-log. Single food at a time.
 */
function FoodSearchMode({ meal, onClose }: { meal: MealType; onClose: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [servings, setServings] = useState('1');
  const [searchTrigger, setSearchTrigger] = useState('');
  useEffect(() => {
    if (!q || q.length < 2) return;
    const t = setTimeout(() => setSearchTrigger(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const searchQ = useQuery({
    queryKey: ['foods', 'search', searchTrigger],
    queryFn: () => api<{ items: FoodSearchHit[] }>('/foods/search', { method: 'GET', query: { q: searchTrigger } }),
    enabled: searchTrigger.length >= 2,
  });
  const savedQ = useQuery({
    queryKey: ['foods', 'saved'],
    queryFn: () => api<{ items: SavedFoodDto[] }>('/foods/saved'),
  });

  const logSavedM = useDelayedMutation<{ entry: any }, { id: string; meal: MealType; servings: number }>({
    mutationFn: ({ id, meal, servings }) =>
      api(`/foods/saved/${id}/log`, { method: 'POST', body: { meal, servings } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meals', 'today'] });
      qc.invalidateQueries({ queryKey: ['nutrition', 'meals', 'today'] });
      onClose();
    },
  }, 300);

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search foods (OFF / USDA)…"
        autoFocus
        className="w-full bg-bg-900 border border-ink-700/40 px-3 py-2 text-sm font-mono rounded"
      />

      {q.length >= 2 && (
        <div className="max-h-48 overflow-y-auto border border-ink-700/40 rounded divide-y divide-ink-700/30">
          {(searchQ.data?.items ?? []).map((hit, i) => (
            <SearchResultRow
              key={`${hit.source}-${hit.sourceId}-${i}`}
              hit={hit}
              servings={servings}
              onLog={() => {
                api('/meals', {
                  method: 'POST',
                  body: {
                    meal,
                    servings: Number(servings) || 1,
                    source: hit.source,
                    sourceId: hit.sourceId,
                    name: hit.name,
                    brand: hit.brand ?? null,
                    servingSizeG: hit.servingSizeG ?? null,
                    calories: hit.calories,
                    proteinG: hit.proteinG,
                    carbG: hit.carbG,
                    fatG: hit.fatG,
                    fiberG: hit.fiberG ?? null,
                    sugarG: hit.sugarG ?? null,
                    sodiumMg: hit.sodiumMg ?? null,
                  },
                }).then(() => {
                  qc.invalidateQueries({ queryKey: ['meals', 'today'] });
                  qc.invalidateQueries({ queryKey: ['nutrition', 'meals', 'today'] });
                  onClose();
                });
              }}
            />
          ))}
          {searchQ.isLoading && (
            <div className="p-3 text-[10px] font-mono text-ink-400 text-center">searching…</div>
          )}
          {searchQ.data && searchQ.data.items.length === 0 && (
            <div className="p-3 text-[10px] font-mono text-ink-400 text-center">no matches</div>
          )}
        </div>
      )}

      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-2">
          Recently used
        </div>
        {(savedQ.data?.items ?? []).slice(0, 8).map((f) => (
          <div key={f.id} className="flex items-center justify-between border-b border-ink-700/30 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="text-xs truncate">{f.name}</div>
              <div className="text-[10px] font-mono text-ink-500">
                {Math.round(f.calories)} kcal · {Math.round(f.proteinG)}g P · {Math.round(f.carbG)}g C · {Math.round(f.fatG)}g F
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                className="w-14 bg-bg-900 border border-ink-700/40 px-1.5 py-0.5 text-xs font-mono text-right rounded"
              />
              <span className="text-[10px] font-mono text-ink-400">×</span>
              <button
                type="button"
                disabled={logSavedM.isPending}
                onClick={() => logSavedM.run({ id: f.id, meal, servings: Number(servings) || 1 })}
                className="px-2 py-0.5 text-[10px] font-mono border border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10 rounded disabled:opacity-50"
              >
                Log
              </button>
            </div>
          </div>
        ))}
        {savedQ.data?.items.length === 0 && (
          <div className="text-[10px] font-mono text-ink-500 italic">
            No saved foods yet. Use search to log a new one.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Ask AI mode — paste a comma-separated description and the LLM
 * splits it into individual items, each with a search query that
 * gets piped through OFF/USDA. The preview table lets the user
 * pick the right match (or override) before logging all of them.
 *
 * Example input: "1 cup milk, 1 cup kefir, 6 strawberries,
 * collagen peptides, 1 avocado"
 */
function FoodAskAiMode({ meal, onClose }: { meal: MealType; onClose: () => void }) {
  const qc = useQueryClient();
  const [description, setDescription] = useState('');
  type ParsedItem = {
    name: string;
    searchQuery: string;
    quantity: number;
    unit: string | null;
    reason: string;
  };
  type ItemWithHits = {
    parsed: ParsedItem;
    hits: FoodSearchHit[];
    selectedHit: number; // index into hits
    servings: string;
  };
  const [preview, setPreview] = useState<{ reason: string; items: ItemWithHits[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const askM = useMutation({
    mutationFn: () =>
      api<{ reason: string; items: Array<{ parsed: ParsedItem; hits: FoodSearchHit[] }> }>(
        '/foods/ask-ai-multi',
        { method: 'POST', body: { description } },
      ),
    onSuccess: (r) => {
      setPreview({
        reason: r.reason,
        items: r.items.map((it) => ({
          parsed: it.parsed,
          hits: it.hits,
          selectedHit: 0, // default to first match
          servings: String(it.parsed.quantity ?? 1),
        })),
      });
      setError(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Ask AI failed'),
  });

  const batchLogM = useMutation({
    mutationFn: async (items: ItemWithHits[]) => {
      // Fire one POST /meals per confirmed item in parallel. Each
      // upserts the FoodItem by (source, sourceId) on the server
      // so the next log of the same search hit is faster.
      const promises = items.map((it) => {
        const hit = it.hits[it.selectedHit];
        if (!hit) return Promise.resolve(null);
        return api('/meals', {
          method: 'POST',
          body: {
            meal,
            servings: Number(it.servings) || 1,
            source: hit.source,
            sourceId: hit.sourceId,
            name: hit.name,
            brand: hit.brand ?? null,
            servingSizeG: hit.servingSizeG ?? null,
            calories: hit.calories,
            proteinG: hit.proteinG,
            carbG: hit.carbG,
            fatG: hit.fatG,
            fiberG: hit.fiberG ?? null,
            sugarG: hit.sugarG ?? null,
            sodiumMg: hit.sodiumMg ?? null,
          },
        });
      });
      return Promise.all(promises);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meals', 'today'] });
      qc.invalidateQueries({ queryKey: ['nutrition', 'meals', 'today'] });
      onClose();
    },
  });

  function reset() {
    setPreview(null);
    setError(null);
    setDescription('');
  }

  return (
    <div className="space-y-3">
      {!preview ? (
        <>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Comma-separated list with quantities:&#10;1 cup milk, 1 cup kefir, 6 strawberries, collagen peptides, 1 avocado"
            rows={4}
            autoFocus
            className="w-full bg-bg-900 border border-ink-700/40 px-3 py-2 text-sm font-mono rounded resize-y"
          />
          {error && (
            <div className="text-[11px] font-mono text-rose-300">{error}</div>
          )}
          <div className="flex justify-end">
            <NeonButton
              onClick={() => askM.mutate()}
              loading={askM.isPending}
              disabled={description.length < 3}
              variant="cyan"
            >
              ✦ Parse items
            </NeonButton>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-mono text-ink-300">
              {preview.items.length} item{preview.items.length === 1 ? '' : 's'} parsed · {preview.reason}
            </div>
            <button
              type="button"
              onClick={reset}
              className="text-[10px] font-mono text-neon-cyan hover:underline"
            >
              ← edit description
            </button>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {preview.items.map((it, idx) => (
              <div key={idx} className="border border-ink-700/40 rounded p-2">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs truncate">
                      <span className="text-ink-400">
                        {it.parsed.quantity}{it.parsed.unit ? ` ${it.parsed.unit}` : ''}
                      </span>{' '}
                      <span className="text-slate-200">{it.parsed.name}</span>
                    </div>
                    <div className="text-[10px] font-mono text-ink-500 truncate">
                      search: {it.parsed.searchQuery}
                      {it.parsed.reason && ` · ${it.parsed.reason}`}
                    </div>
                  </div>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={it.servings}
                    onChange={(e) =>
                      setPreview((p) =>
                        p ? {
                          ...p,
                          items: p.items.map((x, i) => i === idx ? { ...x, servings: e.target.value } : x),
                        } : p,
                      )
                    }
                    className="w-14 bg-bg-900 border border-ink-700/40 px-1.5 py-0.5 text-xs font-mono text-right rounded shrink-0"
                    title="servings"
                  />
                </div>
                {it.hits.length === 0 ? (
                  <div className="text-[10px] font-mono text-ink-500 italic">
                    No OFF/USDA matches — this item will be skipped.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {it.hits.map((hit, hitIdx) => (
                      <button
                        key={`${hit.source}-${hit.sourceId}-${hitIdx}`}
                        type="button"
                        onClick={() =>
                          setPreview((p) =>
                            p ? {
                              ...p,
                              items: p.items.map((x, i) => i === idx ? { ...x, selectedHit: hitIdx } : x),
                            } : p,
                          )
                        }
                        className={classNames(
                          'w-full text-left px-2 py-1 rounded text-[10px] font-mono flex items-center justify-between gap-2',
                          it.selectedHit === hitIdx
                            ? 'bg-neon-cyan/15 border border-neon-cyan/60 text-neon-cyan'
                            : 'border border-ink-700/30 text-ink-200 hover:border-neon-cyan/30 hover:bg-neon-cyan/5',
                        )}
                      >
                        <span className="truncate">{hit.name} <span className="text-ink-500">· {hit.source}</span></span>
                        <span className="text-ink-400 shrink-0">
                          {Math.round(hit.calories)} kcal · {Math.round(hit.proteinG)}g P
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {batchLogM.isError && (
            <div className="text-[11px] font-mono text-rose-300">
              Log failed: {batchLogM.error instanceof Error ? batchLogM.error.message : 'unknown'}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={reset}
              className="px-3 py-1.5 text-[10px] font-display tracking-widest uppercase border border-ink-700/40 text-ink-300 hover:border-neon-cyan/40 rounded"
            >
              Cancel
            </button>
            <NeonButton
              onClick={() => batchLogM.mutate(preview.items.filter((it) => it.hits.length > 0))}
              loading={batchLogM.isPending}
              disabled={preview.items.filter((it) => it.hits.length > 0).length === 0}
              variant="cyan"
            >
              Log {preview.items.filter((it) => it.hits.length > 0).length} item{preview.items.filter((it) => it.hits.length > 0).length === 1 ? '' : 's'}
            </NeonButton>
          </div>
        </>
      )}
    </div>
  );
}

function SearchResultRow({
  hit,
  servings,
  onLog,
}: {
  hit: FoodSearchHit;
  servings: string;
  onLog: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onLog}
      className="w-full text-left px-3 py-2 hover:bg-neon-cyan/5 flex items-center justify-between gap-2"
    >
      <div className="min-w-0 flex-1">
        <div className="text-xs truncate">{hit.name}</div>
        <div className="text-[10px] font-mono text-ink-400">
          {hit.brand ? `${hit.brand} · ` : ''}{Math.round(hit.calories * (Number(servings) || 1))} kcal · {hit.source}
        </div>
      </div>
      <span className="text-[10px] font-mono text-neon-cyan shrink-0">+ log</span>
    </button>
  );
}

/* ============================================================
 * Supplement log modal: pick from UserTrackedItem
 * ============================================================ */

function SupplementLogModal({
  open,
  onClose,
  category,
}: {
  open: boolean;
  onClose: () => void;
  category: TrackedItem['category'] | null;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['supplements', 'tracked'],
    queryFn: () => api<{ items: TrackedItem[] }>('/supplements/tracked'),
  });
  const items = (q.data?.items ?? []).filter((i) => !category || i.category === category);
  const checkM = useDelayedMutation<{ ok: boolean }, string>({
    mutationFn: (id) => api(`/supplements/tracked/${id}/check`, { method: 'POST', body: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplements'] });
      onClose();
    },
  }, 300);
  return (
    <Modal open={open} onClose={onClose} title={category === 'PROBIOTIC' ? 'Log probiotic' : 'Log supplement'} width="max-w-md">
      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-ink-400 italic py-3 text-center">
            No tracked items{category ? ` in ${category}` : ''}. Add some in <a href="/nutrition" className="text-neon-cyan underline">/nutrition</a>.
          </div>
        )}
        {items.map((i) => (
          <div key={i.id} className="flex items-center justify-between border border-ink-700/30 p-2 rounded">
            <div className="min-w-0 flex-1">
              <div className="text-sm">{i.name}</div>
              <div className="text-[10px] font-mono text-ink-500">
                {i.defaultDose} {i.doseUnit} · {i.category.toLowerCase()}
              </div>
            </div>
            <button
              type="button"
              disabled={checkM.isPending}
              onClick={() => checkM.run(i.id)}
              className="px-3 py-1 text-xs font-mono border border-neon-lime/50 text-neon-lime hover:bg-neon-lime/10 rounded disabled:opacity-50"
            >
              ✓ Took
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ============================================================
 * Substance log modal (caffeine/alcohol/nicotine/electrolytes)
 * ============================================================ */

function SubstanceLogModal({
  open,
  onClose,
  category,
  days,
  label,
}: {
  open: boolean;
  onClose: () => void;
  category: string;
  days: number;
  label: string;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState('');
  const today = (q: { items: Array<{ category: string; loggedAt: string; form: string }> }) =>
    q.items.filter((s) => s.category === category && new Date(s.loggedAt) >= new Date(new Date().setHours(0, 0, 0, 0))).length;
  const recentQ = useQuery({
    queryKey: ['substances', category, days],
    queryFn: () => api<SubstancesResponse>(`/substances?days=${days}`),
  });
  const recentForms = Array.from(
    new Set((recentQ.data?.items ?? []).filter((s) => s.category === category).map((s) => s.form)),
  );
  // Canonical forms per category — shown alongside the user's
  // recently-logged forms so a first-time entry isn't an empty
  // picker. The user can also type a free-form value at the
  // bottom for anything not listed.
  const canonical = CANONICAL_FORMS[category] ?? [];
  // Merge: recent first (in their original order), then canonical
  // forms not already present. Dedup case-insensitively.
  const seen = new Set<string>();
  const orderedForms: string[] = [];
  for (const f of [...recentForms, ...canonical]) {
    const key = f.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    orderedForms.push(f);
  }
  const logM = useMutation({
    mutationFn: (b: { form: string; amount?: number; context?: string }) =>
      api<{ id: string }>('/substances', { method: 'POST', body: { category, ...b } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['substances'] });
      qc.invalidateQueries({ queryKey: ['today'] });
      onClose();
      setForm('');
    },
  });
  return (
    <Modal open={open} onClose={onClose} title={`Log ${label.toLowerCase()}`} width="max-w-sm">
      <div className="space-y-3">
        <div className="text-[10px] font-mono text-ink-300">
          {recentQ.data && (
            <>
              {today(recentQ.data)} today · {recentQ.data.items.filter((s) => s.category === category).length} in last {days}d
            </>
          )}
        </div>
        {orderedForms.length > 0 && (
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            {orderedForms.map((f) => {
              const isRecent = recentForms.some((r) => r.toLowerCase() === f.toLowerCase());
              return (
                <button
                  key={f}
                  type="button"
                  disabled={logM.isPending}
                  onClick={() => logM.mutate({ form: f })}
                  className={classNames(
                    'px-2.5 py-1 text-xs font-mono border rounded disabled:opacity-50',
                    isRecent
                      ? 'border-neon-cyan/50 text-neon-cyan bg-neon-cyan/5 hover:bg-neon-cyan/10'
                      : 'border-ink-700/40 text-ink-200 hover:border-neon-cyan/60 hover:text-neon-cyan hover:bg-neon-cyan/5',
                  )}
                  title={isRecent ? 'recently logged' : 'common form'}
                >
                  {f}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={form}
            onChange={(e) => setForm(e.target.value)}
            placeholder="form (e.g. espresso, wine, hookah)"
            autoFocus
            className="flex-1 bg-bg-900 border border-ink-700/40 px-2 py-1.5 text-sm font-mono rounded"
          />
          <button
            type="button"
            disabled={logM.isPending || !form.trim()}
            onClick={() => logM.mutate({ form: form.trim() })}
            className="px-3 py-1.5 text-sm font-mono border border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10 rounded disabled:opacity-50"
          >
            Log
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ============================================================
 * Activity modal — wraps WorkoutLogger
 * ============================================================ */

function WorkoutLoggerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Log activity" width="max-w-3xl">
      <WorkoutLogger
        open={open}
        setOpen={(b) => { if (!b) onClose(); }}
      />
    </Modal>
  );
}

/* ============================================================
 * Prayer picker + log modal
 * ============================================================ */

function PrayerPickerModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (k: keyof typeof PRAYER_LABELS) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Log prayer" width="max-w-sm">
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(PRAYER_LABELS) as Array<keyof typeof PRAYER_LABELS>).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onPick(k)}
            className="px-3 py-2 text-sm font-mono border border-neon-violet/40 text-neon-violet hover:bg-neon-violet/10 rounded text-left"
          >
            {PRAYER_LABELS[k]}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function PrayerLogModal({
  open,
  onClose,
  prayerType,
  onSwitch,
}: {
  open: boolean;
  onClose: () => void;
  prayerType: keyof typeof PRAYER_LABELS;
  onSwitch: () => void;
}) {
  const qc = useQueryClient();
  const [minutes, setMinutes] = useState('15');
  const logM = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; log: { id: string } }>('/spiritual/log', {
        method: 'POST',
        body: {
          type: prayerType,
          durationMin: Number(minutes) || 15,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spiritual'] });
      qc.invalidateQueries({ queryKey: ['today', 'prayer-logs'] });
      onClose();
    },
  });
  return (
    <Modal open={open} onClose={onClose} title={`Log ${PRAYER_LABELS[prayerType]}`} width="max-w-sm">
      <div className="space-y-3">
        <div>
          <button
            type="button"
            onClick={onSwitch}
            className="text-[10px] font-mono text-neon-violet hover:underline"
          >
            ← pick a different prayer
          </button>
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-400 block mb-1">
            Minutes
          </label>
          <div className="flex gap-2">
            {['5', '10', '15', '30', '60'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMinutes(m)}
                className={classNames(
                  'px-2.5 py-1 text-xs border rounded',
                  minutes === m
                    ? 'border-neon-violet/60 text-neon-violet bg-neon-violet/10'
                    : 'border-ink-700/40 text-ink-300 hover:border-neon-violet/40',
                )}
              >
                {m}m
              </button>
            ))}
            <input
              type="number"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="flex-1 bg-bg-900 border border-ink-700/40 px-2 py-1 text-xs font-mono rounded"
            />
          </div>
        </div>
        <NeonButton
          onClick={() => logM.mutate()}
          loading={logM.isPending}
          variant="violet"
          className="w-full"
        >
          Log {PRAYER_LABELS[prayerType]}
        </NeonButton>
      </div>
    </Modal>
  );
}

/* ============================================================
 * Check-ins picker modal — lists due metrics, opens the existing
 * QuickLogModal when one is picked.
 * ============================================================ */

function CheckInsPickerModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (m: DueMetricDto) => void;
}) {
  const q = useQuery({
    queryKey: ['check-ins', 'due'],
    queryFn: () => api<CheckInsDueResponse>('/check-ins/due'),
  });
  const groups: Array<{ key: 'AM' | 'PM' | 'WEEKLY'; items: DueMetricDto[] }> = [
    { key: 'AM', items: q.data?.byCadence.AM ?? [] },
    { key: 'PM', items: q.data?.byCadence.PM ?? [] },
    { key: 'WEEKLY', items: q.data?.byCadence.WEEKLY ?? [] },
  ];
  const totalDue = groups.reduce((s, g) => s + g.items.length, 0);
  return (
    <Modal open={open} onClose={onClose} title="Check-ins" width="max-w-md">
      {totalDue === 0 ? (
        <div className="text-sm font-mono text-neon-lime py-3 text-center">
          ✓ all caught up
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) =>
            g.items.length === 0 ? null : (
              <div key={g.key}>
                <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1.5">
                  {g.key}
                </div>
                <div className="space-y-1">
                  {g.items.map((m) => (
                    <button
                      key={m.metric}
                      type="button"
                      onClick={() => onPick(m)}
                      className="w-full flex items-center justify-between text-xs font-mono py-1.5 px-2 border border-ink-700/30 hover:border-neon-periwinkle/60 hover:bg-neon-periwinkle/5 rounded text-left"
                    >
                      <span className="text-slate-200">{m.label || m.metric}</span>
                      <span className="text-neon-periwinkle">+ log</span>
                    </button>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </Modal>
  );
}
