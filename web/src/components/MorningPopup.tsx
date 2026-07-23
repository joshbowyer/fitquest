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
 * Pops up on the first user interaction of each day, on any page,
 * to surface:
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
 * Auto-open rules:
 *   - Fires on page load: a 900ms setTimeout after mount, so it
 *     shows up shortly after the app finishes its first paint
 *     instead of ambushing the user's next click/tap. Previously
 *     this waited for the first pointerdown/keydown anywhere in
 *     the app, which meant it could fire on whatever the user
 *     happened to be tapping next (e.g. the sidebar or a mobile
 *     nav item) — confusing, and made the popup feel like it was
 *     "stealing" that tap.
 *   - Also re-fires on `visibilitychange` (document.visibilityState
 *     === 'visible') with the same delay, so a user who leaves the
 *     app open across midnight and later brings it back to the
 *     foreground still gets the popup without needing a fresh page
 *     load.
 *   - Skipped entirely if the popup has been dismissed for today
 *     (checked via localStorage for the no-network case; the
 *     server's `dismissed` field on the payload is the source of
 *     truth and wins on the next fetch).
 *
 * Dismissed state is persisted in two places:
 *   - localStorage: `fitquest:morningPopup:YYYY-MM-DD` →
 *     'dismissed' (fast cache so the modal's "should I open?"
 *     decision is instant on subsequent visits in the same tab /
 *     browser).
 *   - Server: POST /dailies/morning-popup/dismiss records a row
 *     keyed on (userId, today-in-user-tz) so a dismissal on one
 *     device (e.g. the Android Capacitor app) carries over to
 *     every other device (web desktop, etc.) the user opens the
 *     app on that day. The Android app and the web browser have
 *     separate localStorage areas, so without the server-side
 *     flag the popup would re-open on the other device.
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
  /**
   * True iff a MorningPopupDismissal row exists for today in the
   * user's tz. The component closes itself if the server says the
   * popup was already dismissed — this is the cross-device fix
   * for the "dismissed on mobile, popped up again on desktop" bug
   * (the localStorage flag is browser-scoped, so it couldn't
   * carry between the Android app and the web browser).
   * Optional for backwards compat with the pre-migration payload
   * shape; treated as `undefined → false` when missing.
   */
  dismissed?: boolean;
};

const STORAGE_KEY = 'fitquest:morningPopup:';

function todayLocal(): string {
  // Same YYYY-MM-DD-as-user's-local-machine convention the rest of
  // the app uses. The popup shows on first interaction of this
  // date; the server-side endpoint reads the user's tz to decide
  // what "yesterday" means + to key the dismissal row.
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dismissedTodayLocal(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY + todayLocal()) === 'dismissed';
}

function markDismissedLocal() {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY + todayLocal(), 'dismissed');
}

function clearDismissedLocal() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY + todayLocal());
}

// Garbage-collect old per-day keys so the user's localStorage
// doesn't grow unboundedly (one key per day they used the app).
// Called on mount; cheap because it's a single localStorage
// pass. Skipped on the server (typeof window === 'undefined').
function cleanupOldDismissedKeys() {
  if (typeof window === 'undefined') return;
  const today = todayLocal();
  const prefix = STORAGE_KEY;
  for (let i = window.localStorage.length - 1; i >= 0; i--) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(prefix) && k !== prefix + today) {
      window.localStorage.removeItem(k);
    }
  }
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

  // Auto-open on page load, after a brief settle delay — not on
  // the user's first click/tap. Show it unless it's been dismissed
  // (locally OR server-side). The localStorage check is the fast
  // path so we skip scheduling the popup at all when we already
  // know today's dismissed. The server's `dismissed` field (read
  // from the payload below) is the source of truth — the
  // post-fetch effect below closes the modal if the server says
  // "dismissed=true" even when localStorage says nothing.
  useEffect(() => {
    cleanupOldDismissedKeys();

    if (forceShow) {
      setOpen(true);
      return;
    }
    if (dismissedTodayLocal()) return;

    let triggered = false;
    const openNow = () => {
      if (triggered) return;
      triggered = true;
      if (dismissedTodayLocal()) return;
      setOpen(true);
    };

    // Mount path: shows shortly after first paint so it doesn't
    // land over a half-loaded view.
    const mountTimer = window.setTimeout(openNow, 900);

    // visibilitychange path: re-arms the same trigger when the app
    // comes back to the foreground (mobile wake-up / tab left open
    // across midnight), with the same settle delay.
    let visTimer: number | undefined;
    const visTrigger = () => {
      if (document.visibilityState === 'visible') {
        visTimer = window.setTimeout(openNow, 900);
      }
    };
    document.addEventListener('visibilitychange', visTrigger);

    return () => {
      window.clearTimeout(mountTimer);
      if (visTimer !== undefined) window.clearTimeout(visTimer);
      document.removeEventListener('visibilitychange', visTrigger);
    };
  }, [forceShow]);

  const q = useQuery({
    queryKey: ['dailies', 'morning-popup'],
    queryFn: () => api<PopupPayload>('/dailies/morning-popup'),
    enabled: open,
    staleTime: 60_000,
  });

  // Server-side dismissal check: if the popup is open AND the
  // server says the user already dismissed it (e.g. they
  // dismissed on the Android app, then opened the web browser
  // and interacted), close it. This is the cross-device fix.
  useEffect(() => {
    if (!q.data) return;
    if (q.data.dismissed && open) {
      // Mirror the server state into localStorage so subsequent
      // first-paint checks in the same browser can skip the
      // pointerdown/keydown listener setup entirely.
      markDismissedLocal();
      setOpen(false);
    }
  }, [q.data?.dismissed, q.data?.date, open]);

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

  // POST the dismissal to the server (fire-and-forget) so the
  // state syncs to other devices the user might be logged in on
  // (e.g. Android app + web desktop). localStorage is the
  // immediate cache; the server is the source of truth.
  const dismissServerM = useMutation({
    mutationFn: () => api('/dailies/morning-popup/dismiss', { method: 'POST' }),
  });

  function dismiss() {
    markDismissedLocal();
    setOpen(false);
    onDismiss?.();
    // Fire-and-forget: a server failure here just means the
    // dismissal didn't sync to other devices today. The
    // localStorage flag is still set so THIS device won't re-open
    // it. Errors are logged inside the api() helper.
    dismissServerM.mutate();
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
      api(`/dailies/${encodeURIComponent(dailyId)}/complete`, {
        method: 'POST',
        body: { date: q.data?.date },
      }),
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
      disableBackdropClose
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
                clearDismissedLocal();
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