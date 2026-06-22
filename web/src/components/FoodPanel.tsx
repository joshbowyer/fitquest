import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { api } from '@/lib/api';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { classNames } from '@/lib/format';
import {
  type FoodMatch,
  type MealEntry,
  type MealType,
  type TodayMealsResponse,
  MEAL_TYPE_LABEL,
  MEAL_TYPE_ORDER,
} from '@/lib/types';

type AskAiResult = {
  query: string;
  reason: string;
  items: FoodMatch[];
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
  const askM = useDelayedMutation<AskAiResult, string>({
    mutationFn: async (description) =>
      api('/foods/ask-ai', { method: 'POST', body: { description } }),
    onSuccess: (r) => setAskResults(r),
  }, 1500);

  // ---- Log modal ----
  const [logFood, setLogFood] = useState<FoodMatch | null>(null);
  const recentQ = useQuery({
    queryKey: ['meals', 'recent'],
    queryFn: () => api<{ items: MealEntry[] }>('/meals?days=7'),
  });

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
            title="Browse all foods you've logged + saved + import from FoodYou backup"
          >
            Recent foods
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
                  ×{m.servings}
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
          onPick={(food) => {
            // Hand the food to the LogMeal modal and close this
            // one in the same tick so the user never has to click
            // a separate "log" button.
            setLogFood(food);
            setAskOpen(false);
            setAskResults(null);
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
  onPick,
}: {
  loading: boolean;
  result: AskAiResult | null;
  error: string | null;
  onClose: () => void;
  onSubmit: (description: string) => void;
  /**
   * Called when the user picks one of the LLM-returned results.
   * The parent should open the LogMealModal with this food and
   * close the AskAi modal in the same tick.
   */
  onPick: (food: FoodMatch) => void;
}) {
  const [draft, setDraft] = useState('');
  const valid = draft.trim().length >= 3;
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
        <div className="text-[10px] font-mono text-ink-400 mb-3">
          Describe what you ate. The LLM extracts a 2-4 keyword
          search query and finds the closest match in OpenFoodFacts
          (or USDA if you have a key). Cooking method and qualifiers
          are stripped; brand names are kept.
        </div>
        <textarea
          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
          rows={3}
          autoFocus
          placeholder="e.g. Annie's mac and cheese  ·  6 large strawberries  ·  fried boneless chicken breast about the size of my hand"
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
        {result && (
          <div className="mt-2 text-xs font-mono">
            <div className="text-violet-300">
              <b>{result.query}</b>
            </div>
            <div className="text-ink-400">{result.reason}</div>
          </div>
        )}
        {/*
          Results INSIDE the modal so the user can pick without
          closing first. Each row is a button that hands the
          food back to the parent (which opens the LogMeal modal
          and closes this one). The list is scroll-isolated so a
          long description textarea doesn't push the buttons out
          of view.
        */}
        {result && result.items.length > 0 && (
          <div className="mt-3 flex-1 min-h-0 flex flex-col">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500 mb-1.5">
              {result.items.length} result{result.items.length === 1 ? '' : 's'} — click to log
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto border border-ink-500/20">
              {result.items.slice(0, 8).map((it) => (
                <button
                  key={`${it.source}:${it.sourceId}`}
                  type="button"
                  onClick={() => onPick(it)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] font-mono hover:bg-neon-violet/10 border-b border-ink-500/10 last:border-b-0"
                >
                  {it.imageUrl ? (
                    <img
                      src={it.imageUrl}
                      alt=""
                      className="w-6 h-6 object-cover rounded border border-ink-500/30 shrink-0"
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-6 h-6 bg-slate-800/60 rounded border border-ink-500/30 shrink-0 flex items-center justify-center text-[8px] text-ink-500">
                      {it.source === 'OPENFOODFACTS' ? 'OFF' : 'USDA'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-100 truncate">{it.name}</div>
                    <div className="text-[10px] text-ink-400 truncate">
                      {it.brand && <span className="text-ink-300">{it.brand} · </span>}
                      {it.calories.toFixed(0)} cal · {it.proteinG.toFixed(1)}p ·{' '}
                      {it.carbG.toFixed(1)}c · {it.fatG.toFixed(1)}f
                      <span className="text-ink-500"> per 100g</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-neon-violet shrink-0">→ log</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {result && result.items.length === 0 && (
          <div className="mt-3 p-3 text-[11px] font-mono text-ink-400 border border-ink-500/20 bg-bg-900/40">
            No matches in OpenFoodFacts. Try a different phrasing or
            use the regular search bar above.
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <NeonButton variant="cyan" onClick={onClose}>
            Close
          </NeonButton>
          <NeonButton
            variant="violet"
            disabled={!valid || loading}
            loading={loading}
            loadingText="Asking…"
            onClick={() => valid && onSubmit(draft.trim())}
          >
            Ask
          </NeonButton>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================================
// Manage Saved Foods modal — list, add, edit, delete the user's recipes
// ============================================================================
// Recent foods modal — full list + FoodYou import
// ============================================================================
//
// Shows ALL the user's saved foods (the "Your saved foods"
// list, but bigger + with quick-log). If a FoodYou backup DB
// is found in /tmp, also shows the importable list pulled from
// it: foods the user actually logged in FoodYou + their recent
// search terms' best OFF/USDA matches + recent catalog additions.
// Click an item to open the LogMeal modal.

type FoodYouImportFood = {
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
  source: 'diary';
  foodYouId: number;
};

type FoodYouImportResponse =
  | {
      available: true;
      path: string;
      diary: FoodYouImportFood[];
    }
  | { available: false; reason: string; message: string; path?: string };

function RecentFoodsModal({
  items,
  onClose,
  onLog,
  onSavedChanged,
}: {
  items: SavedFoodDto[];
  onClose: () => void;
  onLog: (food: FoodMatch) => void;
  onSavedChanged: () => void;
}) {
  // Map a SavedFood into the FoodMatch shape the LogMeal modal
  // expects, so the user can quick-log a saved food from here
  // (and then import a FoodYou food from the same modal).
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

  // Map a FoodYou diary row into the FoodMatch shape so the user
  // can quick-log a meal directly from the import list without
  // first having to add it to their saved foods. We synthesize a
  // stable sourceId from the foodYouId so the LogMeal modal can
  // pass it through to the server (which upserts a FoodItem by
  // (source, sourceId) and creates the MealEntry in one tx).
  function foodYouToMatch(f: FoodYouImportFood): FoodMatch {
    return {
      source: 'MANUAL',
      sourceId: `foodyou-${f.foodYouId}`,
      name: f.name,
      brand: f.brand,
      imageUrl: null,
      servingSizeG: f.servingSizeG,
      calories: f.calories,
      proteinG: f.proteinG,
      carbG: f.carbG,
      fatG: f.fatG,
      fiberG: f.fiberG,
      sugarG: f.sugarG,
      sodiumMg: f.sodiumMg,
      sourceUrl: null,
    };
  }

  // FoodYou import state
  const importQ = useQuery({
    queryKey: ['foods', 'import', 'foodyou'],
    queryFn: () => api<FoodYouImportResponse>('/foods/import/foodyou'),
    // Don't run unless the modal is open.
    enabled: true,
    retry: false,
  });
  const importM = useDelayedMutation<
    { ok: boolean; created: number; skipped: number },
    { items: Omit<FoodYouImportFood, 'foodYouId' | 'source'>[] }
  >({
    mutationFn: (body) =>
      api('/foods/import/foodyou/commit', { method: 'POST', body }),
    onSuccess: () => {
      onSavedChanged();
      importQ.refetch();
    },
  }, 800);
  // Which import-item ids the user has checked. Map<foodYouId, checked>.
  const [picked, setPicked] = useState<Set<number>>(new Set());

  // Free-text filter applied to BOTH the saved-foods list and
  // the FoodYou import list. The query is debounced implicitly
  // via React state updates; for a few hundred items we don't
  // need anything fancier. Empty query = show everything.
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const matches = (name: string, brand: string | null | undefined) => {
    if (!f) return true;
    if (name.toLowerCase().includes(f)) return true;
    if (brand && brand.toLowerCase().includes(f)) return true;
    return false;
  };

  const importData = importQ.data && importQ.data.available ? importQ.data : null;
  // Diary entries: every distinct food the user actually logged
  // in FoodYou (the DiaryProduct table, ordered by id DESC so
  // most recent first). Deduped by (name+brand) so logging the
  // same item 5 times shows once. The user explicitly asked
  // for THIS — the actual meal log, not custom-adds or searches.
  const allImportable = importData?.diary ?? [];

  // "Import all" = check the currently-filtered diary entries.
  // When a filter is active, "all" means the visible subset
  // (so the user can quickly import just the matches).
  function pickAll() {
    const next = new Set<number>(picked);
    if (!importData) return next;
    for (const f of importData.diary) {
      if (matches(f.name, f.brand)) next.add(f.foodYouId);
    }
    return next;
  }
  // "Clear" = uncheck the currently-filtered entries (so
  // "select all → clear" cycles in the user's filter scope).
  function clearAll() {
    const next = new Set<number>(picked);
    if (!importData) return next;
    for (const f of importData.diary) {
      if (matches(f.name, f.brand)) next.delete(f.foodYouId);
    }
    return next;
  }
  const filteredDiary = (importData?.diary ?? []).filter((f) => matches(f.name, f.brand));
  const allPicked = filteredDiary.length > 0 && filteredDiary.every((f) => picked.has(f.foodYouId));

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

        {/* ---------- Your saved foods (the always-available quick-log list) ---------- */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500">
              Your saved foods ({items.length})
            </div>
            {/* Filter input — applies to BOTH the saved-foods
                list and the FoodYou import list. Case-insensitive
                substring match against name + brand. ESC clears. */}
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
          {items.length === 0 ? (
            <div className="text-xs text-ink-400 font-mono py-2">
              You don't have any saved foods yet. Either save a search
              result with the ★ save button, or import from a FoodYou
              backup below.
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

        {/* ---------- FoodYou backup import ---------- */}
        <div className="border-t border-ink-500/20 pt-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500">
              Import from FoodYou backup
            </div>
            {importData && allImportable.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPicked(allPicked ? clearAll() : pickAll())}
                  className="text-[10px] font-mono text-violet-300 hover:underline"
                >
                  {allPicked ? 'clear' : 'select all'}
                </button>
                <NeonButton
                  size="sm"
                  variant="cyan"
                  disabled={picked.size === 0 || importM.isPending}
                  loading={importM.isPending}
                  loadingText="Importing…"
                  onClick={() => {
                    // Translate the picked-set into the items the
                    // server expects. We strip the FoodYou-specific
                    // fields (foodYouId, source) before sending.
                    const itemsToSend = allImportable
                      .filter((f) => picked.has(f.foodYouId))
                      .map((f) => ({
                        name: f.name,
                        brand: f.brand,
                        servingSizeG: f.servingSizeG,
                        calories: f.calories,
                        proteinG: f.proteinG,
                        carbG: f.carbG,
                        fatG: f.fatG,
                        fiberG: f.fiberG,
                        sugarG: f.sugarG,
                        sodiumMg: f.sodiumMg,
                      }));
                    importM.run({ items: itemsToSend });
                    setPicked(new Set());
                  }}
                >
                  Import {picked.size > 0 ? `(${picked.size})` : ''}
                </NeonButton>
              </div>
            )}
          </div>
          {importQ.isLoading && (
            <div className="text-xs text-ink-400 font-mono py-2">⏳ Looking for a FoodYou backup in /tmp/…</div>
          )}
          {!importQ.isLoading && importQ.data && importQ.data.available === false && (
            <div className="text-xs text-ink-400 font-mono py-2 space-y-1">
              <div>No FoodYou backup found at {importQ.data.path ?? '/tmp/foodyou-*.db'}.</div>
              {importQ.data.reason === 'parse_error' && (
                <div className="text-rose-400">{importQ.data.message}</div>
              )}
              <div className="text-[10px] text-ink-500">
                Drop a FoodYou SQLite export (foodyou-*.db) in /tmp/
                and reload this modal.
              </div>
            </div>
          )}
          {importData && (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {allImportable.length === 0 ? (
                <div className="text-xs text-ink-400 font-mono py-2">
                  No foods found in the backup.
                </div>
              ) : (
                <>
                  <div className="text-[10px] font-mono text-amber-300 mt-1 mb-1">
                    {(() => {
                      const filtered = allImportable.filter((f) => matches(f.name, f.brand));
                      if (f) return `${filtered.length} of ${allImportable.length} match "${filter}"`;
                      return `${allImportable.length} foods you actually ate`;
                    })()}
                    <span className="text-ink-500"> · newest first</span>
                    {f && (
                      <button
                        type="button"
                        onClick={() => setFilter('')}
                        className="ml-2 text-cyan-300 hover:underline"
                      >
                        clear filter
                      </button>
                    )}
                  </div>
                  {allImportable.filter((f) => matches(f.name, f.brand)).map((f) => (
                    <ImportRow
                      key={f.foodYouId}
                      f={f}
                      checked={picked.has(f.foodYouId)}
                      onToggle={() => {
                        const next = new Set(picked);
                        if (next.has(f.foodYouId)) next.delete(f.foodYouId);
                        else next.add(f.foodYouId);
                        setPicked(next);
                      }}
                      onLog={(row) => onLog(foodYouToMatch(row))}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ImportRow({
  f,
  checked,
  onToggle,
  onLog,
}: {
  f: FoodYouImportFood;
  checked: boolean;
  onToggle: () => void;
  onLog: (f: FoodMatch) => void;
}) {
  return (
    <label
      className={`flex items-center gap-2 px-2 py-1 text-[11px] font-mono border cursor-pointer ${
        checked
          ? 'border-neon-cyan/60 bg-neon-cyan/10'
          : 'border-ink-500/20 hover:bg-slate-800/40'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="rounded shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-slate-100 truncate">{f.name}</div>
        <div className="text-[10px] text-ink-400 truncate">
          {f.brand && <span className="text-ink-300">{f.brand} · </span>}
          {f.calories.toFixed(0)} cal · {f.proteinG.toFixed(1)}p · {f.carbG.toFixed(1)}c · {f.fatG.toFixed(1)}f
          <span className="text-ink-500"> per {f.servingSizeG ?? 100}g</span>
        </div>
      </div>
      {/* Quick-log: open the LogMeal modal with the food's macros
          pre-filled, no import step required. Stops propagation so
          the label's checkbox toggle doesn't fire when the user
          is just trying to log a single row. */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onLog(f);
        }}
        className="px-2 py-0.5 text-[10px] font-mono border border-neon-lime/60 text-neon-lime hover:bg-neon-lime/10 shrink-0"
        title="Open Log meal modal with these macros pre-filled"
      >
        Log
      </button>
    </label>
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
                    <button
                      onClick={() => {
                        if (confirm(`Remove "${s.name}" from saved foods?`)) {
                          delM.run(s.id);
                        }
                      }}
                      disabled={delM.isPending}
                      className="px-2 py-1 text-[10px] font-mono text-ink-400 hover:text-rose-400"
                    >
                      ✕
                    </button>
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
    const h = new Date().getHours();
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
  // Default the meal based on the time of day: morning = BREAKFAST,
  // midday = LUNCH, evening = DINNER, late = SNACK.
  const hour = new Date().getHours();
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
                className="text-[9px] font-mono uppercase bg-bg-900 border border-ink-500/40 px-1 py-0 text-ink-300"
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
