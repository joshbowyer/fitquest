import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Panel } from './Panel';
import { METRICS, METRICS_BY_CATEGORY, type MetricType } from '@/lib/types';
import { classNames, formatRelative, formatMetricWithUnit } from '@/lib/format';
import { convertForDisplay, convertForStorage, displayUnit, type UnitSystem } from '@/lib/units';
import { useAuth } from '@/lib/auth';

type HabitStatus = Record<string, { logged: boolean; value: number | null; recordedAt: string | null }>;

const ALL_HABITS: MetricType[] = [
  ...METRICS_BY_CATEGORY.SLEEP,
  ...METRICS_BY_CATEGORY.NUTRITION,
  ...METRICS_BY_CATEGORY.WELLNESS,
];

const CATEGORY_ICON: Record<string, string> = {
  SLEEP: '☾',
  NUTRITION: '⌬',
  WELLNESS: '♥',
};

const CATEGORY_COLOR: Record<string, string> = {
  SLEEP: 'violet',
  NUTRITION: 'lime',
  WELLNESS: 'magenta',
};

export function TodayHabitsPanel() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<MetricType | null>(null);
  const [draft, setDraft] = useState('');
  const { user } = useAuth();
  const system: UnitSystem = user?.units ?? 'METRIC';

  const statusQ = useQuery({
    queryKey: ['habits', 'today'],
    queryFn: () => api<{ status: HabitStatus }>('/measurements/habits/today'),
  });
  const status = statusQ.data?.status || {};

  const batchM = useMutation({
    mutationFn: (items: Array<{ metric: MetricType; value: number }>) =>
      api('/measurements/batch', { method: 'POST', body: { items } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      setEditing(null);
      setDraft('');
    },
  });

  const completed = ALL_HABITS.filter((m) => status[m]?.logged).length;
  const pct = completed / ALL_HABITS.length;

  function quickLog(m: MetricType) {
    if (!draft) return;
    const value = Number(draft);
    if (!Number.isFinite(value) || value < 0) return;
    // Convert input from display unit back to metric
    const stored = convertForStorage(value, displayUnit(METRICS[m].unit, system), system);
    batchM.mutate([{ metric: m, value: stored.value }]);
  }

  return (
    <Panel variant="cyan" title="Today's Habits">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-mono text-ink-300">
            {completed}/{ALL_HABITS.length} logged
          </div>
          <Link
            to="/habits"
            className="text-[10px] font-display tracking-widest neon-text-cyan hover:underline"
          >
            → ALL
          </Link>
        </div>
        <div className="h-1 bg-bg-700 border border-ink-500/30 overflow-hidden">
          <div
            className={classNames(
              'h-full transition-all duration-500',
              completed === ALL_HABITS.length ? 'bg-neon-lime' : 'bg-neon-cyan'
            )}
            style={{ width: `${pct * 100}%`, boxShadow: '0 0 6px currentColor' }}
          />
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(['SLEEP', 'NUTRITION', 'WELLNESS'] as const).map((cat) => {
            const metrics = METRICS_BY_CATEGORY[cat];
            const done = metrics.filter((m) => status[m]?.logged).length;
            const color = CATEGORY_COLOR[cat];
            return (
              <div
                key={cat}
                className={`border border-neon-${color}/30 bg-neon-${color}/5 p-1.5`}
              >
                <div className="flex items-center gap-1 text-[10px] font-display tracking-widest">
                  <span className={`neon-text-${color}`}>{CATEGORY_ICON[cat]}</span>
                  <span className={`neon-text-${color}`}>{cat}</span>
                </div>
                <div className="text-[10px] font-mono text-ink-300 mt-0.5">
                  {done}/{metrics.length}
                </div>
              </div>
            );
          })}
        </div>
        <div className="space-y-1 pt-1">
          {ALL_HABITS.map((m) => {
            const s = status[m];
            const meta = METRICS[m];
            const isEditing = editing === m;
            return (
              <div
                key={m}
                className={classNames(
                  'flex items-center justify-between text-xs font-mono py-0.5 px-1.5 border transition-all',
                  s?.logged
                    ? 'border-neon-lime/30 bg-neon-lime/5'
                    : 'border-ink-500/30 hover:border-neon-cyan/40'
                )}
              >
                <div className="flex-1">
                  <div className={s?.logged ? 'text-neon-lime' : 'text-ink-200'}>
                    {meta.shortLabel}
                  </div>
                  {s?.logged && s.value != null ? (
                    <div className="text-[9px] text-ink-300">
                      {(() => {
                        const disp = convertForDisplay(s.value, meta.unit, system);
                        return `${disp.value.toFixed(meta.unit === 'g' || meta.unit === 'ml' || meta.unit === 'fl oz' || meta.unit === 'kcal' ? 0 : 1)} ${disp.unit}`;
                      })()} · {s.recordedAt ? formatRelative(s.recordedAt) : ''}
                    </div>
                  ) : null}
                </div>
                {!s?.logged && (
                  isEditing ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        className="input-neon w-20 text-xs px-1 py-0.5"
                        type="number"
                        step={meta.unit === 'kcal' || meta.unit === 'ml' || meta.unit === 'g' ? 1 : 0.1}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') quickLog(m);
                          if (e.key === 'Escape') { setEditing(null); setDraft(''); }
                        }}
                        onBlur={() => { if (!draft) setEditing(null); }}
                        placeholder={displayUnit(meta.unit, system)}
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditing(m); setDraft(''); }}
                      className="text-[10px] font-display tracking-widest text-ink-300 hover:text-neon-cyan"
                    >
                      + log
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
        {batchM.isPending && (
          <div className="text-[10px] font-mono neon-text-cyan animate-pulse text-center">
            saving…
          </div>
        )}
      </div>
    </Panel>
  );
}
