import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { Modal } from '@/components/Modal';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { DIFFICULTY_TIERS, tierForRewards, type DifficultyTier } from '@/lib/difficultyTiers';
import { classNames } from '@/lib/format';
import { TodayActions, OPEN_ACTIVITY_EVENT } from '@/components/TodayActions';
import { CheckInsPanel } from '@/components/CheckInsPanel';
import { RecoveryPracticesPanel } from '@/components/RecoveryPracticesPanel';
import { PainCard } from '@/components/PainCard';
import { type UnitSystem } from '@/lib/units';
import { useLiveClock } from '@/hooks/useLiveClock';

// /today — Dailies view (Habitica-style):
// - Built-in WORKOUT (auto-completes when a workout is logged today; flips on schedule)
// - Built-in SPIRITUAL (prayers the user committed to daily via /spiritual config)
// - User-defined dailies (recurring tasks with per-day schedule)
//
// Sleep/wellness quick-check has moved to /recovery (its own page). For
// the bare-bones "did I sleep / mood / etc" logging without leaving the
// dailies page, use the small "Quick log" entry points here.

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

type TodayResponse = {
  today: string;
  userDailies: Daily[];
  builtins: Daily[];
  spiritualDailies: Daily[];
  counts: {
    total: number;
    completed: number;
    isWorkoutDay: boolean;
  };
};

const PRAYER_LABELS: Record<string, string> = {
  ROSARY: 'Rosary',
  MASS: 'Mass',
  SCRIPTURE: 'Scripture Reading',
  CONTEMPLATION: 'Contemplation',
  LITURGY_HOURS: 'Liturgy of the Hours',
  CONFESSION: 'Confession',
  OTHER: 'Other Prayer',
};

