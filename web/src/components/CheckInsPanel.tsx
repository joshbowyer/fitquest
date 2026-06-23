import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { classNames } from '@/lib/format';
import { Modal } from './Modal';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { useAuth } from '@/lib/auth';
import { METRICS } from '@/lib/types';
import {
  CADENCE_VARIANT,
  CADENCE_LABEL,
  CADENCE_SHORT,
  CADENCE_GLYPH,
  CADENCES,
  isWithinWindow,
  type Cadence,
  type CheckInsDueResponse,
  type DueMetricDto,
} from '@/lib/checkIns';

/**
 * Dashboard check-in panel. Shows up to 3 cadence cards (AM/PM/WEEKLY)
 * whichever have overdue metrics. Each card has inline quick-log
 * buttons for its due metrics; tapping one opens the QuickLogModal
 * which POSTs to /measurements and invalidates the relevant queries.
 *
 * PM card hides itself before 17:00 local — the user shouldn't see
 * "evening check-in" at 9am. WEEKLY card is always visible (no
 * time-of-day gate).
 */
export function CheckInsPanel() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? null;
  const qc = useQueryClient();
  const [logMetric, setLogMetric] = useState<DueMetricDto | null>(null);

  const dueQ = useQuery({
    queryKey: ['check-ins', 'due'],
    queryFn: () => api<CheckInsDueResponse>('/check-ins/due'),
    refetchOnWindowFocus: true,
  });

  const now = useMemo(() => new Date(), [/* re-evaluate on each render — clock matters */]);

  // Decide which cadence cards to show. Hide PM if outside its window
  // AND the PM group is empty (don't show an empty card just because
  // it's the wrong time).
  const visibleCadences = useMemo<Cadence[]>(() => {
    return CADENCES.filter((c) => {
      if (!dueQ.data) return false;
      const group = dueQ.data.byCadence[c] ?? [];
      if (group.length === 0) return false;
      if (!isWithinWindow(c, now, timezone)) {
        // Outside window but there are overdue items — still show
        // them so the user can clear backlog. The "in window" state
        // will simply render with a dimmed style + a hint.
      }
      return true;
    });
  }, [dueQ.data, now, timezone]);

  // Nothing to do — render a quiet "all caught up" pill instead of
  // an empty section.
  if (dueQ.isLoading) {
    return (
      <div className="text-[10px] font-mono text-ink-400 px-1 py-2">
        Loading check-ins…
      </div>
    );
  }

  if (visibleCadences.length === 0) {
    return (
      <div className="border border-neon-lime/30 bg-neon-lime/5 rounded p-3 text-center">
        <div className="text-neon-lime font-display tracking-widest text-xs uppercase mb-0.5">
          ✓ All caught up
        </div>
        <div className="text-[10px] font-mono text-ink-400">
          No measurements due right now.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visibleCadences.map((cadence) => (
          <CadenceCard
            key={cadence}
            cadence={cadence}
            items={dueQ.data!.byCadence[cadence]}
            inWindow={isWithinWindow(cadence, now, timezone)}
            onQuickLog={(m) => setLogMetric(m)}
          />
        ))}
      </div>
      <QuickLogModal
        open={logMetric !== null}
        item={logMetric}
        onClose={() => {
          setLogMetric(null);
          qc.invalidateQueries({ queryKey: ['check-ins', 'due'] });
          qc.invalidateQueries({ queryKey: ['measurements'] });
          qc.invalidateQueries({ queryKey: ['measurements', 'latest'] });
        }}
      />
    </div>
  );
}

