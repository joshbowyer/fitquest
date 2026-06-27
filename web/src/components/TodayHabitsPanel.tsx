import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Panel } from './Panel';
import { METRICS, METRICS_BY_CATEGORY, type MetricType } from '@/lib/types';
import { classNames, formatRelative } from '@/lib/format';
import { useLiveClock } from '@/hooks/useLiveClock';
import { useDopamineTap, DOPA_TAP_CLASS } from '@/hooks/useDopamineTap';
import { Modal } from './Modal';
import { convertForDisplay, convertForStorage, displayUnit, type UnitSystem } from '@/lib/units';
import { useAuth } from '@/lib/auth';

type HabitStatus = Record<string, { logged: boolean; value: number | null; recordedAt: string | null }>;

// "Today" widget on Dashboard + /today: shows every check-in
// metric the user has configured (one row per MetricType). Nutrition
// lives on /nutrition with its own widget, and user-defined habits
// live on /habits with their own widget. Grouped by cadence
// (AM / PM / WEEKLY) so the picker mirrors the /check-ins modal.
// Source of truth for which metrics surface in this widget +
// in the CheckInsPickerModal — the cadence table from lib/checkIns.ts.
// We import rather than re-derive so the two stay in lockstep.
import { DEFAULT_CADENCE } from '@/lib/checkIns';

