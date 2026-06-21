import { useEffect, useState } from 'react';
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
  MEAL_TYPE_LABEL,
  MEAL_TYPE_ORDER,
} from '@/lib/types';

type AskAiResult = {
  query: string;
  reason: string;
  items: FoodMatch[];
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
  const [recentQ] = useQuery({
    queryKey: ['meals', 'recent'],
    queryFn: () => api<{ items: MealEntry[] }>('/meals?days=7'),
  });

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
}: {
  loading: boolean;
  result: AskAiResult | null;
  error: string | null;
  onClose: () => void;
  onSubmit: (description: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const valid = draft.trim().length >= 3;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg-900/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-800 border border-neon-violet/40 max-w-md w-full p-5"
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
// Log Meal modal — pick meal section + set servings
// ============================================================================

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

  const [meal, setMeal] = useState<MealType>(defaultMeal);
  const [servings, setServings] = useState<string>('1.0');
  const [note, setNote] = useState('');
  const sNum = Number(servings);
  const valid = Number.isFinite(sNum) && sNum > 0 && sNum <= 50;

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
  }, 400);

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
            <span className="text-[10px] uppercase text-slate-500">Servings (×100g)</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="50"
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
          </div>
        )}
        <div className="flex justify-end gap-2">
          <NeonButton variant="cyan" onClick={onClose}>Cancel</NeonButton>
          <NeonButton
            variant="lime"
            disabled={!valid || logM.isPending}
            loading={logM.isPending}
            loadingText="Logging…"
            onClick={() => logM.run()}
          >
            Log
          </NeonButton>
        </div>
      </div>
    </div>,
    document.body
  );
}