export function TodayPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // Wall mode = full-screen checklist view, no app chrome
  // (header, sidebar, bottom-nav all hidden). Activate by adding
  // ?wall=1 to the URL; exit by clicking the ✕ in the top-right
  // or pressing Escape. The checklist data + actions are identical
  // — wall mode just strips the surrounding app so the user can
  // focus on ticking the boxes.
  const wallMode = searchParams.get('wall') === '1';
  useEffect(() => {
    if (!wallMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        exitWallMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallMode]);
  function exitWallMode() {
    // Drop ?wall=1 but keep other query params intact.
    const next = new URLSearchParams(searchParams);
    next.delete('wall');
    setSearchParams(next, { replace: true });
  }
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Daily | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['dailies', 'today'],
    queryFn: () => api<TodayResponse>('/dailies/today'),
    refetchInterval: 60_000,
  });

  const completeM = useDelayedMutation<{ goldDelta: number; xpDelta: number }, string>({
    mutationFn: (id) => api(`/dailies/${encodeURIComponent(id)}/complete`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dailies'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      setPendingId(null);
    },
  }, 350);

  const [pendingId, setPendingId] = useState<string | null>(null);

  const deleteM = useDelayedMutation<{ ok: boolean }, string>({
    mutationFn: (id) => api(`/dailies/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dailies'] }),
  }, 400);

  const { counts } = data ?? { counts: { total: 0, completed: 0, isWorkoutDay: false } };
  const isWorkoutDay = counts.isWorkoutDay;

  // Programmatic opener for the Activity modal so the WORKOUT daily
  // tile (and the wall-mode version, etc.) can trigger the same
  // modal the Activity tile uses, instead of duplicating the modal
  // state. TodayActionsWrapper owns the openModal state internally;
  // we just dispatch a custom event the wrapper listens for.
  function openActivityFromDaily() {
    window.dispatchEvent(new CustomEvent(OPEN_ACTIVITY_EVENT));
  }

  const body = (
    <>
      {/* Workout day banner */}
      {data && (
        <div className={classNames(
          'mb-4 border p-3 text-xs font-mono flex items-center justify-between',
          isWorkoutDay
            ? 'border-neon-magenta/60 bg-neon-magenta/5'
            : 'border-ink-700/40 bg-bg-700/40',
        )}>
          <div>
            <span className={isWorkoutDay ? 'neon-text-magenta' : 'text-ink-300'}>
              {isWorkoutDay ? '⚔ Today is a workout day' : '☕ Rest day'}
            </span>
            <span className="text-ink-400 ml-2">
              — configure your weekly schedule in <Link to="/routine" className="neon-text-cyan hover:underline">Routine</Link>.
            </span>
          </div>
        </div>
      )}

      {/* One-stop-shop quick-action grid. Small rectangular tiles,
          each opens its own log modal. The Activity modal also
          opens when the WORKOUT daily below dispatches the
          OPEN_ACTIVITY_EVENT (handled by TodayActions internally). */}
      <div className="mb-6">
        <TodayActions />
      </div>

      {isLoading ? (
        <Panel><div className="text-[10px] font-mono text-ink-300">loading…</div></Panel>
      ) : (
        <>
          {/* Two-column layout: dailies on the left, habits on the
              right. Both columns stack on mobile. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Dailies column — built-ins + spiritual + user-defined */}
            <div>
              {/* Built-in WORKOUT daily — clicks open the Activity modal
                  from TodayActions instead of marking the daily complete.
                  The "complete" path is still exposed as a small ✓ button
                  for users who want to mark the daily without logging
                  an actual workout. */}
              {data && data.builtins.length > 0 && (
                <div className="mb-4">
                  <SectionHeader label="Built-in" count={data.builtins.length} />
                  <div className="space-y-2">
                    {data.builtins.map((d) => (
                      <DailyRow
                        key={d.id}
                        daily={d}
                        onToggle={() => {
                          if (d.category === 'WORKOUT' && !d.todayDone) {
                            openActivityFromDaily();
                            return;
                          }
                          setPendingId(d.id);
                          completeM.run(d.id);
                        }}
                        isPending={completeM.isPending}
                        pendingId={pendingId}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Built-in SPIRITUAL dailies */}
              {data && data.spiritualDailies.length > 0 && (
                <div className="mb-4">
                  <SectionHeader label="Spiritual" count={data.spiritualDailies.length} accent="#cba6ff" />
                  <div className="space-y-2">
                    {data.spiritualDailies.map((d) => (
                      <DailyRow
                        key={d.id}
                        daily={d}
                        isPending={completeM.isPending}
                        onToggle={() => {
                          setPendingId(d.id);
                          completeM.run(d.id);
                        }}
                        pendingId={pendingId}
                      />
                    ))}
                  </div>
                  <div className="text-[10px] font-mono text-ink-400 italic mt-2">
                    Configure which prayers are daily obligations in <Link to="/spiritual" className="neon-text-cyan hover:underline">Spiritual →</Link>.
                  </div>
                </div>
              )}

              {/* User-defined dailies */}
              {data && data.userDailies.length > 0 && (
                <div className="mb-4">
                  <SectionHeader label="Your dailies" count={data.userDailies.length} accent="#9bff5c" />
                  <div className="space-y-2">
                    {data.userDailies.map((d) => (
                      <DailyRow
                        key={d.id}
                        daily={d}
                        onToggle={() => {
                          setPendingId(d.id);
                          completeM.run(d.id);
                        }}
                        onEdit={() => setEditing(d)}
                        onArchive={() => deleteM.run(d.id)}
                        isPending={completeM.isPending}
                        pendingId={pendingId}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state — only when no dailies at all */}
              {data && counts.total === 0 && (
                <Panel>
                  <div className="text-center py-6 space-y-2">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">No dailies yet</div>
                    <div className="text-xs text-ink-400 font-mono max-w-md mx-auto">
                      Add user-defined dailies (e.g. "Stretch 10m", "Read 30m"), or set up your
                      spiritual practices on the Spiritual tab. Built-in WORKOUT appears once
                      you mark a workout day in <Link to="/routine" className="neon-text-cyan hover:underline">Routine</Link>.
                    </div>
                    <NeonButton onClick={() => setCreating(true)} icon="+" variant="cyan">
                      New Daily
                    </NeonButton>
                  </div>
                </Panel>
              )}
            </div>

            {/* Check-ins — same cadence cards as the dashboard,
                stacked vertically so they fit the narrower right
                column on the /today page. Each card has its own
                "View all →" link to /check-ins at the bottom.
                Pain card sits above check-ins so the user sees
                it first thing — that's the "is it going down?"
                glance they need before starting the day. */}
            <div className="space-y-3">
              <PainCard />
              <CheckInsPanel layout="stack" />
            </div>
          </div>
        </>
      )}

      {/* Today's recovery stack — moved here from above the
          dailies/check-ins on mobile (where it pushed the
          interactive items below the fold). On desktop the
          2-column grid shows dailies + check-ins side by side
          so the recovery stack was getting visually buried
          above; putting it below keeps the morning flow
          (dailies → check-ins → "what should I do for recovery?")
          in a top-to-bottom order. State persists in
          localStorage so it stays in sync with /recovery. */}
      <div className="mt-6">
        <RecoveryPracticesPanel />
      </div>

      {/* Daily editor (create / edit) */}
      {(creating || editing) && (
        <DailyEditor
          mode={editing ? 'edit' : 'create'}
          daily={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['dailies'] });
          }}
        />
      )}
    </>
  );

  // Wall mode: render the body WITHOUT the app's chrome (header,
  // sidebar, bottom-nav all hidden). Wall-clock + checklist, single
  // row in landscape. Same data, same tick handlers. Activate via
  // ?wall=1; exit via ✕ or Escape.
  if (wallMode) {
    return (
      <WallModeShell onExit={exitWallMode}>
        {body}
      </WallModeShell>
    );
  }

  return (
    <Layout>
      <PageHeader
        title="// Today"
        subtitle={`Dailies for ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} — built-in + yours.`}
        action={
          <div className="flex items-center gap-3">
            <Link
              to="/calendar"
              className="text-[10px] font-mono uppercase tracking-widest border border-ink-500/40 text-ink-300 hover:border-neon-cyan hover:text-neon-cyan px-2 py-1"
            >
              ◷ Calendar
            </Link>
            <div className="font-mono text-sm">
              <span className="text-ink-300 text-xs uppercase tracking-widest">Done: </span>
              <span className={`text-xl ml-1 ${counts.completed === counts.total && counts.total > 0 ? 'neon-text-lime' : 'neon-text-cyan'}`}>
                {counts.completed}/{counts.total}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSearchParams({ wall: '1' })}
              title="Full-screen checklist mode"
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-display tracking-widest uppercase border border-neon-magenta/50 text-neon-magenta hover:bg-neon-magenta/10 rounded"
            >
              ▢ Wall mode
            </button>
            <NeonButton onClick={() => setCreating(true)} icon="+" variant="cyan">
              New Daily
            </NeonButton>
          </div>
        }
      />
      {body}
    </Layout>
  );
}

/**
 * Wall mode shell — full-screen, no Layout chrome. Designed to live
 * on a phone/tablet propped against a wall (landscape orientation)
 * so the user can glance at the checklist throughout the day.
 *
 * - Forces landscape orientation via Screen Orientation API where
 *   supported (Chrome Android / ChromeOS). Silently no-ops on
 *   browsers that don't expose it.
 * - When the API isn't available and the viewport is portrait,
 *   shows a "rotate device" overlay so the user knows how to
 *   orient the device manually.
 * - Layout is single-row at the top: big X/Y completion counter
 *   on the left, checklist + actions on the right. The pre-wall-mode
 *   stacked layout didn't fit on a wall-pro landscape phone.
 * - Restores the previous orientation on unmount so the rest of
 *   the app isn't affected.
 */
function WallModeShell({
  onExit,
  children,
}: {
  onExit: () => void;
  children: React.ReactNode;
}) {
  // Wall-clock display. Updates every minute via the shared hook,
  // which also restarts the interval when the tab returns to
  // foreground so a backgrounded phone picks up the correct time
  // the moment it wakes.
  const now = useLiveClock(1_000);
  // Build the time + AM/PM separately so the AM/PM sits in its
  // own fixed-width slot. With toLocaleTimeString, AM/PM rides
  // along after the seconds — its x-position shifts whenever a
  // wider digit (4/5) replaces a narrower one (1/7), even with
  // tabular-nums. Splitting gives a rock-steady column.
  const hh = String(((now.getHours() + 11) % 12) + 1).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ampm = now.getHours() < 12 ? 'AM' : 'PM';
  const date = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // Track viewport aspect ratio so we can hint rotation when the
  // API lock isn't available. We update on resize/orientationchange.
  const [isLandscape, setIsLandscape] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(orientation: landscape)').matches;
  });
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const onChange = () => setIsLandscape(mq.matches);
    mq.addEventListener('change', onChange);
    window.addEventListener('orientationchange', onChange);
    window.addEventListener('resize', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
      window.removeEventListener('orientationchange', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, []);

  // Try to lock landscape while wall mode is mounted. Most desktop
  // browsers + iOS Safari don't support .lock(); we silently fall
  // through to the rotation-hint overlay in that case.
  const [lockAttempted, setLockAttempted] = useState(false);
  const [lockSucceeded, setLockSucceeded] = useState(false);
  useEffect(() => {
    const so = (screen as any).orientation;
    if (!so || typeof so.lock !== 'function') {
      setLockAttempted(true);
      return;
    }
    let cancelled = false;
    setLockAttempted(true);
    so.lock('landscape')
      .then(() => {
        if (!cancelled) setLockSucceeded(true);
      })
      .catch(() => {
        // Permission denied / not user-initiated / not supported —
        // the rotation-hint overlay handles these gracefully.
      });
    return () => {
      cancelled = true;
      try { so.unlock?.(); } catch { /* ignore */ }
    };
  }, []);

  const needsRotateHint = lockAttempted && !lockSucceeded && !isLandscape;

  return (
    <div className="min-h-screen bg-bg-900 text-slate-100 px-4 py-4 md:px-6 md:py-5 pb-16 overflow-x-hidden">
      {/* Exit pill — top-right corner */}
      <button
        type="button"
        onClick={onExit}
        title="Exit wall mode (Esc)"
        className="fixed top-3 right-3 z-50 inline-flex items-center justify-center w-9 h-9 border border-ink-700/60 text-ink-300 hover:border-neon-magenta hover:text-neon-magenta hover:bg-neon-magenta/10 rounded text-base leading-none"
      >
        ✕
      </button>
      {/* Exit pill — left side, visible from start so the user
          always knows how to get back. */}
      <button
        type="button"
        onClick={onExit}
        title="Exit wall mode (Esc)"
        className="fixed top-3 left-3 z-50 inline-flex items-center gap-1 px-2 py-1.5 text-[10px] font-display tracking-widest uppercase border border-ink-700/60 text-ink-300 hover:border-neon-magenta hover:text-neon-magenta hover:bg-neon-magenta/10 rounded"
      >
        ← Exit
      </button>

      {/* Rotate-device hint. Visible only when we couldn't lock
          orientation AND the viewport is currently portrait. The
          overlay is large enough to read from across the room. */}
      {needsRotateHint && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-bg-900/95 backdrop-blur-sm text-center px-6">
          <div className="text-6xl mb-4 animate-pulse">↻</div>
          <div className="font-display tracking-widest text-2xl text-neon-magenta uppercase">
            Rotate to landscape
          </div>
          <div className="text-xs font-mono text-ink-300 mt-3 max-w-sm">
            Wall mode is designed for landscape. Turn your device
            sideways so the checklist fits beside the date + time.
          </div>
          <button
            type="button"
            onClick={onExit}
            className="mt-6 px-4 py-2 text-[10px] font-display tracking-widest uppercase border border-ink-700/60 text-ink-300 hover:border-neon-magenta rounded"
          >
            ← Back
          </button>
        </div>
      )}

      {/* Landscape layout: a single horizontal row. The left column
          holds the wall-clock display (date + time, and future
          glanceable info like weather / quote-of-the-day). The right
          column holds the checklist + quick actions so the user can
          tick boxes without leaving the display. The X/Y counter is
          gone — the checkboxes themselves show progress. */}
      <div className="max-w-6xl mx-auto min-h-[calc(100vh-2rem)] flex flex-col landscape:flex-row landscape:gap-6 gap-4">
        <div className="shrink-0 flex flex-col items-start justify-center landscape:min-w-[18rem] landscape:border-r landscape:pr-6 text-left py-2 landscape:py-0">
          <div className="font-display tracking-[0.3em] text-[10px] uppercase mb-2 text-neon-cyan opacity-80">
            FitQuest · Wall
          </div>
          {/* HH:MM:SS on the left (variable width as digits change),
              AM/PM pushed to the right edge of a fixed-width row
              with ml-auto. The row has an explicit w-72 / w-80 so
              the right anchor is stable across ticks — the AM/PM
              stays put whether seconds are 09, 14, or 17. */}
          <div className="font-display text-4xl landscape:text-5xl tracking-tight leading-none text-slate-100 mb-2 whitespace-nowrap flex items-baseline w-72 landscape:w-80">
            <span className="tabular-nums">{hh}:{mm}:{ss}</span>
            <span className="ml-auto tabular-nums">{ampm}</span>
          </div>
          <div className="font-display text-2xl landscape:text-3xl text-ink-100 leading-tight">
            {date}
          </div>
        </div>
        <div className="flex-1 min-w-0 min-h-0">
          {children}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ label, count, accent = '#14d6e8' }: { label: string; count: number; accent?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="text-[10px] font-display tracking-[0.2em] uppercase" style={{ color: accent }}>
        {label}
      </div>
      <div className="flex-1 border-t border-ink-700/30" />
      <div className="text-[10px] font-mono text-ink-400">{count}</div>
    </div>
  );
}

function DailyRow({
  daily,
  onToggle,
  onEdit,
  onArchive,
  isPending,
  pendingId,
}: {
  daily: Daily;
  onToggle: () => void;
  onEdit?: () => void;
  onArchive?: () => void;
  isPending: boolean;
  pendingId: string | null;
}) {
  const isBuiltin = daily.category !== 'USER';
  const accent = isBuiltin ? '#14d6e8' : '#9bff5c';
  const isPendingThis = isPending && pendingId === daily.id;

  return (
    <div
      className={classNames(
        'border p-3 flex items-center gap-3 transition-all',
        daily.todayDone
          ? 'border-neon-lime/50 bg-neon-lime/5'
          : 'border-ink-500/30',
      )}
    >
      <button
        onClick={onToggle}
        disabled={isPendingThis}
        className={classNames(
          'shrink-0 w-10 h-10 grid place-items-center font-display text-lg border-2 transition-all',
          daily.todayDone
            ? 'border-neon-lime text-neon-lime'
            : 'border-ink-700 text-ink-400 hover:border-current',
        )}
        style={daily.todayDone ? { textShadow: '0 0 6px currentColor' } : undefined}
        aria-label={daily.todayDone ? 'Mark incomplete' : 'Mark complete'}
      >
        {daily.todayDone ? '✓' : '○'}
      </button>
      <div className="flex-1 min-w-0">
        <div className={classNames(
          'font-display tracking-wider text-sm truncate',
          daily.todayDone ? 'text-neon-lime' : 'text-ink-100',
        )}>
          {daily.name}
        </div>
        <div className="text-[10px] font-mono text-ink-400 flex items-center gap-2 flex-wrap">
          <span className="uppercase tracking-widest" style={{ color: accent }}>
            {daily.category}
          </span>
          {daily.days.length > 0 && (
            <span>
              · {daily.days.map((d) => d.slice(0, 3)).join(' ')}
            </span>
          )}
          {daily.days.length === 0 && <span>· every day</span>}
          {(daily.goldReward > 0 || daily.xpReward > 0) && (
            <span className="text-ink-500">· +{daily.goldReward}g / +{daily.xpReward}xp</span>
          )}
        </div>
        {daily.notes && (
          <div className="text-[10px] font-mono text-ink-400 italic mt-0.5 truncate">
            "{daily.notes}"
          </div>
        )}
      </div>
      {!isBuiltin && (
        <div className="flex items-center gap-1 shrink-0">
          {onEdit && (
            <button
              onClick={onEdit}
              className="text-[10px] font-mono px-2 py-1 border border-ink-500/30 text-ink-300 hover:border-ink-300"
              title="Edit"
            >
              ✎
            </button>
          )}
          {onArchive && (
            <button
              onClick={onArchive}
              className="text-[10px] font-mono px-2 py-1 border border-ink-500/30 text-ink-400 hover:border-neon-magenta hover:text-neon-magenta"
              title="Archive"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DailyEditor({
  mode,
  daily,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  daily?: Daily;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(daily?.name ?? '');
  const [days, setDays] = useState<string[]>(daily?.days ?? []);
  const [notes, setNotes] = useState(daily?.notes ?? '');
  // Tier picker — replaces raw gold/xp inputs. Existing dailies with
  // hand-set rewards get bucketed to the closest tier.
  const [tier, setTier] = useState<DifficultyTier>(
    daily ? tierForRewards(daily.goldReward, daily.xpReward) : DIFFICULTY_TIERS[2],
  );

  const allDays: Array<{ code: string; label: string }> = [
    { code: 'SUN', label: 'Sun' },
    { code: 'MON', label: 'Mon' },
    { code: 'TUE', label: 'Tue' },
    { code: 'WED', label: 'Wed' },
    { code: 'THU', label: 'Thu' },
    { code: 'FRI', label: 'Fri' },
    { code: 'SAT', label: 'Sat' },
  ];

  function toggleDay(code: string) {
    setDays((d) =>
      d.includes(code) ? d.filter((x) => x !== code) : [...d, code],
    );
  }

  const saveM = useDelayedMutation<unknown, void>({
    mutationFn: () => {
      const body =
        mode === 'create'
          ? { name, days, notes: notes || undefined, goldReward: tier.gold, xpReward: tier.xp }
          : { name, days, notes: notes || null, goldReward: tier.gold, xpReward: tier.xp };
      return mode === 'create'
        ? api('/dailies', { method: 'POST', body })
        : api(`/dailies/${daily!.id}`, { method: 'PATCH', body });
    },
    onSuccess: () => onSaved(),
  }, 400);

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Daily' : 'Edit Daily'} hideCloseButton>
      <div className="space-y-4">
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Name
          </label>
          <input
            className="input-neon w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g., Stretch 10m, Read 30m"
            autoFocus
          />
        </div>

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Days (leave empty for every day)
          </label>
          <div className="flex flex-wrap gap-1">
            {allDays.map((d) => (
              <button
                key={d.code}
                onClick={() => toggleDay(d.code)}
                className={classNames(
                  'px-3 py-1.5 text-xs font-mono uppercase border',
                  days.includes(d.code)
                    ? 'border-neon-cyan/80 text-neon-cyan bg-neon-cyan/10'
                    : 'border-ink-500/30 text-ink-300 hover:border-ink-300',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Difficulty
          </label>
          <div className="grid grid-cols-5 gap-1">
            {DIFFICULTY_TIERS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTier(t)}
                className={`p-2 text-center border transition-all ${
                  tier.key === t.key ? 'bg-bg-900/60' : 'border-ink-500/30 hover:border-ink-300'
                }`}
                style={
                  tier.key === t.key
                    ? { borderColor: t.color, boxShadow: `0 0 8px ${t.color}55` }
                    : undefined
                }
                title={t.hint}
              >
                <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: t.color }}>
                  {t.label}
                </div>
                <div className="text-[9px] font-mono text-ink-300 mt-0.5">
                  +{t.gold}g · {t.xp}xp
                </div>
              </button>
            ))}
          </div>
          <div className="text-[10px] font-mono text-ink-400 mt-1 italic">
            {tier.hint}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Notes (optional)
          </label>
          <textarea
            className="w-full bg-bg-900/80 border border-ink-500/40 px-2 py-1 text-xs font-mono"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <NeonButton onClick={onClose} variant="cyan">Cancel</NeonButton>
          <NeonButton
            onClick={() => saveM.run()}
            disabled={!name.trim()}
            loading={saveM.isPending}
            icon="⚡"
            loadingText="Saving…"
            variant="lime"
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </NeonButton>
        </div>
      </div>
    </Modal>
  );
}