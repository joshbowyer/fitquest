import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { api } from '@/lib/api';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { DeleteButton } from '@/components/DeleteButton';
import { classNames } from '@/lib/format';
import {
  type FoodMatch,
  type MealEntry,
  type MealType,
  type TodayMealsResponse,
  MEAL_TYPE_LABEL,
  MEAL_TYPE_ORDER,
} from '@/lib/types';
import { getLocalHour } from '@/lib/timezone';
import { useAuth } from '@/lib/auth';

// crypto.randomUUID() is gated to secure contexts (HTTPS +
// localhost). LAN access via http://10.0.0.59:5173 is NOT
// considered secure, so fall back to crypto.getRandomValues
// with the RFC 4122 v4 bit layout. Same wire shape as a UUID,
// so server-side (source, sourceId) uniqueness still works.
function randomUuid(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type AskAiResult = {
  name: string;
  reason: string;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
};

// User's own saved food (recipe). Mirrors api/prisma/schema.prisma
// SavedFood. The recent-entered list sorts by useCount + lastUsedAt.
type SavedFoodDto = {
  id: string;
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
  recipe: string | null;
  useCount: number;
  lastUsedAt: string;
};

export function FoodPanel() {
  const qc = useQueryClient();

  // ---- Search ----
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<FoodMatch[] | null>(null);
  const searchM = useDelayedMutation<{ items: FoodMatch[] }, string>({
    mutationFn: async (q) => api('/foods/search', { method: 'GET', query: { q } }),
    onSuccess: (r) => setSearchResults(r.items),
  }, 600);

  // ---- Ask AI modal ----
  const [askOpen, setAskOpen] = useState(false);
  const [askResults, setAskResults] = useState<AskAiResult | null>(null);
  // Single-entry ask AI: same endpoint + parser as
  // TodayActions.FoodAskAiMode. /foods/ask-ai-multi returns
  // consolidated macros for the whole description. No
  // OFF/USDA search — the LLM does the macro estimate directly.
  const askM = useDelayedMutation<AskAiResult, string>({
    mutationFn: async (description) =>
      api('/foods/ask-ai-multi', { method: 'POST', body: { description } }),
    onSuccess: (r) => setAskResults(r),
  }, 1500);

  // ---- Log modal ----
  const [logFood, setLogFood] = useState<FoodMatch | null>(null);
  const recentQ = useQuery({
    queryKey: ['meals', 'recent'],
    queryFn: () => api<{ items: MealEntry[] }>('/meals?days=7'),
  });

  // ---- Manual entry ----
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualBrand, setManualBrand] = useState('');
  const [manualServingSizeG, setManualServingSizeG] = useState('');
  const [manualCals, setManualCals] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');
  const [manualErr, setManualErr] = useState<string | null>(null);
  const saveManualM = useDelayedMutation<{ item: SavedFoodDto }, void>({
    mutationFn: () =>
      api('/foods/saved', {
        method: 'POST',
        body: {
          name: manualName.trim(),
          brand: manualBrand.trim() || null,
          servingSizeG: manualServingSizeG ? Number(manualServingSizeG) : null,
          calories: Number(manualCals) || 0,
          proteinG: Number(manualProtein) || 0,
          carbG: Number(manualCarbs) || 0,
          fatG: Number(manualFat) || 0,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['foods', 'saved'] });
      // Reset + close
      setManualName(''); setManualBrand(''); setManualServingSizeG('');
      setManualCals(''); setManualProtein(''); setManualCarbs(''); setManualFat('');
      setManualErr(null);
      setManualOpen(false);
    },
    onError: (e) => setManualErr(e instanceof ApiError ? e.message : 'Save failed'),
  }, 600);
  // True when the user has filled in enough to save. We require
  // name + calories; the rest can be 0 if unknown (the saved food
  // then shows as best-effort in the meal list).
  const manualReady = manualName.trim().length > 0 && manualCals.trim().length > 0 && !isNaN(Number(manualCals));

  // ---- Saved foods (user's own recipes) ----
  const savedQ = useQuery({
    queryKey: ['foods', 'saved'],
    queryFn: () => api<{ items: SavedFoodDto[] }>('/foods/saved'),
  });
  const [savedOpen, setSavedOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  // Quick-log a saved food. No modal: defaults to time-of-day meal
  // and 1 serving. Long-press / manage opens the modal.
  const logSavedM = useDelayedMutation<{ entry: any }, { id: string; meal: MealType; servings: number }>({
    mutationFn: ({ id, meal, servings }) =>
      api(`/foods/saved/${id}/log`, { method: 'POST', body: { meal, servings } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meals', 'today'] });
      qc.invalidateQueries({ queryKey: ['meals', 'recent'] });
      qc.invalidateQueries({ queryKey: ['foods', 'saved'] });
    },
  }, 300);

  // Reset search when the panel re-mounts (e.g. after route change).
  useEffect(() => () => {
    setSearchResults(null);
    setAskResults(null);
  }, []);

  return (
    <Panel
      variant="violet"
      title="Food tracker"
      className="border-neon-violet/30"
      action={
        <div className="flex items-center gap-1">
          <NeonButton
            size="sm"
            variant="cyan"
            onClick={() => setRecentOpen(true)}
            title="Browse your recently-eaten foods (last 7 days) + saved recipes"
          >
            <span className="sm:hidden">Recent</span>
            <span className="hidden sm:inline">Recent foods</span>
          </NeonButton>
          <NeonButton
            size="sm"
            variant="violet"
            onClick={() => {
              setAskOpen(true);
              setAskResults(null);
            }}
            title="Free-form description → LLM extracts a search query"
          >
            Ask AI
          </NeonButton>
          <NeonButton
            size="sm"
            variant="amber"
            onClick={() => setManualOpen(true)}
            title="Can't find it? Enter the macros yourself. Always works."
          >
            Manual
          </NeonButton>
        </div>
      }
    >
      <div className="text-[10px] font-mono text-ink-300 mb-3">
        Search OFF + USDA, or hit <b>Ask AI</b> to describe what you ate
        (e.g. "Annie's mac and cheese", "6 large strawberries"). Barcode
        scanner support is on hold for the native app.
      </div>

      {/* Search input */}
      <div className="flex gap-2 mb-3">
        <input
          className="input-neon flex-1 text-sm"
          placeholder="Search foods…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && searchInput.trim()) {
              searchM.run(searchInput.trim());
              setAskResults(null);
            }
          }}
        />
        <NeonButton
          size="sm"
          variant="cyan"
          disabled={!searchInput.trim() || searchM.isPending}
          loading={searchM.isPending}
          loadingText="…"
          onClick={() => {
            if (searchInput.trim()) {
              searchM.run(searchInput.trim());
              setAskResults(null);
            }
          }}
        >
          Search
        </NeonButton>
      </div>

      {/* Results list (either search or Ask AI) */}
      {(searchResults || askResults?.items) && (
        <FoodResultsList
          items={askResults?.items ?? searchResults ?? []}
          searchQuery={askResults?.query ?? searchInput}
          aiReason={askResults?.reason}
          loading={searchM.isPending || askM.isPending}
          onLog={(food) => setLogFood(food)}
        />
      )}

      {/* Saved foods (user's own recipes) — the daily shake etc.
          Sorted by useCount + lastUsedAt on the server. Each row
          has a quick-log button that POSTs /foods/saved/:id/log with
          the time-of-day default meal; long meals open the modal. */}
      {savedQ.data && savedQ.data.items.length > 0 && (
        <div className="mt-4 pt-3 border-t border-ink-500/15">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] font-display tracking-widest uppercase text-ink-400">
              Your saved foods
            </div>
            <button
              type="button"
              onClick={() => setSavedOpen(true)}
              className="text-[10px] font-mono text-violet-300 hover:underline"
              title="Manage your saved recipes"
            >
              manage →
            </button>
          </div>
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {savedQ.data.items.slice(0, 8).map((s) => (
              <SavedFoodRow
                key={s.id}
                saved={s}
                logging={logSavedM.isPending}
                onLog={(meal) => logSavedM.run({ id: s.id, meal, servings: 1 })}
              />
            ))}
          </div>
        </div>
      )}

      {/* If no saved foods, show a hint */}
      {savedQ.data && savedQ.data.items.length === 0 && (
        <div className="mt-4 pt-3 border-t border-ink-500/15">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-ink-500">
              No saved foods yet. Save the daily shake for one-tap logging.
            </span>
            <button
              type="button"
              onClick={() => setSavedOpen(true)}
              className="text-[10px] font-mono text-violet-300 hover:underline"
            >
              + add saved food
            </button>
          </div>
        </div>
      )}

      {/* Recent log */}
      {recentQ.data && recentQ.data.items.length > 0 && (
        <div className="mt-4 pt-3 border-t border-ink-500/15">
          <div className="text-[10px] font-display tracking-widest uppercase text-ink-400 mb-1.5">
            Recent (7d)
          </div>
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {recentQ.data.items.slice(0, 8).map((m) => (
              <div
                key={m.id}
                className="text-[11px] font-mono py-1 px-1 hover:bg-slate-800/40 flex items-baseline gap-2"
              >
                <span className="text-slate-400 shrink-0">
                  {new Date(m.loggedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                </span>
                <span className="text-violet-300 shrink-0 text-[10px]">
                  {m.meal.toLowerCase()}
                </span>
                <span className="text-slate-200 truncate flex-1">
                  {m.food.name}
                </span>
                <span className="text-amber-300 text-[10px] shrink-0">
                  ×{m.servings.toFixed(2)}
                </span>
                <span className="text-slate-400 text-[10px] shrink-0">
                  {m.served.calories.toFixed(0)} cal
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {askOpen && (
        <AskAiModal
          loading={askM.isPending}
          result={askResults}
          error={askM.error ? String((askM.error as any).message ?? askM.error) : null}
          onClose={() => {
            setAskOpen(false);
            setAskResults(null);
          }}
          onSubmit={(description) => {
            askM.run(description);
          }}
          onLogged={() => {
            setAskOpen(false);
            setAskResults(null);
            qc.invalidateQueries({ queryKey: ['meals', 'today'] });
            qc.invalidateQueries({ queryKey: ['meals', 'recent'] });
          }}
        />
      )}

      {logFood && (
        <LogMealModal
          food={logFood}
          onClose={() => setLogFood(null)}
          onLogged={() => {
            setLogFood(null);
            qc.invalidateQueries({ queryKey: ['meals', 'today'] });
            qc.invalidateQueries({ queryKey: ['meals', 'recent'] });
          }}
        />
      )}

      {savedOpen && (
        <ManageSavedFoodsModal
          items={savedQ.data?.items ?? []}
          onClose={() => setSavedOpen(false)}
        />
      )}

      {recentOpen && (
        <RecentFoodsModal
          items={savedQ.data?.items ?? []}
          recentMeals={recentQ.data?.items ?? []}
          onClose={() => setRecentOpen(false)}
          onLog={(food) => {
            setLogFood(food);
            setRecentOpen(false);
          }}
          onSavedChanged={() => {
            qc.invalidateQueries({ queryKey: ['foods', 'saved'] });
          }}
        />
      )}

      {manualOpen && (
        <ManualEntryModal
          manualName={manualName} setManualName={setManualName}
          manualBrand={manualBrand} setManualBrand={setManualBrand}
          manualServingSizeG={manualServingSizeG} setManualServingSizeG={setManualServingSizeG}
          manualCals={manualCals} setManualCals={setManualCals}
          manualProtein={manualProtein} setManualProtein={setManualProtein}
          manualCarbs={manualCarbs} setManualCarbs={setManualCarbs}
          manualFat={manualFat} setManualFat={setManualFat}
          ready={manualReady}
          loading={saveManualM.isPending}
          err={manualErr}
          onSave={() => saveManualM.run()}
          onClose={() => { setManualOpen(false); setManualErr(null); }}
        />
      )}
    </Panel>
  );
}

// ============================================================================
// Results list (used by both Search and Ask AI)
// ============================================================================

function FoodResultsList({
  items,
  searchQuery,
  aiReason,
  loading,
  onLog,
}: {
  items: FoodMatch[];
  searchQuery: string;
  aiReason?: string;
  loading: boolean;
  onLog: (f: FoodMatch) => void;
}) {
  return (
    <div className="mb-3 border border-ink-500/15 bg-bg-900/40">
      <div className="px-2 py-1 text-[10px] font-mono text-ink-400 border-b border-ink-500/15 flex items-baseline gap-2">
        {aiReason ? (
          <>
            <span>🤖</span>
            <span className="text-violet-300">{searchQuery}</span>
            <span className="text-ink-500">— {aiReason}</span>
          </>
        ) : (
          <>
            <span>🔎</span>
            <span className="text-cyan-300">{searchQuery}</span>
            <span className="text-ink-500">— {items.length} result{items.length === 1 ? '' : 's'}</span>
          </>
        )}
      </div>
      {loading && items.length === 0 ? (
        <div className="p-3 text-[11px] font-mono text-ink-400">⏳ Searching…</div>
      ) : items.length === 0 ? (
        <div className="p-3 text-[11px] font-mono text-ink-400">
          No matches. Try a different search term, or use Ask AI.
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto divide-y divide-ink-500/15">
          {items.map((it) => (
            <FoodResultRow key={`${it.source}:${it.sourceId}`} food={it} onLog={onLog} />
          ))}
        </div>
      )}
    </div>
  );
}

function FoodResultRow({ food, onLog }: { food: FoodMatch; onLog: (f: FoodMatch) => void }) {
  const qc = useQueryClient();
  // "Save as recipe" — turns an OFF/USDA result into a SavedFood so
  // the user can one-tap log it tomorrow without re-searching. The
  // saved recipe reuses these per-100g macros; servings=1 by default.
  const saveM = useDelayedMutation<{ item: SavedFoodDto }>({
    mutationFn: () =>
      api('/foods/saved', {
        method: 'POST',
        body: {
          name: food.name,
          brand: food.brand ?? null,
          servingSizeG: food.servingSizeG ?? 100,
          calories: food.calories,
          proteinG: food.proteinG,
          carbG: food.carbG,
          fatG: food.fatG,
          fiberG: food.fiberG ?? null,
          sugarG: food.sugarG ?? null,
          sodiumMg: food.sodiumMg ?? null,
          recipe: `per 100g — sourced from ${food.source}`,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['foods', 'saved'] }),
  }, 600);
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-800/30">
      {food.imageUrl ? (
        <img
          src={food.imageUrl}
          alt=""
          className="w-8 h-8 object-cover rounded border border-ink-500/30 shrink-0"
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div className="w-8 h-8 bg-slate-800/60 rounded border border-ink-500/30 shrink-0 flex items-center justify-center text-[10px] text-ink-500">
          {food.source === 'OPENFOODFACTS' ? 'OFF' : 'USDA'}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-100 truncate">{food.name}</div>
        <div className="text-[10px] font-mono text-ink-400 truncate">
          {food.brand && <span className="text-ink-300">{food.brand} · </span>}
          {food.calories.toFixed(0)} cal · {food.proteinG.toFixed(1)}p ·{' '}
          {food.carbG.toFixed(1)}c · {food.fatG.toFixed(1)}f <span className="text-ink-500">per 100g</span>
        </div>
      </div>
      <button
        onClick={() => saveM.run()}
        disabled={saveM.isPending}
        className="px-1.5 py-0.5 text-[10px] font-mono text-violet-300 hover:bg-violet-500/10 border border-violet-500/30"
        title="Save as a recipe for one-tap logging tomorrow"
      >
        {saveM.isPending ? '…' : '☆ save'}
      </button>
      <NeonButton size="sm" variant="lime" onClick={() => onLog(food)}>
        + Log
      </NeonButton>
    </div>
  );
}

// ============================================================================
// Ask AI modal — free-form description
// ============================================================================

function AskAiModal({
  loading,
  result,
  error,
  onClose,
  onSubmit,
  onLogged,
}: {
  loading: boolean;
  result: AskAiResult | null;
  error: string | null;
  onClose: () => void;
  onSubmit: (description: string) => void;
  /**
   * Called after the user confirms the LLM's estimate and the
   * meal is logged. The parent closes the modal and invalidates
   * meal queries.
   */
  onLogged: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userTz = user?.timezone ?? null;
  const [draft, setDraft] = useState('');
  const valid = draft.trim().length >= 3;

  // Inline meal selector — defaults to the time-of-day bucket
  // (BREAKFAST < 10, LUNCH < 14, DINNER < 21, else SNACK). Same
  // defaulting policy as LogMealModal so the experience is
  // consistent.
  const hour = getLocalHour(new Date(), userTz);
  const defaultMeal: MealType =
    hour < 10 ? 'BREAKFAST' : hour < 14 ? 'LUNCH' : hour < 21 ? 'DINNER' : 'SNACK';
  const [meal, setMeal] = useState<MealType>(defaultMeal);
  const [logError, setLogError] = useState<string | null>(null);

  const logM = useDelayedMutation({
    mutationFn: async () => {
      if (!result) return null;
      return api('/meals', {
        method: 'POST',
        body: {
          meal,
          servings: 1,
          source: 'MANUAL',
          // Fresh UUID so the same description logged twice
          // creates two distinct FoodItem rows.
          sourceId: `askai-${randomUuid()}`,
          name: result.name,
          brand: null,
          servingSizeG: null,
          calories: result.calories,
          proteinG: result.proteinG,
          carbG: result.carbG,
          fatG: result.fatG,
          fiberG: result.fiberG ?? null,
          sugarG: result.sugarG ?? null,
          sodiumMg: result.sodiumMg ?? null,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meals', 'today'] });
      qc.invalidateQueries({ queryKey: ['meals', 'recent'] });
      qc.invalidateQueries({ queryKey: ['nutrition', 'meals', 'today'] });
      onLogged();
    },
  });

  function reset() {
    onSubmit(draft.trim());
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg-900/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-800 border border-neon-violet/40 max-w-lg w-full p-5 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="font-display tracking-widest text-sm text-ink-50">
            Ask AI
          </div>
          <button onClick={onClose} className="text-ink-300 hover:text-ink-100">✕</button>
        </div>

        {!result ? (
          <>
            <div className="text-[10px] font-mono text-ink-400 mb-3">
              Describe what you ate in one line. The LLM estimates
              total calories + macros for the whole meal so you can
              log it directly without finding each ingredient in
              OFF/USDA.
            </div>
            <textarea
              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
              rows={3}
              autoFocus
              placeholder="e.g. 1 cup kefir, 1 cup almond milk, 1 scoop ON Gold Standard whey vanilla, 6 strawberries, 1 scoop creatine"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && valid) {
                  onSubmit(draft.trim());
                }
              }}
            />
            {error && (
              <div className="mt-2 text-xs text-rose-400 font-mono">{error}</div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <NeonButton variant="cyan" onClick={onClose}>
                Close
              </NeonButton>
              <NeonButton
                variant="violet"
                disabled={!valid || loading}
                loading={loading}
                loadingText="Estimating…"
                onClick={() => valid && onSubmit(draft.trim())}
              >
                Estimate
              </NeonButton>
            </div>
          </>
        ) : (
          <>
            <div className="text-[10px] font-mono text-ink-400 mb-2">
              Review the estimate, then log. The same description can
              be logged again with a fresh ID.
            </div>
            <div className="border border-neon-violet/40 rounded p-3 space-y-2 bg-neon-violet/5">
              <div className="text-sm font-display tracking-wider text-slate-100">
                {result.name}
              </div>
              {result.reason && (
                <div className="text-[10px] font-mono text-ink-300 italic leading-snug">
                  {result.reason}
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-[11px] font-mono">
                <div className="flex justify-between">
                  <span className="text-ink-400">Calories</span>
                  <span className="text-slate-100">{result.calories} kcal</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-400">Protein</span>
                  <span className="text-slate-100">{result.proteinG} g</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-400">Carbs</span>
                  <span className="text-slate-100">{result.carbG} g</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-400">Fat</span>
                  <span className="text-slate-100">{result.fatG} g</span>
                </div>
                {result.fiberG != null && (
                  <div className="flex justify-between">
                    <span className="text-ink-400">Fiber</span>
                    <span className="text-slate-100">{result.fiberG} g</span>
                  </div>
                )}
                {result.sugarG != null && (
                  <div className="flex justify-between">
                    <span className="text-ink-400">Sugar</span>
                    <span className="text-slate-100">{result.sugarG} g</span>
                  </div>
                )}
                {result.sodiumMg != null && (
                  <div className="flex justify-between">
                    <span className="text-ink-400">Sodium</span>
                    <span className="text-slate-100">{result.sodiumMg} mg</span>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
                Meal:
              </span>
              {(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMeal(m)}
                  className={classNames(
                    'px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border rounded',
                    meal === m
                      ? 'border-neon-violet/60 text-neon-violet bg-neon-violet/10'
                      : 'border-ink-700/40 text-ink-300 hover:border-neon-violet/40',
                  )}
                >
                  {m.toLowerCase()}
                </button>
              ))}
            </div>

            {logError && (
              <div className="mt-2 text-xs text-rose-400 font-mono">{logError}</div>
            )}
            {logM.error && !logError && (
              <div className="mt-2 text-xs text-rose-400 font-mono">
                {logM.error instanceof Error ? logM.error.message : 'Log failed'}
              </div>
            )}

            <div className="flex justify-between gap-2 mt-4">
              <button
                type="button"
                onClick={reset}
                disabled={loading}
                className="px-3 py-1.5 text-[10px] font-display tracking-widest uppercase border border-ink-700/40 text-ink-300 hover:border-neon-violet/40 rounded"
              >
                ← Re-estimate
              </button>
              <NeonButton
                variant="violet"
                onClick={() => {
                  setLogError(null);
                  logM.run();
                }}
                loading={logM.isPending}
                disabled={loading}
              >
                Log meal
              </NeonButton>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// ============================================================================
// Manage Saved Foods modal — list, add, edit, delete the user's recipes
// ============================================================================
// Recent foods modal — saved foods + recently eaten meals
// ============================================================================
//
// Two sections:
//  1. Your saved foods — the always-available quick-log list (the
//     ★-starred recipes that survive across sessions).
//  2. Recently eaten — last 7 days of MealEntry rows, deduped by
//     (food.source, food.sourceId, food.name). This catches items
//     added by Ask AI or anything the user logged once but didn't
//     bother to save.
//
// Click an item to open the LogMeal modal.

function RecentFoodsModal({
  items,
  recentMeals,
  onClose,
  onLog,
  onSavedChanged,
}: {
  items: SavedFoodDto[];
  recentMeals: MealEntry[];
  onClose: () => void;
  onLog: (food: FoodMatch) => void;
  onSavedChanged: () => void;
}) {
  // Map a SavedFood into the FoodMatch shape the LogMeal modal
  // expects, so the user can quick-log a saved food from here.
  function savedToMatch(s: SavedFoodDto): FoodMatch {
    return {
      source: 'MANUAL',
      sourceId: s.id,
      name: s.name,
      brand: s.brand,
      imageUrl: null,
      servingSizeG: s.servingSizeG,
      calories: s.calories,
      proteinG: s.proteinG,
      carbG: s.carbG,
      fatG: s.fatG,
      fiberG: s.fiberG,
      sugarG: s.sugarG,
      sodiumMg: s.sodiumMg,
      sourceUrl: null,
    };
  }

  // Map a MealEntry (one logged meal) into a FoodMatch so the
  // LogMeal modal can pre-fill from it. The food.source +
  // food.sourceId pair is the (source, sourceId) unique key the
  // server uses to upsert FoodItem, so a re-log of an already-eaten
  // food (Ask AI result, OFF search hit, USDA entry, anything)
  // reuses the existing FoodItem row instead of creating a duplicate.
  function mealToMatch(m: MealEntry): FoodMatch {
    return {
      source: m.food.source as any,
      sourceId: m.food.sourceId,
      name: m.food.name,
      brand: m.food.brand,
      imageUrl: m.food.imageUrl,
      servingSizeG: m.food.servingSizeG,
      // The MealEntry carries the macros-as-served (already scaled
      // by servings), but the LogMeal modal wants per-100g (or per
      // serving) numbers and re-scales via the servings picker. The
      // server uses per-100g from FoodItem, but for ad-hoc re-log
      // we send the per-serving numbers and let the modal's
      // servings default to 1.0.
      calories: m.served.calories,
      proteinG: m.served.proteinG,
      carbG: m.served.carbG,
      fatG: m.served.fatG,
      fiberG: m.served.fiberG,
      sugarG: m.served.sugarG,
      sodiumMg: m.served.sodiumMg,
      sourceUrl: null,
    };
  }

  // Free-text filter applied to BOTH lists. Empty = show all.
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const matches = (name: string, brand: string | null | undefined) => {
    if (!f) return true;
    if (name.toLowerCase().includes(f)) return true;
    if (brand && brand.toLowerCase().includes(f)) return true;
    return false;
  };

  // Dedup recent meals: many entries per food (one per log). Keep
  // the most-recent row per (source, sourceId, name) so the list
  // is browseable. Most-recent = first occurrence in `recentMeals`
  // (the API returns them loggedAt DESC).
  const dedupedMeals: MealEntry[] = [];
  const seen = new Set<string>();
  for (const m of recentMeals) {
    const key = `${m.food.source}|${m.food.sourceId}|${m.food.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedMeals.push(m);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg-900/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-800 border border-neon-cyan/40 max-w-3xl w-full p-5 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="font-display tracking-widest text-sm text-ink-50">
            Recent foods
          </div>
          <button onClick={onClose} className="text-ink-300 hover:text-ink-100">✕</button>
        </div>

        {/* ---------- Recently eaten (last 7 days) ---------- */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500">
              Recently eaten ({dedupedMeals.length})
            </div>
            <input
              autoFocus
              className="input-neon flex-1 text-[11px] h-6 px-2"
              placeholder="Filter foods…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setFilter('');
              }}
            />
          </div>
          {dedupedMeals.length === 0 ? (
            <div className="text-xs text-ink-400 font-mono py-2">
              Nothing logged in the last 7 days. Search + log something below and it'll show up here next time.
            </div>
          ) : (
            (() => {
              const filtered = dedupedMeals.filter((m) => matches(m.food.name, m.food.brand));
              if (filtered.length === 0) {
                return (
                  <div className="text-xs text-ink-400 font-mono py-2 text-center">
                    No recent meals match "{filter}".
                  </div>
                );
              }
              return (
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {filtered.slice(0, 50).map((m) => (
                    <div
                      key={m.id}
                      className="text-[11px] font-mono py-1 px-2 hover:bg-slate-800/40 flex items-center gap-2 border border-ink-500/20"
                    >
                      <span className="text-slate-200 truncate flex-1">
                        {m.food.name}
                        {m.food.brand && (
                          <span className="text-ink-400 ml-1">· {m.food.brand}</span>
                        )}
                      </span>
                      <span className="text-amber-300 text-[10px] shrink-0">
                        {m.served.calories.toFixed(0)} cal
                      </span>
                      <span className="text-ink-500 text-[10px] shrink-0">
                        ·{m.served.proteinG.toFixed(0)}p
                      </span>
                      <span className="text-ink-500 text-[10px] shrink-0 hidden sm:inline">
                        ·{new Date(m.loggedAt).toLocaleDateString()}
                      </span>
                      <button
                        type="button"
                        onClick={() => onLog(mealToMatch(m))}
                        className="px-2 py-0.5 text-[10px] font-mono border border-neon-amber/50 text-neon-amber hover:bg-neon-amber/10 shrink-0"
                        title="Quick-log this food again"
                      >
                        + log
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </div>

        {/* ---------- Your saved foods (the always-available list) ---------- */}
        <div className="border-t border-ink-500/20 pt-3">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500">
              Your saved foods ({items.length})
            </div>
          </div>
          {items.length === 0 ? (
            <div className="text-xs text-ink-400 font-mono py-2">
              No saved foods yet. Star a search result with the ★ button to add one.
            </div>
          ) : (
            (() => {
              const filtered = items.filter((s) => matches(s.name, s.brand));
              if (filtered.length === 0) {
                return (
                  <div className="text-xs text-ink-400 font-mono py-2 text-center">
                    No saved foods match "{filter}".
                  </div>
                );
              }
              return (
                <div className="space-y-1 max-h-44 overflow-y-auto">
                  {filtered.slice(0, 30).map((s) => (
                    <div
                      key={s.id}
                      className="text-[11px] font-mono py-1 px-2 hover:bg-slate-800/40 flex items-center gap-2 border border-ink-500/20"
                    >
                      <span className="text-slate-200 truncate flex-1">{s.name}</span>
                      <span className="text-amber-300 text-[10px] shrink-0">
                        {s.calories.toFixed(0)} cal
                      </span>
                      <span className="text-ink-500 text-[10px] shrink-0">
                        ·{s.proteinG.toFixed(0)}p
                      </span>
                      <span className="text-ink-500 text-[10px] shrink-0">
                        ·×{s.useCount}
                      </span>
                      <button
                        type="button"
                        onClick={() => onLog(savedToMatch(s))}
                        className="px-2 py-0.5 text-[10px] font-mono border border-neon-amber/50 text-neon-amber hover:bg-neon-amber/10 shrink-0"
                        title="Quick-log this food"
                      >
                        + log
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ============================================================================

function ManageSavedFoodsModal({
  items,
  onClose,
}: {
  items: SavedFoodDto[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SavedFoodDto | null>(null);
  const [adding, setAdding] = useState(false);
  const delM = useDelayedMutation<{ ok: boolean }, string>({
    mutationFn: (id) => api(`/foods/saved/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['foods', 'saved'] }),
  }, 400);
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg-900/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-800 border border-neon-violet/40 max-w-2xl w-full p-5 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="font-display tracking-widest text-ink-50">Saved foods</div>
          <button onClick={onClose} className="text-ink-300 hover:text-ink-100">✕</button>
        </div>
        <div className="text-[10px] font-mono text-ink-400 mb-3">
          Recipes you eat often (the daily shake, your go-to breakfast, etc).
          Click a row to edit. New foods can be created from here.
        </div>
        {adding || editing ? (
          <SavedFoodEditor
            existing={editing}
            onClose={() => {
              setEditing(null);
              setAdding(false);
            }}
          />
        ) : (
          <>
            <NeonButton
              variant="violet"
              size="sm"
              onClick={() => setAdding(true)}
              icon="+"
              className="mb-3"
            >
              Add saved food
            </NeonButton>
            {items.length === 0 ? (
              <div className="text-xs text-ink-300 font-mono text-center py-6">
                No saved foods yet. Add one to enable one-tap logging.
              </div>
            ) : (
              <div className="space-y-1">
                {items.map((s) => (
                  <div
                    key={s.id}
                    className="border border-ink-500/30 p-2 text-xs font-mono flex items-center gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-100 truncate">{s.name}</div>
                      <div className="text-[10px] text-ink-400">
                        {s.calories.toFixed(0)} cal · {s.proteinG.toFixed(0)}p ·{' '}
                        {s.carbG.toFixed(0)}c · {s.fatG.toFixed(0)}f
                        {s.useCount > 0 && (
                          <span className="text-ink-500 ml-2">· used {s.useCount}×</span>
                        )}
                      </div>
                      {s.recipe && (
                        <div className="text-[10px] text-ink-500 mt-0.5 italic truncate">
                          {s.recipe}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setEditing(s)}
                      className="px-2 py-1 text-[10px] font-mono border border-ink-500/40 text-ink-300 hover:border-ink-100"
                    >
                      edit
                    </button>
                    <DeleteButton
                      onClick={() => {
                        if (confirm(`Remove "${s.name}" from saved foods?`)) {
                          delM.run(s.id);
                        }
                      }}
                      disabled={delM.isPending}
                      title="Remove from saved foods"
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function SavedFoodEditor({
  existing,
  onClose,
}: {
  existing: SavedFoodDto | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(existing?.name ?? '');
  const [brand, setBrand] = useState(existing?.brand ?? '');
  const [servingSize, setServingSize] = useState<string>(existing?.servingSizeG != null ? String(existing.servingSizeG) : '');
  const [cal, setCal] = useState<string>(existing ? String(existing.calories) : '');
  const [protein, setProtein] = useState<string>(existing ? String(existing.proteinG) : '');
  const [carb, setCarb] = useState<string>(existing ? String(existing.carbG) : '');
  const [fat, setFat] = useState<string>(existing ? String(existing.fatG) : '');
  const [fiber, setFiber] = useState<string>(existing?.fiberG != null ? String(existing.fiberG) : '');
  const [sugar, setSugar] = useState<string>(existing?.sugarG != null ? String(existing.sugarG) : '');
  const [sodium, setSodium] = useState<string>(existing?.sodiumMg != null ? String(existing.sodiumMg) : '');
  const [recipe, setRecipe] = useState(existing?.recipe ?? '');
  // Ask-AI: when the user describes a recipe, the LLM fills in
  // the macros. Separate modal so the description textarea has
  // room to breathe. Result is reviewed inline; the user keeps
  // the name + clicks Save.
  const [askOpen, setAskOpen] = useState(false);
  type AiSuggestion = {
    name: string;
    servingSizeG: number;
    calories: number;
    proteinG: number;
    carbG: number;
    fatG: number;
    fiberG: number;
    sugarG: number;
    sodiumMg: number;
    recipe: string;
    reasoning: string;
    confidence: 'high' | 'medium' | 'low' | string;
    unitBasis: 'per_serving' | 'per_100g';
  };
  const [aiResult, setAiResult] = useState<AiSuggestion | null>(null);
  // Surface API errors INSIDE the modal so the user knows what to
  // change. On success we close the modal — the suggestion then
  // shows in the editor as an inline preview (purple banner) with
  // an Apply button, so the user can review the macros + reasoning
  // before committing to the form.
  const [askError, setAskError] = useState<string | null>(null);
  const askM = useDelayedMutation<{ suggestion: AiSuggestion }, { description: string; unitBasis: 'per_serving' | 'per_100g' }>({
    mutationFn: (body) =>
      api('/foods/saved/ask-ai', { method: 'POST', body }),
    onSuccess: (r) => {
      setAiResult(r.suggestion);
      setAskError(null);
      setAskOpen(false);
    },
    onError: (e: any) => {
      setAskError(String(e?.message ?? e ?? 'AI call failed.'));
    },
  }, 1500);

  function applySuggestion(s: AiSuggestion) {
    setName(s.name || name);
    setServingSize(s.servingSizeG > 0 ? String(s.servingSizeG) : servingSize);
    setCal(String(s.calories || 0));
    setProtein(String(s.proteinG || 0));
    setCarb(String(s.carbG || 0));
    setFat(String(s.fatG || 0));
    setFiber(s.fiberG > 0 ? String(s.fiberG) : '');
    setSugar(s.sugarG > 0 ? String(s.sugarG) : '');
    setSodium(s.sodiumMg > 0 ? String(s.sodiumMg) : '');
    setRecipe(s.recipe || recipe);
    setAiResult(null);
  }

  function openAsk() {
    setAskOpen(true);
    setAskError(null);
    // Don't clear aiResult here — the user might want to refine
    // their description and re-ask; the existing suggestion stays
    // visible until a new one comes back.
  }

  const valid =
    name.trim().length > 0 &&
    Number(cal) > 0 &&
    Number(protein) >= 0 &&
    Number(carb) >= 0 &&
    Number(fat) >= 0;

  const saveM = useDelayedMutation<{ item: SavedFoodDto }>({
    mutationFn: () =>
      api('/foods/saved', {
        method: 'POST',
        body: {
          name: name.trim(),
          brand: brand.trim() || null,
          servingSizeG: Number(servingSize) > 0 ? Number(servingSize) : null,
          calories: Number(cal),
          proteinG: Number(protein),
          carbG: Number(carb),
          fatG: Number(fat),
          fiberG: Number(fiber) > 0 ? Number(fiber) : null,
          sugarG: Number(sugar) > 0 ? Number(sugar) : null,
          sodiumMg: Number(sodium) > 0 ? Number(sodium) : null,
          recipe: recipe.trim() || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['foods', 'saved'] });
      onClose();
    },
  }, 500);

  return (
    <div className="border border-neon-violet/30 p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block col-span-2">
          <span className="text-[10px] uppercase text-slate-500">Name</span>
          <input
            autoFocus
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Daily Shake"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Brand (optional)</span>
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Trader Joe's"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Serving size (g)</span>
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
            type="number"
            min="0"
            value={servingSize}
            onChange={(e) => setServingSize(e.target.value)}
            placeholder="600"
          />
        </label>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <label className="block">
          <span className="text-[10px] uppercase text-amber-400">Calories</span>
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
            type="number"
            min="0"
            value={cal}
            onChange={(e) => setCal(e.target.value)}
            placeholder="480"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-lime-400">Protein (g)</span>
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
            type="number"
            min="0"
            value={protein}
            onChange={(e) => setProtein(e.target.value)}
            placeholder="38"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-cyan-400">Carbs (g)</span>
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
            type="number"
            min="0"
            value={carb}
            onChange={(e) => setCarb(e.target.value)}
            placeholder="52"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-violet-400">Fat (g)</span>
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
            type="number"
            min="0"
            value={fat}
            onChange={(e) => setFat(e.target.value)}
            placeholder="14"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Fiber (g)</span>
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
            type="number"
            min="0"
            value={fiber}
            onChange={(e) => setFiber(e.target.value)}
            placeholder="8"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Sugar (g)</span>
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
            type="number"
            min="0"
            value={sugar}
            onChange={(e) => setSugar(e.target.value)}
            placeholder="22"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Sodium (mg)</span>
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
            type="number"
            min="0"
            value={sodium}
            onChange={(e) => setSodium(e.target.value)}
            placeholder="320"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-slate-500">Servings</span>
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm bg-slate-800/40 cursor-not-allowed"
            disabled
            value="1"
            title="Always 1 serving per row. Log it N times via quick-log × N."
          />
        </label>
      </div>
      <label className="block">
        <span className="text-[10px] uppercase text-slate-500">Recipe / notes (optional)</span>
        <textarea
          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
          rows={2}
          value={recipe}
          onChange={(e) => setRecipe(e.target.value)}
          placeholder="1 scoop whey, 1 banana, 1 cup oat milk, 1/2 cup oats…"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <NeonButton
          type="button"
          variant="amber"
          size="sm"
          onClick={openAsk}
          title="Describe the recipe in plain language; the LLM will estimate the macros"
        >
          ✨ Ask AI
        </NeonButton>
        {aiResult && (
          <div className="text-[10px] font-mono text-violet-300">
            suggestion ready → click <b>Apply</b> below to fill the form
          </div>
        )}
      </div>
      {/* Inline preview of the LLM suggestion so the user can decide
          to apply / discard before committing. */}
      {aiResult && (
        <div className="mt-1 border border-violet-500/30 p-2 text-[11px] font-mono bg-violet-500/5">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-violet-300 truncate">
              <b>{aiResult.name || '(unnamed)'}</b>
              <span className="text-ink-400 ml-1">· {aiResult.unitBasis === 'per_100g' ? 'per 100g' : 'per serving'}</span>
              <span className={`ml-2 px-1.5 py-0.5 text-[9px] ${
                aiResult.confidence === 'high' ? 'text-emerald-300 border border-emerald-500/30' :
                aiResult.confidence === 'low' ? 'text-rose-300 border border-rose-500/30' :
                'text-amber-300 border border-amber-500/30'
              }`}>
                {aiResult.confidence} confidence
              </span>
            </div>
            <button
              type="button"
              onClick={() => applySuggestion(aiResult)}
              className="px-2 py-0.5 text-[10px] font-mono border border-violet-400 text-violet-200 hover:bg-violet-500/15"
            >
              Apply
            </button>
          </div>
          <div className="text-ink-300 mt-1">
            {aiResult.calories.toFixed(0)} cal · {aiResult.proteinG.toFixed(1)}p · {aiResult.carbG.toFixed(1)}c · {aiResult.fatG.toFixed(1)}f
            {aiResult.fiberG > 0 && ` · ${aiResult.fiberG.toFixed(1)} fiber`}
            {aiResult.sugarG > 0 && ` · ${aiResult.sugarG.toFixed(1)} sugar`}
            {aiResult.sodiumMg > 0 && ` · ${aiResult.sodiumMg.toFixed(0)}mg Na`}
          </div>
          {aiResult.reasoning && (
            <div className="text-ink-500 italic mt-1">↳ {aiResult.reasoning}</div>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <NeonButton variant="cyan" onClick={onClose}>Cancel</NeonButton>
        <NeonButton
          variant="violet"
          disabled={!valid || saveM.isPending}
          loading={saveM.isPending}
          loadingText="Saving…"
          onClick={() => saveM.run()}
        >
          {existing ? 'Update saved food' : 'Add saved food'}
        </NeonButton>
      </div>
      <AskAiSavedFoodModal
        open={askOpen}
        loading={askM.isPending}
        error={askError}
        onClose={() => {
          setAskOpen(false);
          // Keep askError visible after close so the user can
          // see what went wrong if they open the modal again.
        }}
        onSubmit={(description, unitBasis) => {
          setAskError(null);
          askM.run({ description, unitBasis });
        }}
      />
    </div>
  );
}

// Ask-AI modal: lets the user describe a recipe in plain language.
// Result is shown inline in the editor (not as a popover) so the
// user can review the LLM's reasoning before clicking Apply.
function AskAiSavedFoodModal({
  open,
  loading,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (description: string, unitBasis: 'per_serving' | 'per_100g') => void;
}) {
  const [draft, setDraft] = useState('');
  const [unitBasis, setUnitBasis] = useState<'per_serving' | 'per_100g'>('per_serving');
  if (!open) return null;
  const valid = draft.trim().length >= 5;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg-900/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-800 border border-neon-amber/40 max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="font-display tracking-widest text-sm text-ink-50">
            ✨ Ask AI — describe your recipe
          </div>
          <button onClick={onClose} className="text-ink-300 hover:text-ink-100">✕</button>
        </div>
        <div className="text-[10px] font-mono text-ink-400 mb-3">
          List the ingredients and amounts. The LLM returns
          per-serving (or per 100g) macros plus a confidence rating.
          You review before saving.
        </div>
        <textarea
          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
          rows={5}
          autoFocus
          placeholder="e.g. 1 cup reduced sugar almond milk, 1/2 cup maple hill organic kefir, 1 scoop whey isolate, 1 tbsp peanut butter, 1/2 cup frozen berries"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-2 text-[10px] font-mono text-ink-400">
          <span>Unit basis:</span>
          <button
            type="button"
            onClick={() => setUnitBasis('per_serving')}
            className={unitBasis === 'per_serving' ? 'px-2 py-0.5 border border-amber-400 text-amber-300 bg-amber-400/10' : 'px-2 py-0.5 border border-ink-500/30 text-ink-300'}
          >
            per serving
          </button>
          <button
            type="button"
            onClick={() => setUnitBasis('per_100g')}
            className={unitBasis === 'per_100g' ? 'px-2 py-0.5 border border-amber-400 text-amber-300 bg-amber-400/10' : 'px-2 py-0.5 border border-ink-500/30 text-ink-300'}
          >
            per 100g
          </button>
        </div>
        {error && (
          <div className="mt-2 text-xs text-rose-400 font-mono">{error}</div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <NeonButton variant="cyan" onClick={onClose}>Cancel</NeonButton>
          <NeonButton
            variant="amber"
            disabled={!valid || loading}
            loading={loading}
            loadingText="Asking…"
            onClick={() => onSubmit(draft.trim(), unitBasis)}
          >
            Ask
          </NeonButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ============================================================================
// Log Meal modal — pick meal section + set servings
// ============================================================================

// ============================================================================
// SavedFoodRow — one row in the "Your saved foods" list. Hosts a
// little popover menu on the + log button so the user can pick
// which meal section to log the food to. Defaults to the current
// time-of-day meal but a single click on the chevron reveals all
// four. The popover also shows the current total for each meal
// so the user can pre-log to whichever section they're planning
// to eat it in (often the case for someone who tracks end-of-day
// totals in advance).
// ============================================================================

function SavedFoodRow({
  saved,
  logging,
  onLog,
}: {
  saved: SavedFoodDto;
  logging: boolean;
  onLog: (meal: MealType) => void;
}) {
  const { user } = useAuth();
  const userTz = user?.timezone ?? null;
  const todayQ = useQuery({
    queryKey: ['meals', 'today'],
    queryFn: () => api<TodayMealsResponse>('/meals/today'),
  });
  // Today's calorie totals per meal (read-only, just for the
  // popover's preview). NaN-safe — totals are 0 when the meal
  // section has no entries yet.
  const mealCal = (m: MealType): number =>
    todayQ.data?.meals[m]?.totals.calories ?? 0;

  // Default meal by hour: a quick-log without picking just goes
  // to whatever section "now" is in.
  const defaultMeal: MealType = (() => {
    const h = getLocalHour(new Date(), userTz);
    return h < 10 ? 'BREAKFAST' : h < 14 ? 'LUNCH' : h < 21 ? 'DINNER' : 'SNACK';
  })();

  const [open, setOpen] = useState(false);
  // Anchor the popover to this button's bounding rect so it can
  // render via createPortal outside the panel's overflow clip.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  function togglePicker() {
    if (open) {
      setOpen(false);
      return;
    }
    // Measure the chevron button's position; the popover renders
    // to document.body so it escapes the parent overflow:hidden.
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPopoverPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.right + window.scrollX - 180, // right-align with the button
      });
    }
    setOpen(true);
  }

  // Close on outside click + on Esc.
  const popoverRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function commit(meal: MealType) {
    setOpen(false);
    onLog(meal);
  }

  return (
    <div
      className="text-[11px] font-mono py-1 px-1 hover:bg-slate-800/40 flex items-center gap-2"
      title={saved.recipe ?? saved.name}
    >
      <span className="text-slate-200 truncate flex-1">{saved.name}</span>
      <span className="text-amber-300 text-[10px] shrink-0">
        {saved.calories.toFixed(0)} cal
      </span>
      <span className="text-ink-500 text-[10px] shrink-0">
        ·{saved.proteinG.toFixed(0)}p
      </span>
      {/* The + log button + a chevron that opens the meal picker.
          Clicking the button itself quick-logs to the default
          (time-of-day) meal. Clicking the chevron reveals all
          four so the user can pre-log to a future section. */}
      <div className="relative flex items-center">
        <div className="flex border border-neon-amber/50">
          <button
            type="button"
            onClick={() => commit(defaultMeal)}
            disabled={logging}
            className="px-2 py-0.5 text-[10px] font-mono text-neon-amber hover:bg-neon-amber/10 disabled:opacity-50"
            title={`Quick-log to ${MEAL_TYPE_LABEL[defaultMeal].toLowerCase()} (now)`}
          >
            + log
          </button>
          <button
            ref={triggerRef}
            type="button"
            onClick={togglePicker}
            disabled={logging}
            className="px-1 py-0.5 text-[10px] font-mono text-neon-amber border-l border-neon-amber/50 hover:bg-neon-amber/10 disabled:opacity-50"
            title="Pick a different meal section"
            aria-label="Pick meal"
            aria-expanded={open}
            aria-haspopup="menu"
          >
            ▾
          </button>
        </div>
      </div>
      {open && popoverPos &&
        createPortal(
          <div
            ref={popoverRef}
            role="menu"
            style={{
              position: 'absolute',
              top: popoverPos.top,
              left: popoverPos.left,
              zIndex: 50,
            }}
            className="bg-bg-800 border border-amber-500/40 min-w-[180px] shadow-lg"
          >
            <div className="text-[9px] font-mono uppercase tracking-widest text-ink-500 px-2 py-1 border-b border-ink-500/20">
              Add to meal
            </div>
            {MEAL_TYPE_ORDER.map((m) => {
              const cal = mealCal(m);
              const isDefault = m === defaultMeal;
              return (
                <button
                  key={m}
                  type="button"
                  role="menuitem"
                  onClick={() => commit(m)}
                  disabled={logging}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-[10px] font-mono text-left text-slate-200 hover:bg-neon-amber/10 disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5">
                    {MEAL_TYPE_LABEL[m]}
                    {isDefault && (
                      <span className="text-ink-500 text-[9px]">· now</span>
                    )}
                  </span>
                  <span className="text-amber-300/80 text-[10px] tabular-nums">
                    {todayQ.isLoading ? '…' : `${cal.toFixed(0)} cal`}
                  </span>
                </button>
              );
            })}
            <div className="border-t border-ink-500/20 px-2 py-1 text-[9px] font-mono text-ink-500">
              pre-log any meal to see end-of-day totals early
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function LogMealModal({
  food,
  onClose,
  onLogged,
}: {
  food: FoodMatch;
  onClose: () => void;
  onLogged: () => void;
}) {
  const { user } = useAuth();
  const userTz = user?.timezone ?? null;
  // Default the meal based on the time of day: morning = BREAKFAST,
  // midday = LUNCH, evening = DINNER, late = SNACK.
  const hour = getLocalHour(new Date(), userTz);
  const defaultMeal: MealType =
    hour < 10 ? 'BREAKFAST' : hour < 14 ? 'LUNCH' : hour < 21 ? 'DINNER' : 'SNACK';

  // Per-serving size from the food record (may be null — many OFF
  // / USDA entries don't carry it). When set, we expose the
  // 'serving' unit; otherwise only ×100g and oz are available.
  const servingSizeG = food.servingSizeG ?? null;
  const hasServing = servingSizeG != null && servingSizeG > 0;

  // Unit picker for the quantity. The number stored in `servings`
  // is always the ×100g multiplier the server expects — we just
  // convert from whatever unit the user typed.
  //   ×100g → 1:1
  //   oz    → /28.3495 × 100
  //   serving (when servingSizeG is known) → × servingSizeG / 100
  type Unit = 'x100g' | 'oz' | 'serving';
  const [unit, setUnit] = useState<Unit>('x100g');

  // Display value: the number the user types. Always positive,
  // accepts decimals. We pre-fill it to the equivalent of 1.0
  // ×100g in the chosen unit so the first log isn't a 0 serving.
  const initialDisplay = (): string => {
    if (unit === 'x100g') return '1.0';
    if (unit === 'oz') return (100 / 28.3495).toFixed(1); // ~3.53 oz
    // serving: 1.0 servings = servingSizeG grams = servingSizeG/100 ×100g
    return '1.0';
  };
  const [servings, setServings] = useState<string>(initialDisplay);
  const [note, setNote] = useState('');
  const [meal, setMeal] = useState<MealType>(defaultMeal);

  // The actual ×100g multiplier we POST to the server. Recompute
  // on every render so the preview always matches the form state.
  const inputNum = Number(servings);
  const sNum =
    unit === 'x100g' ? inputNum
    : unit === 'oz'   ? (inputNum * 28.3495) / 100
    /* serving */      : hasServing ? (inputNum * servingSizeG!) / 100
    : NaN;
  const valid = Number.isFinite(sNum) && sNum > 0 && sNum <= 50;

  const [logError, setLogError] = useState<string | null>(null);
  const logM = useDelayedMutation({
    mutationFn: () =>
      api('/meals', {
        method: 'POST',
        body: {
          // Use source+sourceId (not foodId). The server upserts
          // the FoodItem from the search result in the same call.
          source: food.source,
          sourceId: food.sourceId,
          name: food.name,
          brand: food.brand,
          imageUrl: food.imageUrl,
          servingSizeG: food.servingSizeG,
          calories: food.calories,
          proteinG: food.proteinG,
          carbG: food.carbG,
          fatG: food.fatG,
          fiberG: food.fiberG,
          sugarG: food.sugarG,
          sodiumMg: food.sodiumMg,
          sourceUrl: food.sourceUrl,
          meal,
          servings: sNum,
          note: note.trim() || null,
        },
      }),
    onSuccess: onLogged,
    // Surface API errors inside the modal. The local API is so
    // fast that without this, a 400 (e.g. validation, save-while-
    // editing) returns in <100ms and the modal sits on "Logging…"
    // forever, which feels like "nothing happened".
    onError: (e: any) => setLogError(String(e?.message ?? e ?? 'Log failed.')),
  }, 400);

  // Re-default the display value when the user switches units so
  // the input shows a sensible starting point in the new unit
  // (preserving the ×100g amount they had typed if possible).
  function changeUnit(next: Unit) {
    if (next === unit) return;
    // Convert the CURRENT ×100g amount into the new unit so the
    // user doesn't lose their work on a unit swap.
    let preserved: number;
    if (unit === 'x100g') preserved = inputNum;
    else if (unit === 'oz') preserved = inputNum * 28.3495 / 100;
    else if (hasServing) preserved = inputNum * servingSizeG! / 100;
    else preserved = 1;
    if (!Number.isFinite(preserved) || preserved <= 0) preserved = 1;

    let display: number;
    if (next === 'x100g') display = preserved;
    else if (next === 'oz') display = preserved * 100 / 28.3495;
    else /* serving */ display = hasServing ? preserved * 100 / servingSizeG! : 1;

    setUnit(next);
    setServings(display.toFixed(display >= 10 ? 0 : 1));
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg-900/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-800 border border-neon-lime/40 max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="font-display tracking-widest text-sm text-ink-50">Log meal</div>
          <button onClick={onClose} className="text-ink-300 hover:text-ink-100">✕</button>
        </div>
        <div className="text-sm text-slate-100 mb-1">
          {food.name}
          {food.brand && <span className="text-ink-400 text-xs ml-1">· {food.brand}</span>}
        </div>
        <div className="text-[10px] font-mono text-ink-400 mb-3">
          Per 100g: {food.calories.toFixed(0)} cal · {food.proteinG.toFixed(1)}p ·{' '}
          {food.carbG.toFixed(1)}c · {food.fatG.toFixed(1)}f
          {hasServing && (
            <span className="ml-2 text-neon-amber">
              · {servingSizeG!.toFixed(0)}g/serving
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <label className="block">
            <span className="text-[10px] uppercase text-slate-500">Meal</span>
            <select
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
              value={meal}
              onChange={(e) => setMeal(e.target.value as MealType)}
            >
              {MEAL_TYPE_ORDER.map((m) => (
                <option key={m} value={m}>
                  {MEAL_TYPE_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase text-slate-500 flex items-center justify-between">
              <span>
                Quantity (
                {unit === 'x100g'   && '×100g'}
                {unit === 'oz'      && 'oz'}
                {unit === 'serving' && 'servings'}
                )
              </span>
              {/* Unit picker. The 'serving' option is only shown
                  when the food record carries a servingSizeG — many
                  OFF entries don't, and there's no sane default to
                  fall back on. */}
              <select
                value={unit}
                onChange={(e) => changeUnit(e.target.value as Unit)}
                className="text-[11px] font-mono uppercase bg-bg-900 border border-ink-500/40 px-2 py-1.5 text-ink-200"
                title="Switch between ×100g, oz, and per-serving units. Conversion is automatic."
              >
                <option value="x100g">×100g</option>
                <option value="oz">oz</option>
                {hasServing && <option value="serving">serving</option>}
              </select>
            </span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max={unit === 'oz' ? Math.round(50 * 100 / 28.3495) : 50}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
            />
          </label>
        </div>
        <label className="block mb-3">
          <span className="text-[10px] uppercase text-slate-500">Note (optional)</span>
          <input
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="post-workout, with rice, ..."
          />
        </label>
        {valid && (
          <div className="text-[10px] font-mono text-ink-400 mb-2">
            Served: {(food.calories * sNum).toFixed(0)} cal ·{' '}
            {(food.proteinG * sNum).toFixed(1)}p · {(food.carbG * sNum).toFixed(1)}c ·{' '}
            {(food.fatG * sNum).toFixed(1)}f
            <span className="ml-2 text-ink-500">
              ({sNum.toFixed(2)}× 100g
              {hasServing && unit === 'serving' && ` · ${(sNum * 100 / servingSizeG!).toFixed(1)}g`}
              {unit === 'oz' && ` · ${(sNum * 100 / 28.3495).toFixed(1)}oz`}
              )
            </span>
          </div>
        )}
        {logError && (
          <div className="mb-2 text-[11px] font-mono text-rose-400 border border-rose-500/40 bg-rose-500/5 px-2 py-1">
            {logError}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <NeonButton variant="cyan" onClick={onClose}>Cancel</NeonButton>
          <NeonButton
            variant="lime"
            disabled={!valid || logM.isPending}
            loading={logM.isPending}
            loadingText="Logging…"
            onClick={() => {
              setLogError(null);
              logM.run();
            }}
          >
            Log
          </NeonButton>
        </div>
      </div>
    </div>,
    document.body
  );
}


// ============================================================================
// ManualEntryModal — for foods that don't exist on OFF / USDA / Ask AI.
// Always works: type the name + calories + (optionally) protein/carb/fat.
// Saved as a SavedFood row, then available in the saved-foods panel
// like any other entry. The per-100g portion assumption is implicit
// (we treat all macros as 100g-of-food unless the user fills servingSizeG).
// ============================================================================

function ManualEntryModal(props: {
  manualName: string; setManualName: (s: string) => void;
  manualBrand: string; setManualBrand: (s: string) => void;
  manualServingSizeG: string; setManualServingSizeG: (s: string) => void;
  manualCals: string; setManualCals: (s: string) => void;
  manualProtein: string; setManualProtein: (s: string) => void;
  manualCarbs: string; setManualCarbs: (s: string) => void;
  manualFat: string; setManualFat: (s: string) => void;
  ready: boolean;
  loading: boolean;
  err: string | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const {
    manualName, setManualName,
    manualBrand, setManualBrand,
    manualServingSizeG, setManualServingSizeG,
    manualCals, setManualCals,
    manualProtein, setManualProtein,
    manualCarbs, setManualCarbs,
    manualFat, setManualFat,
    ready, loading, err, onSave, onClose,
  } = props;

  return (
    <ModalPortal onClose={onClose}>
      <div className="border border-neon-amber/40 bg-bg-800 p-4 max-w-md w-full space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="font-display tracking-widest text-neon-amber uppercase">
            Manual food entry
          </div>
          <button type="button" onClick={onClose}
            className="text-ink-400 hover:text-ink-100 text-sm">×</button>
        </div>
        <div className="text-[10px] font-mono text-ink-300">
          Can't find it on OFF / USDA, or Ask AI gave you nothing useful?
          Type the macros yourself. Saved to your <b>Your saved foods</b>
          panel for one-tap logging next time. All macros are per-100g
          unless you set a serving size.
        </div>

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-400 block mb-1">
            Name (required)
          </label>
          <input
            className="input-neon w-full"
            placeholder="e.g. Homemade banana bread"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-ink-400 block mb-1">
              Brand (optional)
            </label>
            <input className="input-neon w-full" placeholder="e.g. Costco" value={manualBrand} onChange={(e) => setManualBrand(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-ink-400 block mb-1">
              Serving size in grams (optional)
            </label>
            <input className="input-neon w-full" type="number" min="0" step="1" placeholder="e.g. 50"
              value={manualServingSizeG}
              onChange={(e) => setManualServingSizeG(e.target.value)} />
          </div>
        </div>

        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1">
            Per 100g (or per serving if you set a serving size above)
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className="text-[9px] font-mono uppercase text-ink-500 block mb-0.5">
                kcal <span className="text-rose-400">*</span>
              </label>
              <input className="input-neon w-full" type="number" min="0" step="1"
                placeholder="0" value={manualCals}
                onChange={(e) => setManualCals(e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] font-mono uppercase text-ink-500 block mb-0.5">protein g</label>
              <input className="input-neon w-full" type="number" min="0" step="0.1"
                placeholder="0" value={manualProtein}
                onChange={(e) => setManualProtein(e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] font-mono uppercase text-ink-500 block mb-0.5">carb g</label>
              <input className="input-neon w-full" type="number" min="0" step="0.1"
                placeholder="0" value={manualCarbs}
                onChange={(e) => setManualCarbs(e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] font-mono uppercase text-ink-500 block mb-0.5">fat g</label>
              <input className="input-neon w-full" type="number" min="0" step="0.1"
                placeholder="0" value={manualFat}
                onChange={(e) => setManualFat(e.target.value)} />
            </div>
          </div>
          <div className="text-[10px] font-mono text-ink-500 mt-1">
            <span className="text-rose-400">*</span> Calories is the only required field. Leave protein/carb/fat at 0
            if you don't know — the saved food will log as best-effort.
          </div>
        </div>

        {err && <div className="text-[10px] font-mono text-neon-magenta">! {err}</div>}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onSave}
            disabled={!ready || loading}
            className="flex-1 px-3 py-1.5 text-xs font-display tracking-widest uppercase border border-neon-amber text-neon-amber bg-neon-amber/10 hover:bg-neon-amber/20 disabled:opacity-40"
          >
            {loading ? 'Saving…' : 'Save to my foods'}
          </button>
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 text-xs font-mono border border-ink-500/40 text-ink-300 hover:border-ink-300">
            Cancel
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}

// ============================================================================
// ModalPortal — simple createPortal wrapper for centered modals.
// ============================================================================

function ModalPortal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  // Close on backdrop click
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-900/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
