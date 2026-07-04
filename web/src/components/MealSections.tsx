import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { api } from '@/lib/api';
import { formatQty, formatNum } from '@/lib/format';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import {
  MEAL_TYPE_LABEL,
  MEAL_TYPE_ORDER,
  type MealType,
  type TodayMealsResponse,
  type MealEntry,
} from '@/lib/types';
import { classNames } from '@/lib/format';

type PanelVariant = 'cyan' | 'magenta' | 'amber' | 'lime' | 'violet';

const MEAL_VARIANT: Record<MealType, PanelVariant> = {
  BREAKFAST: 'amber',
  LUNCH: 'lime',
  DINNER: 'cyan',
  SNACK: 'violet',
};

export function MealSections() {
  const qc = useQueryClient();
  const todayQ = useQuery({
    queryKey: ['meals', 'today'],
    queryFn: () => api<TodayMealsResponse>('/meals/today'),
    // Refetch on focus + when the page becomes visible again so
    // multi-tab edits + late logs show up without a manual reload.
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  const delM = useDelayedMutation<{ ok: boolean }, { id: string }>({
    mutationFn: ({ id }) => api(`/meals/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meals', 'today'] }),
  }, 200);

  // PATCH /meals/:id — change meal section or servings.
  const patchM = useDelayedMutation<
    { item: any },
    { id: string; meal?: MealType; servings?: number; note?: string | null }
  >({
    mutationFn: ({ id, ...body }) =>
      api(`/meals/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meals', 'today'] });
      qc.invalidateQueries({ queryKey: ['meals', 'recent'] });
    },
  }, 300);

  const [editing, setEditing] = useState<MealEntry | null>(null);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {MEAL_TYPE_ORDER.map((m) => (
        <MealCard
          key={m}
          meal={m}
          bucket={todayQ.data?.meals[m]}
          loading={todayQ.isLoading}
          onDelete={(id) => delM.run({ id })}
          onEdit={(e) => setEditing(e)}
        />
      ))}
      {editing && (
        <EditMealModal
          entry={editing}
          saving={patchM.isPending}
          onClose={() => setEditing(null)}
          onSave={(meal, servings, note) => {
            patchM.run({ id: editing.id, meal, servings, note });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function MealCard({
  meal,
  bucket,
  loading,
  onDelete,
  onEdit,
}: {
  meal: MealType;
  bucket?: { items: MealEntry[]; totals: any };
  loading: boolean;
  onDelete: (id: string) => void;
  onEdit: (entry: MealEntry) => void;
}) {
  const items = bucket?.items ?? [];
  const totals = bucket?.totals;
  const variant = MEAL_VARIANT[meal];
  return (
    <Panel
      title={MEAL_TYPE_LABEL[meal]}
      variant={variant}
      action={
        <span className="text-[10px] font-mono text-ink-300">
          {loading
            ? '…'
            : totals
            ? `${totals.calories.toFixed(0)} cal`
            : '0 cal'}
        </span>
      }
    >
      {loading ? (
        <div className="text-[11px] font-mono text-ink-400 py-2">⏳ Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-[11px] font-mono text-ink-400 py-2 text-center">
          Nothing logged.
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((e) => (
            <MealItemRow key={e.id} entry={e} onDelete={onDelete} onEdit={onEdit} />
          ))}
          {totals && (
            <div className="text-[10px] font-mono text-ink-400 border-t border-ink-500/15 pt-1.5 flex items-baseline gap-2">
              <span className="text-ink-500">total</span>
              <span className="text-amber-300">{totals.calories.toFixed(0)} cal</span>
              <span className="text-slate-400">·</span>
              <span>{totals.proteinG.toFixed(1)}p</span>
              <span className="text-slate-400">·</span>
              <span>{totals.carbG.toFixed(1)}c</span>
              <span className="text-slate-400">·</span>
              <span>{totals.fatG.toFixed(1)}f</span>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function MealItemRow({
  entry,
  onDelete,
  onEdit,
}: {
  entry: MealEntry;
  onDelete: (id: string) => void;
  onEdit: (entry: MealEntry) => void;
}) {
  return (
    <div className="flex items-center gap-2 group">
      {entry.food.imageUrl ? (
        <img
          src={entry.food.imageUrl}
          alt=""
          className="w-6 h-6 object-cover rounded border border-ink-500/30 shrink-0"
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div className="w-6 h-6 rounded border border-ink-500/30 bg-slate-800/40 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-slate-100 truncate">
          {entry.food.name}
          {entry.food.brand && (
            <span className="text-ink-400 ml-1 text-[10px]">· {entry.food.brand}</span>
          )}
        </div>
        <div className="text-[10px] font-mono text-ink-400">
          ×{formatQty(entry.servings)} · {entry.served.calories.toFixed(0)} cal ·{' '}
          {entry.served.proteinG.toFixed(1)}p
          {entry.note && (
            <span className="text-ink-500 ml-1 italic truncate">— {entry.note}</span>
          )}
        </div>
      </div>
      {/* Always-visible action buttons. Wrapped in the same yellow
          capsule chrome as the saved-foods row's [+ log ▾] so
          both entry types look consistent in the UI — bare gray
          text was easy to miss and felt like a different kind of
          element. Muted text by default, full color on hover. */}
      <div className="flex items-center shrink-0 border border-neon-amber/50 rounded-sm">
        <button
          onClick={() => onEdit(entry)}
          className="px-1.5 py-0.5 text-[10px] font-mono text-neon-amber hover:bg-neon-amber/10"
          title="Edit meal / servings / note"
        >
          edit
        </button>
        <button
          onClick={() => {
            if (confirm(`Remove "${entry.food.name}"?`)) onDelete(entry.id);
          }}
          className="px-1.5 py-0.5 text-[10px] font-mono text-rose-400 hover:bg-rose-400/10 border-l border-neon-amber/50"
          title="Remove this entry"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Edit Meal modal — change meal section / servings / note in place
// ============================================================================
//
// Lets the user fix a quick-log ("I meant 2 scoops not 1", "this
// was a snack not breakfast"). Doesn't allow swapping the food
// itself — that would mean re-running the macros, which is
// error-prone. Delete + re-log is the right path for that.

function EditMealModal({
  entry,
  saving,
  onClose,
  onSave,
}: {
  entry: MealEntry;
  saving: boolean;
  onClose: () => void;
  onSave: (meal: MealType, servings: number, note: string | null) => void;
}) {
  const [meal, setMeal] = useState<MealType>(entry.meal);
  const [servings, setServings] = useState(String(entry.servings));
  const [note, setNote] = useState(entry.note ?? '');
  const sNum = Number(servings);
  const valid = Number.isFinite(sNum) && sNum > 0 && sNum <= 50;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg-900/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-800 border border-neon-cyan/40 max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="font-display tracking-widest text-sm text-ink-50">
            Edit entry
          </div>
          <button onClick={onClose} className="text-ink-300 hover:text-ink-100">✕</button>
        </div>
        <div className="text-[10px] font-mono text-ink-400 mb-3 truncate">
          {entry.food.name}
          {entry.food.brand && <span className="ml-1 text-ink-500">· {entry.food.brand}</span>}
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
            New served: {(entry.served.calories / entry.servings * sNum).toFixed(0)} cal ·{' '}
            {(entry.served.proteinG / entry.servings * sNum).toFixed(1)}p
            <span className="text-ink-500 ml-1">
              (scale {formatQty(entry.servings)}→{formatQty(sNum)})
            </span>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <NeonButton variant="cyan" onClick={onClose}>Cancel</NeonButton>
          <NeonButton
            variant="cyan"
            disabled={!valid || saving}
            loading={saving}
            loadingText="Saving…"
            onClick={() => onSave(meal, sNum, note.trim() || null)}
          >
            Save
          </NeonButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