export function TodayHabitsPanel() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<MetricType | null>(null);
  const [draft, setDraft] = useState('');
  const [pulseAt, setPulseAt] = useState<Record<string, number>>({});
  const { user } = useAuth();
  const system: UnitSystem = user?.units ?? 'METRIC';
  const { onTap, onSuccess: hapticSuccess, onError: hapticError } = useDopamineTap();

  const statusQ = useQuery({
    queryKey: ['today', 'status'],
    queryFn: () => api<{ status: HabitStatus }>('/measurements/habits/today'),
  });
  const status = statusQ.data?.status || {};

  const batchM = useMutation({
    mutationFn: (items: Array<{ metric: MetricType; value: number }>) =>
      api('/measurements/batch', { method: 'POST', body: { items } }),
    onSuccess: (_data, items) => {
      // Per-row dopamine pulse + haptic. The CSS class is removed
      // automatically after the animation; the timestamp just lets
      // us re-trigger if the user logs the same metric again.
      const ts = hapticSuccess();
      setPulseAt((prev) => {
        const next = { ...prev };
        for (const it of items) next[it.metric] = ts;
        return next;
      });
      qc.invalidateQueries({ queryKey: ['today'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      setEditing(null);
      setDraft('');
    },
    onError: () => hapticError(),
  });

  // AM + PM metrics are the daily-cadence surface — that's what the
  // panel renders inline. Weekly metrics (WAIST, BENCH_1RM, etc.)
  // live behind a "Weekly checks" button shown on Sundays only.
  const dailyMetrics = (Object.keys(DEFAULT_CADENCE) as MetricType[])
    .filter((m) => DEFAULT_CADENCE[m] === 'AM' || DEFAULT_CADENCE[m] === 'PM');
  const weeklyMetrics = (Object.keys(DEFAULT_CADENCE) as MetricType[])
    .filter((m) => DEFAULT_CADENCE[m] === 'WEEKLY');
  const completedDaily = dailyMetrics.filter((m) => status[m]?.logged).length;
  const completedAm  = dailyMetrics.filter((m) => DEFAULT_CADENCE[m] === 'AM' && status[m]?.logged).length;
  const completedPm  = dailyMetrics.filter((m) => DEFAULT_CADENCE[m] === 'PM' && status[m]?.logged).length;
  const completedWeekly = weeklyMetrics.filter((m) => status[m]?.logged).length;
  const totalAm = dailyMetrics.filter((m) => DEFAULT_CADENCE[m] === 'AM').length;
  const totalPm = dailyMetrics.filter((m) => DEFAULT_CADENCE[m] === 'PM').length;
  const pct = dailyMetrics.length > 0 ? completedDaily / dailyMetrics.length : 0;

  // Today in the user's local tz so Sunday detection is right
  // for shift workers (1am on Monday = still Sunday in some tzs).
  const now = useLiveClock();
  const dow = now.getDay(); // 0 = Sun
  const isSunday = dow === 0;
  const [weeklyOpen, setWeeklyOpen] = useState(false);

  function quickLog(m: MetricType) {
    if (!draft) return;
    const value = Number(draft);
    if (!Number.isFinite(value) || value < 0) return;
    const stored = convertForStorage(value, displayUnit(METRICS[m].unit, system), system);
    onTap();
    batchM.mutate([{ metric: m, value: stored.value }]);
  }

  return (
    <Panel variant="cyan" title="Today">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-mono text-ink-300">
            {completedAm}/{totalAm} AM · {completedPm}/{totalPm} PM
          </div>
          {isSunday && weeklyMetrics.length > 0 && (
            <button
              type="button"
              onClick={() => { onTap(); setWeeklyOpen(true); }}
              className={`${DOPA_TAP_CLASS} text-[10px] font-display tracking-widest neon-text-amber hover:underline`}
            >
              ◇ Weekly checks ({completedWeekly}/{weeklyMetrics.length})
            </button>
          )}
        </div>
        <div className="h-1 bg-bg-700 border border-ink-500/30 overflow-hidden">
          <div
            className={classNames(
              'h-full transition-all duration-500',
              completedDaily === dailyMetrics.length ? 'bg-neon-lime' : 'bg-neon-cyan'
            )}
            style={{ width: `${pct * 100}%`, boxShadow: '0 0 6px currentColor' }}
          />
        </div>
        <div className="space-y-2 pt-1">
          {(['AM', 'PM'] as const).map((cad) => {
            const metrics = (Object.keys(DEFAULT_CADENCE) as MetricType[])
              .filter((m) => DEFAULT_CADENCE[m] === cad);
            const done = metrics.filter((m) => status[m]?.logged).length;
            if (metrics.length === 0) return null;
            return (
              <div key={cad}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-display tracking-widest text-ink-400">
                    {cad}
                  </span>
                  <span className="text-[10px] font-mono text-ink-500">
                    {done}/{metrics.length}
                  </span>
                </div>
                <div className="space-y-1">
                  {metrics.map((m) => {
                    const s = status[m];
                    const meta = METRICS[m];
                    const isEditing = editing === m;
                    const pulsing = pulseAt[m] != null;
                    return (
                      <div
                        key={m}
                        // `dopa-success` triggers the lime pulse
                        // animation; React reapplies the class on
                        // each new timestamp, so re-logging the
                        // same metric replays the celebration.
                        data-pulse={pulseAt[m] ?? undefined}
                        className={classNames(
                          'flex items-center justify-between gap-2 px-2 py-1.5 border rounded transition-colors',
                          s?.logged
                            ? 'border-neon-lime/40 bg-neon-lime/10 text-neon-lime'
                            : 'border-ink-500/30 bg-bg-700/20 hover:border-neon-cyan/60 hover:bg-neon-cyan/5',
                          pulsing && 'dopa-success',
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-mono">
                            {s?.logged && (
                              <span
                                key={pulseAt[m]}
                                className="dopa-check text-neon-lime"
                                aria-hidden
                              >
                                ✓
                              </span>
                            )}
                            <span className={s?.logged ? 'text-neon-lime' : 'text-ink-200'}>
                              {meta.shortLabel}
                            </span>
                          </div>
                          {s?.logged && s.value != null ? (
                            <div className="text-[10px] font-mono text-ink-500 mt-0.5">
                              {s.value.toFixed(meta.unit === 'g' || meta.unit === 'ml' || meta.unit === 'fl oz' || meta.unit === 'kcal' ? 0 : 1)} {displayUnit(meta.unit, system)}
                            </div>
                          ) : null}
                        </div>
                        {isEditing ? (
                          <div className="flex items-center gap-1 dopa-tap">
                            <input
                              autoFocus
                              type="number"
                              step="any"
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') quickLog(m); }}
                              className="w-16 bg-bg-900 border border-neon-cyan/50 px-1.5 py-1 text-xs font-mono rounded"
                            />
                            <button
                              type="button"
                              onClick={() => quickLog(m)}
                              disabled={!draft || batchM.isPending}
                              className="px-2 py-1 text-[10px] font-mono border border-neon-cyan text-neon-cyan hover:bg-neon-cyan/10 rounded disabled:opacity-50"
                            >
                              ✓
                            </button>
                            <button
                              type="button"
                              onClick={() => { setEditing(null); setDraft(''); }}
                              className="px-2 py-1 text-[10px] font-mono border border-ink-500 text-ink-300 rounded"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              onTap();
                              setEditing(m);
                              setDraft(s?.value != null ? String(s.value) : '');
                            }}
                            className={classNames(
                              DOPA_TAP_CLASS,
                              'px-2.5 py-1 text-[11px] font-mono border rounded',
                              s?.logged
                                ? 'border-neon-lime/50 text-neon-lime hover:bg-neon-lime/10'
                                : 'border-neon-cyan/60 text-neon-cyan hover:bg-neon-cyan/10',
                            )}
                            title={s?.logged ? 'Re-log' : `Log ${meta.label}`}
                          >
                            {s?.logged ? '↻' : '+ log'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
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
  )

      {/* Weekly checks modal — only opens on Sundays via the
          amber button in the header. Lists the WEEKLY-cadence
          metrics as buttons; clicking one closes this modal and
          opens the existing QuickLog flow for that metric. */}
      {weeklyOpen && (
        <Modal
          open
          onClose={() => setWeeklyOpen(false)}
          title="Weekly checks"
          width="max-w-md"
        >
          <div className="space-y-2">
            <div className="text-[10px] font-mono text-ink-400">
              Weekly metrics for this week. Tap one to log; this
              counts as your "weekly check" for the cadence.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {weeklyMetrics.map((m) => {
                const s = status[m];
                const meta = METRICS[m];
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      onTap();
                      setEditing(m);
                      setDraft(s?.value != null ? String(s.value) : '');
                      setWeeklyOpen(false);
                    }}
                    className={classNames(
                      DOPA_TAP_CLASS,
                      'px-2.5 py-2 text-left text-xs font-mono border rounded transition-colors',
                      s?.logged
                        ? 'border-neon-lime/40 bg-neon-lime/5 text-neon-lime'
                        : 'border-ink-700/40 text-ink-200 hover:border-neon-cyan/60 hover:text-neon-cyan hover:bg-neon-cyan/5',
                    )}
                  >
                    <div className="font-display tracking-wider">{meta.shortLabel}</div>
                    <div className="text-[9px] font-mono text-ink-500 mt-0.5">
                      {s?.logged ? '✓ logged' : 'tap to log'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Modal>
      )};
}
