import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { NeonButton } from '@/components/NeonButton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { type UnitSystem } from '@/lib/units';
import { classNames } from '@/lib/format';

/**
 * Morning popup modal — Habitica-style.
 *
 * Pops up on the first visit of each day to surface:
 *   - The "recap" of yesterday (workout logged, sleep, weigh-in,
 *     recovery score).
 *   - Unchecked dailies from yesterday with one-tap "mark done"
 *     buttons — marks the row + invalidates the cached count so
 *     the next /today fetch is correct. Doesn't undo any
 *     heart-loss that's already been applied (that ran at 4:30am),
 *     but does prevent the MISSED_ALL_DAILIES trigger from
 *     firing again on the next morning's sweep (idempotent via
 *     the HeartLossEvent unique index).
 *   - Hardcore-mode heart counter animation (count down if losses
 *     fired) + level indicator.
 *   - A small "today" digest: workout-day status + substance-cap
 *     warnings if over any cap.
 *
 * Dismissed state is persisted in localStorage keyed by today's
 * date so the popup auto-shows once per day but doesn't block the
 * user after they've already dealt with it.
 */

type Daily = {
  id: string;
  name: string;
  category: 'USER' | 'WORKOUT' | 'SPIRITUAL';
  days: string[];
  notes: string | null;
  goldReward: number;
  xpReward: number;
  todayDone: boolean;
  prayerType?: string;
};

type PopupPayload = {
  date: string;
  mode: 'CASUAL' | 'HARDCORE';
  level: number;
  xp: number;
  hearts: number;
  dailies: {
    date: string | null;
    today: string;
    userDailies: Daily[];
    builtins: Daily[];
    spiritualDailies: Daily[];
    counts: { total: number; completed: number; isWorkoutDay: boolean };
  };
  recap: {
    workoutLogged: boolean;
    workoutCount: number;
    workoutNames: string[];
    sleepHours: number | null;
    weighInLogged: boolean;
    latestWeightKg: number | null;
    recoveryScore: number | null;
  };
  heartLoss: Array<{
    id: string;
    kind: string;
    details: string | null;
    sourceDate: string;
  }>;
};

const STORAGE_KEY = 'fitquest:morningPopup:';

function todayLocal(): string {
  // Same YYYY-MM-DD-as-user's-local-machine convention the rest of
  // the app uses. The popup shows on first /today visit of this
  // date; the server-side endpoint reads the user's tz to decide
  // what "yesterday" means.
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dismissedToday(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY + todayLocal()) === 'dismissed';
}

function markDismissed() {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY + todayLocal(), 'dismissed');
}

function clearDismissed() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY + todayLocal());
}

function prettyKind(kind: string): string {
  switch (kind) {
    case 'MISSED_WORKOUT':     return 'missed planned workout';
    case 'MISSED_ALL_DAILIES': return 'all dailies missed';
    case 'SUBSTANCE_CAFFEINE': return 'caffeine over cap';
    case 'SUBSTANCE_ALCOHOL':  return 'alcohol over cap';
    case 'SUBSTANCE_NICOTINE': return 'nicotine over cap';
    case 'ZERO_SPIRITUAL':     return 'no spiritual activity';
    default:                  return kind;
  }
}

type Props = {
  /** Force the popup to show. Used by a "Show morning recap" link on Today. */
  forceShow?: boolean;
  /** Called when the user dismisses. Parent can hide the parent trigger. */
  onDismiss?: () => void;
};

