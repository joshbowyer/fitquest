import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { classNames } from '@/lib/format';
import { Modal } from './Modal';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { useDopamineTap, DOPA_TAP_CLASS } from '@/hooks/useDopamineTap';
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
import { convertForStorage, displayUnit } from '@/lib/units';

/**
 * Check-in cadence panel — used on Dashboard (grid layout) and the
 * /today page (stack layout). Each cadence (AM / PM / WEEKLY) renders
 * as its own card with up to 5 inline quick-log rows; tapping one
 * opens QuickLogModal which POSTs to /measurements and invalidates
 * the relevant queries.
 *
 * The PM card dims if it's outside the 17:00–24:00 local window so
 * the user isn't nagged to log "evening" at 9am. WEEKLY has no
 * time-of-day gate.
 */
export function CheckInsPanel({ layout = 'grid' }: { layout?: 'grid' | 'stack' } = {}) {
  const { user } = useAuth();
  const timezone = user?.timezone ?? null;
  const qc = useQueryClient();
  const [logMetric, setLogMetric] = useState<DueMetricDto | null>(null);
  const { onTap } = useDopamineTap();

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
      <div className="border border-neon-lime/30 bg-neon-lime/5 rounded p-3 text-center dopa-success">
        <div className="text-neon-lime font-display tracking-widest text-xs uppercase mb-0.5">
          ✓ All caught up
        </div>
        <div className="text-[10px] font-mono text-ink-400">
          No measurements due right now.
        </div>
      </div>
    );
  }

  const gridClass =
    layout === 'stack'
      ? 'space-y-3'
      : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3';

  return (
    <div className="space-y-3">
      <div className={gridClass}>
        {visibleCadences.map((cadence) => (
          <CadenceCard
            key={cadence}
            cadence={cadence}
            items={dueQ.data!.byCadence[cadence]}
            inWindow={isWithinWindow(cadence, now, timezone)}
            onQuickLog={(m) => { onTap(); setLogMetric(m); }}
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
  const overflow = items.length > 5 ? items.length - 5 : 0;
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
      <ul className="space-y-1.5">
        {items.slice(0, 5).map((item) => (
          <CheckInRow key={item.metric} item={item} onClick={() => onQuickLog(item)} />
        ))}
      </ul>
      {/* One consistent CTA at the bottom — takes the user to the
          full /check-ins page if there are overflow items OR if they
          just want to browse / re-log earlier entries. Replaces the
          old "+N more on the check-ins page" inline hint which only
          showed on overflow and was easy to miss. */}
      <div className="mt-2 pt-2 border-t border-current/10">
        <Link
          to="/check-ins"
          className={classNames(
            DOPA_TAP_CLASS,
            'flex items-center justify-between text-[10px] font-display tracking-widest uppercase',
            `text-neon-${variant} hover:underline`,
          )}
        >
          <span>
            {overflow > 0
              ? `+${overflow} more`
              : `All ${CADENCE_SHORT[cadence].toLowerCase()} check-ins`}
          </span>
          <span aria-hidden>→</span>
        </Link>
      </div>
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
  const overdue = item.isNeverLogged || (item.overdueByDays ?? 0) > 0;
  // Bigger, color-coded pill: amber for overdue, cyan for "due now",
  // lime for already logged today. Each gets a press-scale animation
  // via the shared dopa-tap class.
  const stateClass = !overdue
    ? 'border-neon-lime/50 bg-neon-lime/10 text-neon-lime hover:bg-neon-lime/15'
    : item.isNeverLogged
      ? 'border-neon-amber/60 bg-neon-amber/10 text-neon-amber hover:bg-neon-amber/20'
      : 'border-neon-cyan/60 bg-neon-cyan/5 text-neon-cyan hover:bg-neon-cyan/15';
  const statusGlyph = !overdue ? '✓' : '+';
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={classNames(
          DOPA_TAP_CLASS,
          'w-full flex items-center justify-between gap-2 text-left text-[11px] font-mono py-1.5 px-2 border rounded transition-colors',
          stateClass,
        )}
        title={`Quick-log ${meta.label}`}
      >
        <span className="truncate flex-1 font-display tracking-wider">{meta.shortLabel}</span>
        <span className="text-[10px] shrink-0 opacity-75">{lastLabel}</span>
        <span
          aria-label="Quick log"
          className="shrink-0 inline-flex items-center justify-center w-6 h-6 border border-current/60 rounded text-sm leading-none font-bold"
        >
          {statusGlyph}
        </span>
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
  const [saved, setSaved] = useState(false);
  const { onTap, onSuccess: hapticSuccess, onError: hapticError } = useDopamineTap();

  // Reset whenever a new metric is opened.
  useEffect(() => {
    setValue('');
    setNotes('');
    setErr(null);
    setSaved(false);
  }, [item?.metric]);

  const logM = useDelayedMutation<{ id: string }, { metric: string; value: number; unit?: string; notes?: string }>(
    {
      mutationFn: (body) =>
        api<{ id: string }>('/measurements', { method: 'POST', body }),
      onError: (e) => { hapticError(); setErr(e instanceof ApiError ? e.message : 'Log failed'); },
      onSuccess: () => {
        hapticSuccess();
        setSaved(true);
        // Brief visible-flash before the modal closes so the user
        // sees the reward land even if they're not looking at the
        // underlying dashboard tile.
        setTimeout(onClose, 480);
      },
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
    onTap();
    // Convert from the user's display unit back to the storage
    // unit. Without this, entering 135.4 in imperial mode
    // (the label says 'lb') would store 135.4 kg, then display
    // it later as 298.5 lb — a 2.205× drift. Same shape for
    // cm/in and ml/fl oz.
    const system = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';
    const displayU = displayUnit(activeMeta.unit || '', system);
    const { value: storedValue, unit: storedUnit } =
      convertForStorage(v, displayU, system);
    logM.run({
      metric: activeItem.metric,
      value: storedValue,
      unit: storedUnit || undefined,
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
                  DOPA_TAP_CLASS,
                  'h-10 text-sm font-mono border rounded transition-colors',
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
            {displayUnit(
              unitLabel,
              user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC',
            )}
          </span>
        )}
        <button
          type="button"
          onClick={() => valid && submit(parsed)}
          disabled={!valid || logM.isPending}
          className={classNames(
            DOPA_TAP_CLASS,
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
    <Modal open={open} onClose={onClose} title={`Log ${activeMeta.label}`} width="max-w-md" hideCloseButton>
      {saved ? (
        // Brief reward screen — 1 large ✓ + label, then the modal
        // closes itself after 480ms (see onSuccess). The pulse +
        // check pop deliver the dopamine hit before the panel swaps.
        <div
          key="saved"
          className="dopa-success flex flex-col items-center justify-center py-8 text-neon-lime"
        >
          <span
            className="dopa-check text-5xl leading-none"
            aria-hidden
          >
            ✓
          </span>
          <div className="mt-3 font-display tracking-widest uppercase text-sm">
            {activeMeta.label} logged
          </div>
        </div>
      ) : (
        <>
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
        </>
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
            DOPA_TAP_CLASS,
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