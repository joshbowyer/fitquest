import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { api } from '@/lib/api';
import { Panel } from '@/components/Panel';
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
  });

  const delM = useDelayedMutation<{ ok: boolean }, { id: string }>({
    mutationFn: ({ id }) => api(`/meals/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meals', 'today'] }),
  }, 200);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {MEAL_TYPE_ORDER.map((m) => (
        <MealCard
          key={m}
          meal={m}
          bucket={todayQ.data?.meals[m]}
          loading={todayQ.isLoading}
          onDelete={(id) => delM.run({ id })}
        />
      ))}
    </div>
  );
}

function MealCard({
  meal,
  bucket,
  loading,
  onDelete,
}: {
  meal: MealType;
  bucket?: { items: MealEntry[]; totals: any };
  loading: boolean;
  onDelete: (id: string) => void;
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
            <MealItemRow key={e.id} entry={e} onDelete={onDelete} />
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
}: {
  entry: MealEntry;
  onDelete: (id: string) => void;
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
          ×{entry.servings} · {entry.served.calories.toFixed(0)} cal ·{' '}
          {entry.served.proteinG.toFixed(1)}p
        </div>
      </div>
      <button
        onClick={() => {
          if (confirm(`Remove "${entry.food.name}"?`)) onDelete(entry.id);
        }}
        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 text-xs shrink-0"
        title="Remove this entry"
      >
        ×
      </button>
    </div>
  );
}