function CadenceCard({
  cadence,
  items,
  inWindow,
  onQuickLog,
}: {
  cadence: Cadence;
  items: DueMetricDto[];
  inWindow: boolean;
  onQuickLog: (m: DueMetricDto) => void;
}) {
  const variant = CADENCE_VARIANT[cadence];
  const glyph = CADENCE_GLYPH[cadence];
  return (
    <div
      className={classNames(
        'border rounded p-3',
        `border-neon-${variant}/30 bg-neon-${variant}/5`,
        !inWindow && 'opacity-75',
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-neon-${variant} text-base`}>{glyph}</span>
          <span
            className={`font-display tracking-widest text-[10px] uppercase text-neon-${variant}`}
          >
            {CADENCE_SHORT[cadence]}
          </span>
        </div>
        <span className="text-[10px] font-mono text-ink-400">
          {items.length} due
        </span>
      </div>
      {!inWindow && (
        <div className="text-[10px] font-mono text-ink-500 mb-2 italic">
          Outside {CADENCE_SHORT[cadence].toLowerCase()} window — log anytime.
        </div>
      )}
      <ul className="space-y-1">
        {items.slice(0, 5).map((item) => (
          <CheckInRow key={item.metric} item={item} onClick={() => onQuickLog(item)} />
        ))}
        {items.length > 5 && (
          <li className="text-[10px] font-mono text-ink-400 italic">
            +{items.length - 5} more on the check-ins page
          </li>
        )}
      </ul>
    </div>
  );
}

function CheckInRow({
  item,
  onClick,
}: {
  item: DueMetricDto;
  onClick: () => void;
}) {
  const meta = METRICS[item.metric];
  const lastLabel = item.isNeverLogged
    ? 'never logged'
    : item.overdueByDays === 0
      ? 'logged today'
      : `${item.overdueByDays}d ago`;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center justify-between gap-2 text-left text-[11px] font-mono py-1 px-1.5 hover:bg-bg-700/40 rounded transition-colors"
        title={`Quick-log ${meta.label}`}
      >
        <span className="text-slate-200 truncate flex-1">{meta.shortLabel}</span>
        <span
          className={classNames(
            'text-[10px] shrink-0',
            item.isNeverLogged ? 'text-neon-amber' : 'text-ink-400',
          )}
        >
          {lastLabel}
        </span>
        <span className="text-neon-cyan text-[10px] shrink-0">+</span>
      </button>
    </li>
  );
}

export function QuickLogModal({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: DueMetricDto | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const meta = item ? METRICS[item.metric] : null;
  const isScale = meta && (meta.unit === 'kg' || meta.unit === 'cm' || meta.unit === 'bpm' || meta.unit === 'ml/kg/min');
  const isScore = meta && meta.unit === '/10';
  const isSeconds = meta && meta.unit === 's';
  const isReps = meta && meta.unit === 'reps';
  const unitLabel = meta ? (meta.unit || '') : '';

  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // Reset whenever a new metric is opened.
  useEffect(() => {
    setValue('');
    setNotes('');
    setErr(null);
  }, [item?.metric]);

  const logM = useDelayedMutation<{ id: string }, { metric: string; value: number; unit?: string; notes?: string }>(
    {
      mutationFn: (body) =>
        api<{ id: string }>('/measurements', { method: 'POST', body }),
      onError: (e) => setErr(e instanceof ApiError ? e.message : 'Log failed'),
      onSuccess: () => onClose(),
    },
    600,
  );

  if (!item || !meta) return null;
  // Local non-null aliases so nested closures (renderInput, submit)
  // don't need to re-narrow through `meta` — TS loses narrowing
  // across function boundaries in some positions.
  const activeItem = item;
  const activeMeta = meta;

  function submit(v: number) {
    setErr(null);
    logM.run({
      metric: activeItem.metric,
      value: v,
      unit: activeMeta.unit || undefined,
      notes: notes.trim() || undefined,
    });
  }

  const parsed = Number(value);
  const valid = Number.isFinite(parsed) && parsed > 0;

  // Build smart input affordance based on metric type.
  function renderInput() {
    if (isScore) {
      // 1-10 scale: render 10 quick-buttons + free input.
      return (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1.5">
            Score (1–10)
          </div>
          <div className="grid grid-cols-10 gap-1 mb-2">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => submit(n)}
                disabled={logM.isPending}
                className={classNames(
                  'h-9 text-sm font-mono border transition-colors',
                  'border-ink-500/40 text-ink-200 hover:border-neon-cyan hover:text-neon-cyan hover:bg-neon-cyan/10',
                  logM.isPending && 'opacity-50 cursor-not-allowed',
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (isSeconds) {
      return (
        <SecondsInput
          onSubmit={(s) => submit(s)}
          disabled={logM.isPending}
        />
      );
    }
    return (
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-400 block mb-1">
            Value
          </label>
          <input
            type="number"
            step={isScale ? 0.1 : 1}
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid) submit(parsed);
            }}
            autoFocus
            className="w-full bg-bg-900 border border-ink-500/40 rounded px-2 py-1.5 text-sm font-mono"
            placeholder={String(activeMeta.defaultMin)}
          />
        </div>
        {unitLabel && (
          <span className="text-ink-400 text-sm font-mono pb-1.5">
            {user?.units === 'IMPERIAL' && unitLabel === 'kg' ? 'lb' :
             user?.units === 'IMPERIAL' && unitLabel === 'cm' ? 'in' : unitLabel}
          </span>
        )}
        <button
          type="button"
          onClick={() => valid && submit(parsed)}
          disabled={!valid || logM.isPending}
          className={classNames(
            'px-3 py-1.5 text-sm border rounded',
            valid && !logM.isPending
              ? 'border-neon-cyan text-neon-cyan hover:bg-neon-cyan/10'
              : 'border-ink-500/40 text-ink-500 cursor-not-allowed',
          )}
        >
          Log
        </button>
      </div>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={`Log ${activeMeta.label}`} width="max-w-md">
      <div className="text-[10px] font-mono text-ink-400 mb-3">
        {CADENCE_LABEL[activeItem.cadence]}
        {activeItem.lastLoggedAt && (
          <> · last logged {new Date(activeItem.lastLoggedAt).toLocaleString([], {
            weekday: 'short', hour: 'numeric', minute: '2-digit',
          })}</>
        )}
      </div>
      {renderInput()}
      <div className="mt-3">
        <label className="text-[10px] font-mono uppercase tracking-widest text-ink-400 block mb-1">
          Notes (optional)
        </label>
        <input
          type="text"
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. post-shower, fasting"
          className="w-full bg-bg-900 border border-ink-500/40 rounded px-2 py-1.5 text-xs font-mono"
        />
      </div>
      {err && (
        <div className="mt-3 text-[10px] text-rose-300 font-mono">{err}</div>
      )}
    </Modal>
  );
}

function SecondsInput({ onSubmit, disabled }: { onSubmit: (seconds: number) => void; disabled?: boolean }) {
  const [mins, setMins] = useState('');
  const [secs, setSecs] = useState('');
  const m = Number(mins) || 0;
  const s = Number(secs) || 0;
  const total = m * 60 + s;
  const valid = total > 0;
  return (
    <div>
      <label className="text-[10px] font-mono uppercase tracking-widest text-ink-400 block mb-1">
        Time (mm:ss)
      </label>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <input
            type="number"
            min={0}
            value={mins}
            onChange={(e) => setMins(e.target.value)}
            placeholder="0"
            className="w-full bg-bg-900 border border-ink-500/40 rounded px-2 py-1.5 text-sm font-mono"
          />
          <div className="text-[10px] text-ink-400 mt-0.5 text-center">min</div>
        </div>
        <span className="text-ink-500 pb-2">:</span>
        <div className="flex-1">
          <input
            type="number"
            min={0}
            max={59}
            value={secs}
            onChange={(e) => setSecs(e.target.value)}
            placeholder="0"
            className="w-full bg-bg-900 border border-ink-500/40 rounded px-2 py-1.5 text-sm font-mono"
          />
          <div className="text-[10px] text-ink-400 mt-0.5 text-center">sec</div>
        </div>
        <button
          type="button"
          onClick={() => onSubmit(total)}
          disabled={!valid || disabled}
          className={classNames(
            'px-3 py-1.5 text-sm border rounded',
            valid && !disabled
              ? 'border-neon-cyan text-neon-cyan hover:bg-neon-cyan/10'
              : 'border-ink-500/40 text-ink-500 cursor-not-allowed',
          )}
        >
          Log
        </button>
      </div>
    </div>
  );
}

/** useMemo-based reset. Re-runs whenever the dependency changes. */
// (removed — use useEffect directly)