export function MorningPopup({ forceShow = false, onDismiss }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const system: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';
  const [open, setOpen] = useState(false);
  const [revealedCount, setRevealedCount] = useState(0);
  const [heartsAnim, setHeartsAnim] = useState<number | null>(null);

  // Auto-open on first visit of the day, unless already dismissed.
  // Reads localStorage eagerly (not via effect) so the first paint
  // doesn't briefly flash the popup then close it.
  useEffect(() => {
    if (forceShow) {
      setOpen(true);
      return;
    }
    if (!dismissedToday()) {
      setOpen(true);
    }
  }, [forceShow]);

  const q = useQuery({
    queryKey: ['dailies', 'morning-popup'],
    queryFn: () => api<PopupPayload>('/dailies/morning-popup'),
    enabled: open,
    staleTime: 60_000,
  });

  // Animate heart counter: count up to the actual value over 1.2s
  // when the payload first lands. The starting value is "5" so the
  // user sees a count-down if they lost hearts, or a no-op hold if
  // they didn't. Skipped on Casual (no hearts penalty visible).
  useEffect(() => {
    if (!q.data) return;
    if (q.data.mode !== 'HARDCORE') return;
    setHeartsAnim(5);
    const start = performance.now();
    const from = 5;
    const to = q.data.hearts;
    const dur = 1200;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(from + (to - from) * eased);
      setHeartsAnim(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [q.data?.date, q.data?.hearts, q.data?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  function dismiss() {
    markDismissed();
    setOpen(false);
    onDismiss?.();
  }

  // Dailies the user has marked done in this popup session. Resets
  // when the popup re-opens (next day's first visit). The visual
  // lock + green tint happen instantly on click so the user gets
  // immediate feedback; the network refetch follows.
  const [locallyCompleted, setLocallyCompleted] = useState<Set<string>>(new Set());
  // Reset the lock set whenever a new popup payload arrives — the
  // server's `todayDone` is now the source of truth, so rows the
  // server already marks done don't need our local override.
  useEffect(() => {
    if (q.data) setLocallyCompleted(new Set());
  }, [q.data?.date]);

  // Mark a single daily done (idempotent on the server side — the
  // POST handler upserts). Refetches the popup payload so the
  // completed counter increments and the row gets the ✓ badge.
  const completeM = useMutation({
    mutationFn: (dailyId: string) =>
      api(`/dailies/${encodeURIComponent(dailyId)}/complete`, { method: 'POST' }),
    onSuccess: (_, dailyId) => {
      // Flip the local lock first so the row turns green + becomes
      // unclickable before the refetch lands. The refetch below
      // eventually replaces the local state when it sees the
      // server-side todayDone=true and excludes the row from the
      // missedDailies list entirely.
      setLocallyCompleted((prev) => {
        const next = new Set(prev);
        next.add(dailyId);
        return next;
      });
      qc.invalidateQueries({ queryKey: ['dailies', 'morning-popup'] });
      qc.invalidateQueries({ queryKey: ['dailies', 'today'] });
      setRevealedCount((c) => c + 1);
    },
  });

  const missedDailies = useMemo(() => {
    if (!q.data) return [] as Daily[];
    const all = [
      ...q.data.dailies.userDailies,
      ...q.data.dailies.builtins,
      ...q.data.dailies.spiritualDailies,
    ];
    return all.filter((d) => !d.todayDone);
  }, [q.data]);

  return (
    <Modal
      open={open}
      onClose={dismiss}
      title={`Morning · ${q.data?.date ?? ''}`}
      width="max-w-lg"
    >
      {q.isLoading && (
        <div className="text-sm text-ink-300 font-mono py-3">⏳ Loading your morning recap…</div>
      )}
      {q.isError && (
        <div className="text-sm text-rose-300 font-mono py-3">
          Couldn't load morning recap. The Today page still works.
        </div>
      )}
      {q.data && (
        <div className="space-y-4">
          {/* Heart counter animation — only relevant for Hardcore.
              For Casual we show the level + XP as a quieter indicator. */}
          <div className="flex items-center justify-between gap-4 border border-ink-700/40 px-3 py-2 bg-bg-900/40">
            <div className="flex items-center gap-2">
              {q.data.mode === 'HARDCORE' ? (
                <>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">Hearts</span>
                  <span
                    className={classNames(
                      'font-display text-2xl tabular-nums transition-colors',
                      (heartsAnim ?? q.data.hearts) < q.data.hearts
                        ? 'text-rose-300'
                        : (heartsAnim ?? q.data.hearts) < 5
                          ? 'text-neon-amber'
                          : 'text-neon-magenta',
                    )}
                  >
                    {heartsAnim ?? q.data.hearts}
                  </span>
                  <span className="text-ink-500 text-xs">/ 5</span>
                </>
              ) : (
                <>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">Casual</span>
                  <span className="text-ink-300 text-xs font-mono">no penalty ladder</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">Level</span>
              <span className="font-display text-2xl text-neon-cyan">{q.data.level}</span>
              <span className="text-ink-500 text-xs">{q.data.xp} XP</span>
            </div>
          </div>

          {/* Heart-loss reasons — only fires if Hardcore-mode losses landed yesterday. */}
          {q.data.mode === 'HARDCORE' && q.data.heartLoss.length > 0 && (
            <div className="border border-rose-500/30 bg-rose-500/5 px-3 py-2">
              <div className="text-[10px] font-mono uppercase tracking-widest text-rose-300 mb-1">
                Yesterday's heart loss
              </div>
              <ul className="space-y-0.5 text-[11px] font-mono text-ink-300">
                {q.data.heartLoss.map((h) => (
                  <li key={h.id}>
                    − ♥ <span className="text-ink-400">{prettyKind(h.kind)}</span>
                    {h.details && <> · <span className="text-ink-500 italic">{h.details}</span></>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Yesterday recap */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1">
              Yesterday
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <RecapCell label="Workout" ok={q.data.recap.workoutLogged}
                detail={q.data.recap.workoutLogged
                  ? `${q.data.recap.workoutCount} (${q.data.recap.workoutNames.slice(0, 2).join(', ')})`
                  : 'no session logged'} />
              <RecapCell label="Sleep" ok={q.data.recap.sleepHours != null && q.data.recap.sleepHours >= 7}
                detail={q.data.recap.sleepHours != null ? `${q.data.recap.sleepHours.toFixed(1)} h` : 'not logged'} />
              <RecapCell label="Weigh-in" ok={q.data.recap.weighInLogged}
                detail={q.data.recap.weighInLogged
                  ? 'logged'
                  : q.data.recap.latestWeightKg != null
                    ? `last ${(system === 'IMPERIAL'
                        ? (q.data.recap.latestWeightKg * 2.20462).toFixed(1) + ' lb'
                        : q.data.recap.latestWeightKg.toFixed(1) + ' kg')}`
                    : 'none'} />
              <RecapCell label="Recovery" ok={q.data.recap.recoveryScore != null && q.data.recap.recoveryScore >= 60}
                detail={q.data.recap.recoveryScore != null ? `${q.data.recap.recoveryScore}/100` : 'n/a'} />
            </div>
          </div>

          {/* Missed dailies — one-tap recovery so the missed-all-dailies
              trigger doesn't refire on the next morning sweep. */}
          {missedDailies.length > 0 && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1 flex items-center justify-between">
                <span>Missed dailies ({missedDailies.length})</span>
                <span className="text-ink-500 normal-case">tap to recover</span>
              </div>
              <div className="space-y-1 max-h-44 overflow-y-auto border border-ink-700/30 p-1.5 bg-bg-900/40">
                {missedDailies.map((d) => {
                  const pending = completeM.isPending && completeM.variables === d.id;
                  // The local lock flips instantly on click so the row
                  // turns green + becomes unclickable before the
                  // network refetch lands. Server's todayDone is the
                  // source of truth on the next payload fetch.
                  const done = locallyCompleted.has(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => completeM.mutate(d.id)}
                      disabled={pending || done}
                      className={classNames(
                        'w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] font-mono border transition-all',
                        done
                          ? 'border-neon-lime/60 bg-neon-lime/10 text-neon-lime cursor-default'
                          : pending
                            ? 'border-neon-cyan/60 text-neon-cyan bg-neon-cyan/5'
                            : 'border-ink-700/30 text-ink-200 hover:border-neon-cyan/40 hover:bg-neon-cyan/5',
                      )}
                    >
                      <span className={classNames(
                        'shrink-0',
                        done ? 'text-neon-lime' : 'text-ink-400',
                      )}>
                        {pending ? '…' : done ? '✓' : '○'}
                      </span>
                      <span className={classNames(
                        'flex-1 truncate',
                        done && 'line-through text-ink-500',
                      )}>
                        {d.name}
                      </span>
                      <span className="text-[9px] text-ink-500 shrink-0">
                        {done ? 'done' : `+${d.xpReward}xp`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recovery acknowledgements — show even when nothing is missed,
              so the popup feels useful and not just nag-y. */}
          {(revealedCount > 0 || missedDailies.length === 0) && (
            <div className="text-[10px] font-mono text-neon-lime">
              ✓ {revealedCount > 0
                ? `recovered ${revealedCount} daily${revealedCount > 1 ? 'ies' : ''}`
                : 'nothing to recover — nice streak'}
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-ink-700/30">
            <button
              type="button"
              onClick={() => {
                clearDismissed();
                qc.invalidateQueries({ queryKey: ['dailies', 'morning-popup'] });
              }}
              className="text-[10px] font-mono text-ink-400 hover:text-violet-300"
              title="Re-show the popup and re-fetch"
            >
              ↻ Re-check
            </button>
            <NeonButton onClick={dismiss} variant="cyan" size="sm">
              Start your day →
            </NeonButton>
          </div>
        </div>
      )}
    </Modal>
  );
}

function RecapCell({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className={classNames(
      'border px-2 py-1.5',
      ok ? 'border-neon-lime/40 bg-neon-lime/5' : 'border-ink-700/40 bg-bg-900/40',
    )}>
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-ink-400">
        <span className={ok ? 'text-neon-lime' : 'text-rose-300'}>{ok ? '✓' : '○'}</span>
        {label}
      </div>
      <div className="text-ink-100 mt-0.5">{detail}</div>
    </div>
  );
}