import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { formatSeconds, classNames, formatAbsolute } from '@/lib/format';
import type { Workout } from '@/lib/types';
import { convertForDisplay, type UnitSystem } from '@/lib/units';
import { setVolumeKg } from '@/lib/exerciseVolume';
import { WorkoutLogger } from '@/components/WorkoutLogger';
import { LiveWorkoutLogger } from '@/components/LiveWorkoutLogger';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { NeonButton } from '@/components/NeonButton';
import { Link } from 'react-router-dom';
import { useLongPress } from '@/hooks/useLongPress';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

function kgToLb(kg: number): number { return kg * 2.20462; }
function weightUnitLabel(units: UnitSystem): string {
  return units === 'IMPERIAL' ? 'lb' : 'kg';
}

export function ActivitiesPage() {
  const { user } = useAuth();
  const units: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';
  const qc = useQueryClient();

  // Multi-select state — drives the long-press → "Delete N
  // selected" flow on the history list. `selected` is a Set of
  // workout ids; `selectionMode` is the boolean that controls
  // whether the row renders the checkbox indicator + whether the
  // tap behavior toggles selection vs. navigates. The state is
  // kept in the parent so the sticky "Delete N selected" bottom
  // bar can read it without re-rendering the rows.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectionMode = selected.size > 0;
  const exitSelection = () => setSelected(new Set());

  // History filters. Default to 'all' because the user routinely
  // bulk-imports a season of workouts at once (e.g. Gadgetbridge's
  // /tmp/gadgetbridge/ACTIVITY/*.fit dump). The '30d' default from
  // earlier was hiding anything older than a month — the user
  // kept wondering where the FIT imports went. The API caps the
  // page at 200 (see api/src/routes/workouts.ts), which covers a
  // couple of years of daily activity.
  const [historyFilter, setHistoryFilter] = useState<'all' | '7d' | '30d' | '90d'>('all');
  const [exerciseFilter, setExerciseFilter] = useState('');

  // Log mode. Live mode is the default — one set at a time, rest timer
  // auto-starts, timestamps captured for Garmin FIT correlation. Bulk
  // mode is the legacy form (all sets typed up front, user can paste
  // from a notebook / spreadsheet). The choice persists in localStorage
  // so the user's preference sticks across sessions without needing
  // a server round-trip.
  const [logMode, setLogMode] = useState<'live' | 'bulk'>(() => {
    if (typeof window === 'undefined') return 'live';
    return (window.localStorage.getItem('fitquest.logMode') as 'live' | 'bulk' | null) || 'live';
  });
  useEffect(() => {
    window.localStorage.setItem('fitquest.logMode', logMode);
  }, [logMode]);

  const list = useQuery({
    queryKey: ['workouts'],
    queryFn: () => api<{ items: Workout[]; total: number }>('/workouts?limit=100'),
  });

  // Bulk-delete mutation. Powers the multi-select "Delete N
  // selected" sticky bar. POSTs to /workouts/bulk-delete (see
  // api/src/routes/workouts.ts). Single round-trip for the whole
  // batch; the api runs the deletes in a transaction and verifies
  // ownership. On success, invalidate the workouts query and exit
  // selection mode.
  const bulkDeleteM = useMutation<{ deleted: number }, Error, string[]>({
    mutationFn: (ids) =>
      api('/workouts/bulk-delete', { method: 'POST', body: { ids } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workouts'] });
      exitSelection();
    },
  });

  // Saved workout routines (templates). The quick-start card shows
  // these as clickable chips; clicking one prefills the logger with
  // the template's exercises + rep targets.
  type WorkoutTemplateListItem = {
    id: string;
    name: string;
    type: string;
    notes: string | null;
    exerciseCount: number;
    updatedAt: string;
  };
  const templatesQ = useQuery({
    queryKey: ['workout-templates'],
    queryFn: () => api<{ items: WorkoutTemplateListItem[] }>('/workout-templates'),
  });

  // Selected template — when set, the logger below remounts (via key)
  // and pre-fills from the template's full detail fetch.
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const selectedTemplateQ = useQuery({
    queryKey: ['workout-template', selectedTemplateId],
    queryFn: () => api<{
      id: string;
      name: string;
      type: string;
      notes: string | null;
      exercises: Array<{
        name: string;
        order: number;
        groupIndex?: number | null;
        sets: Array<{ order: number; targetReps: number; targetDuration: number | null }>;
      }>;
    }>(`/workout-templates/${selectedTemplateId}`),
    enabled: !!selectedTemplateId,
  });

  // Honor ?copyFrom=<workoutId> from the detail page. We fetch that
  // one workout directly (instead of scanning the list, which may
  // paginate and not include older entries) and pre-fill the form.
  const [searchParams, setSearchParams] = useSearchParams();
  const copyFromId = searchParams.get('copyFrom');
  const copyFromQ = useQuery({
    queryKey: ['copy-from-workout', copyFromId],
    queryFn: () => api<{ item: Workout }>(`/workouts/${copyFromId}`),
    enabled: !!copyFromId,
  });

  // Strip the query param after the copy-from data arrives, so
  // refreshes don't re-prefill the form.
  useEffect(() => {
    if (!copyFromId) return;
    if (copyFromQ.isSuccess && copyFromQ.data?.item) {
      const next = new URLSearchParams(searchParams);
      next.delete('copyFrom');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyFromQ.isSuccess]);

  // Apply date + exercise filters to the history list
  const filteredHistory = (list.data?.items ?? []).filter((w) => {
    if (historyFilter !== 'all') {
      const days = historyFilter === '7d' ? 7 : historyFilter === '30d' ? 30 : 90;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      if (new Date(w.performedAt).getTime() < cutoff) return false;
    }
    if (exerciseFilter.trim()) {
      const q = exerciseFilter.toLowerCase();
      if (!w.exercises.some((ex) => ex.name.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  // Pull-to-refresh: invalidate the workouts list (history
  // panel) + the workout-templates list (quick-start chips).
  // The two conditional queries (selectedTemplate detail + the
  // ?copyFrom=<id> prefill) refetch naturally because they
  // share the same queryKey prefix when their `enabled` flips
  // after a stale-while-revalidate window.
  const { pulledPx, refreshing } = usePullToRefresh<HTMLDivElement>({
    scrollSelector: 'main',
    onRefresh: () => {
      qc.invalidateQueries({ queryKey: ['workouts'] });
      qc.invalidateQueries({ queryKey: ['workout-templates'] });
    },
  });

  return (
    <Layout>
      <PageHeader
        title="// Activities"
        subtitle="Log a session. Auto-detect PRs. Gain XP."
        action={
          pulledPx > 4 ? (
            <span
              aria-hidden
              className="text-[10px] font-mono uppercase tracking-widest text-ink-300"
            >
              {refreshing
                ? 'Refreshing…'
                : pulledPx > 0
                  ? `Release to refresh (${Math.round(pulledPx)}px)`
                  : 'Pull to refresh'}
            </span>
          ) : null
        }
      />

      {/* Side-by-side layout: Log Session (left, ~66%) + History (right, ~33%).
          Stacks vertically below the lg breakpoint so phone users get a
          single-column scroll. The History list itself stays single-column
          even at lg — the previous 3-col grid crushed the activity cards
          and made volumes/dates hard to read. */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 items-start">
        <ErrorBoundary
          fallback={
            <Panel variant="magenta" title="Log Session (load error)">
              <div className="text-xs font-mono text-neon-magenta space-y-2">
                <div>The workout logger crashed. Try a hard refresh (Ctrl+Shift+R).</div>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="px-3 py-1.5 text-xs font-mono border border-neon-magenta text-neon-magenta hover:bg-neon-magenta/10"
                >
                  Reload page
                </button>
              </div>
            </Panel>
          }
        >
          {/* Single container so the grid sees ONE child cell, not
              two. Without this wrapper, ErrorBoundary's children leak
              into the grid as siblings — toggle becomes the left cell
              and the logger becomes the right cell, with history
              wrapping below on its own row. */}
          <div className="space-y-2">
            {/* Log mode toggle. Lives outside the logger so the toggle
                survives the logger's internal resets. Defaults to live;
                persists in localStorage. */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono text-ink-400 uppercase tracking-widest mr-1">Log mode</span>
              {(['live', 'bulk'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setLogMode(m)}
                  className={classNames(
                    'px-2 py-1 text-[10px] font-mono uppercase tracking-widest border',
                    logMode === m
                      ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
                      : 'border-ink-500/40 text-ink-300 hover:border-ink-300',
                  )}
                  title={m === 'live'
                    ? 'Enter-as-you-go. One set at a time. Rest auto-timer. Timestamps recorded for Garmin FIT correlation.'
                    : 'Bulk entry. Fill in all sets up front, commit at the end.'}
                >
                  {m === 'live' ? 'Live' : 'Bulk'}
                </button>
              ))}
            </div>

            {/* ---------- Quick start: saved routines ---------- */}
            <div className="border border-neon-cyan/30 bg-bg-900/40 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
                  Quick start · pick a routine
                </div>
                <Link
                  to="/routines"
                  className="text-[10px] font-mono text-neon-cyan hover:underline"
                >
                  Manage →
                </Link>
              </div>
              {templatesQ.isLoading && (
                <div className="text-[10px] font-mono text-ink-400">⏳ Loading routines…</div>
              )}
              {templatesQ.data && templatesQ.data.items.length === 0 && (
                <div className="text-[10px] font-mono text-ink-400 py-1">
                  No saved routines yet.{' '}
                  <Link to="/routines" className="text-neon-cyan hover:underline">
                    Create one
                  </Link>{' '}
                  to prefill exercises + reps.
                </div>
              )}
              {templatesQ.data && templatesQ.data.items.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {templatesQ.data.items.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(t.id)}
                      className={classNames(
                        'px-2.5 py-1.5 text-[11px] font-mono border transition-all text-left',
                        selectedTemplateId === t.id
                          ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10 shadow-neon-cyan/30'
                          : 'border-ink-500/40 text-ink-200 hover:border-neon-cyan/60 hover:bg-neon-cyan/5',
                      )}
                      title={`${t.exerciseCount} exercises · ${t.type.toLowerCase()}`}
                    >
                      <span className="block leading-tight">{t.name}</span>
                      <span className="block text-[9px] text-ink-400 leading-tight">
                        {t.exerciseCount} ex · {t.type.toLowerCase()}
                      </span>
                    </button>
                  ))}
                  {selectedTemplateId && (
                    <button
                      type="button"
                      onClick={() => setSelectedTemplateId(null)}
                      className="px-2 py-1 text-[10px] font-mono border border-ink-500/40 text-ink-300 hover:border-ink-300"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
              {selectedTemplateId && selectedTemplateQ.isSuccess && selectedTemplateQ.data && (
                <div className="text-[10px] font-mono text-neon-cyan/70">
                  ⤓ Prefilling logger with {selectedTemplateQ.data.exercises.length} exercises from{' '}
                  <span className="text-neon-cyan">{selectedTemplateQ.data.name}</span>. Weight left blank — fill it in as you go.
                </div>
              )}
            </div>

            {/* Pre-load gate: while selectedTemplateQ is still pending
                show a brief placeholder so the logger doesn't mount
                with templatePrefill=null. On error we ALSO show the
                logger (with null prefill) so the user can still log a
                session — but also surface the error so they know the
                routine didn't load. Without this, a 404 / network
                failure on the template route hangs "Loading routine…"
                forever and the user can't proceed. */}
            {selectedTemplateId && selectedTemplateQ.isPending && (
              <div className="text-[11px] font-mono text-ink-300 italic py-3 px-2 border border-dashed border-ink-700/40">
                Loading routine…
              </div>
            )}
            {selectedTemplateId && selectedTemplateQ.isError && (
              <div className="text-[11px] font-mono text-rose-300/80 italic py-3 px-2 border border-dashed border-rose-700/40">
                Couldn't load that routine — showing an empty logger. Try
                editing the template first, or pick a different routine.
              </div>
            )}
            {logMode === 'live' ? (
              <LiveWorkoutLogger
                // Re-key on the loaded template's id (not just the
                // selectedTemplateId) so the component remounts once
                // the query resolves. Without this, the first mount
                // sees templatePrefill=null and the exercises list
                // never updates when the data arrives.
                key={selectedTemplateQ.data ? `live-data-${selectedTemplateQ.data.id}` : `live-pending-${selectedTemplateId ?? 'none'}`}
                user={user}
                units={units}
                templatePrefill={
                  selectedTemplateQ.data
                    ? {
                        name: selectedTemplateQ.data.name,
                        notes: selectedTemplateQ.data.notes,
                        type: selectedTemplateQ.data.type as any,
                        exercises: selectedTemplateQ.data.exercises.map((ex) => ({
                          name: ex.name,
                          groupIndex: ex.groupIndex ?? null,
                          sets: ex.sets.map((s) => ({
                            targetReps: s.targetReps,
                            targetDuration: s.targetDuration ?? undefined,
                          })),
                        })),
                      }
                    : null
                }
              />
            ) : (
              <WorkoutLogger
                key={selectedTemplateQ.data ? `bulk-data-${selectedTemplateQ.data.id}` : `bulk-pending-${selectedTemplateId ?? 'none'}`}
                user={user}
                units={units}
                copyFrom={copyFromQ.data?.item}
                templatePrefill={
                  selectedTemplateQ.data
                    ? {
                        name: selectedTemplateQ.data.name,
                        notes: selectedTemplateQ.data.notes,
                        type: selectedTemplateQ.data.type as any,
                        exercises: selectedTemplateQ.data.exercises.map((ex) => ({
                          name: ex.name,
                          groupIndex: ex.groupIndex ?? null,
                          sets: ex.sets.map((s) => ({
                            targetReps: s.targetReps,
                            targetDuration: s.targetDuration ?? undefined,
                          })),
                        })),
                      }
                    : null
                }
              />
            )}
          </div>
        </ErrorBoundary>

        {/* History */}
        <Panel
          variant="magenta"
          title="History"
          action={
            <span className="text-[10px] font-mono text-ink-300 tracking-widest">
              {filteredHistory.length} sessions
            </span>
          }
        >
          {/* Filters */}
          <div className="space-y-2 mb-3">
            <div className="flex gap-1 flex-wrap">
              {(['7d', '30d', '90d', 'all'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setHistoryFilter(f)}
                  className={classNames(
                    'px-2 py-1 text-[10px] font-mono uppercase tracking-widest border',
                    historyFilter === f
                      ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
                      : 'border-ink-500/40 text-ink-300 hover:border-ink-300',
                  )}
                >
                  {f === 'all' ? 'All' : f}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="filter by exercise…"
              value={exerciseFilter}
              onChange={(e) => setExerciseFilter(e.target.value)}
              className="input-neon text-xs"
            />
          </div>

          <div className="space-y-2 max-h-[80vh] overflow-y-auto pr-1">
            {filteredHistory.map((w) => (
              <ActivityCard
                key={w.id}
                workout={w}
                units={units}
                timezone={user?.timezone ?? null}
                userWeightKg={user?.weightKg ?? null}
                selected={selected.has(w.id)}
                selectionMode={selectionMode}
                onToggleSelect={() => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(w.id)) next.delete(w.id);
                    else next.add(w.id);
                    return next;
                  });
                }}
                onEnterSelection={() => {
                  setSelected((prev) => {
                    if (prev.has(w.id)) return prev;
                    const next = new Set(prev);
                    next.add(w.id);
                    return next;
                  });
                }}
              />
            ))}
            {(list.data?.items || []).length === 0 && (
              <div className="text-xs text-ink-300 font-mono text-center py-6 border border-dashed border-ink-700/30">
                No sessions logged yet.
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* Sticky multi-select action bar — only visible when at least
          one workout is selected. Floats above the page bottom
          edge with a frosted background so the row content stays
          readable underneath. "Cancel" exits selection mode without
          deleting anything; the danger-styled "Delete" button calls
          the bulk-delete mutation. The pending state is reflected
          on the button via `loading`. */}
      {selectionMode && (
        <div className="fixed bottom-4 inset-x-0 z-30 flex justify-center pointer-events-none">
          <div className="pointer-events-auto bg-bg-900/95 border border-rose-500/40 shadow-2xl backdrop-blur-md rounded-md px-4 py-2 flex items-center gap-3 text-sm font-mono">
            <span className="text-ink-100">
              <span className="text-rose-300 font-bold">{selected.size}</span>
              {' '}selected
            </span>
            <button
              type="button"
              onClick={exitSelection}
              className="px-3 py-1 text-xs uppercase tracking-widest border border-ink-500/50 text-ink-200 hover:border-ink-300"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={bulkDeleteM.isPending}
              onClick={() => {
                if (window.confirm(`Delete ${selected.size} session${selected.size === 1 ? '' : 's'}?`)) {
                  bulkDeleteM.mutate(Array.from(selected));
                }
              }}
              className="px-3 py-1 text-xs uppercase tracking-widest border border-rose-500/60 text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50"
            >
              {bulkDeleteM.isPending ? 'Deleting…' : `Delete ${selected.size}`}
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}

function ActivityCard({
  workout: w,
  units,
  timezone,
  userWeightKg,
  selected,
  selectionMode,
  onToggleSelect,
  onEnterSelection,
}: {
  workout: any;
  units: UnitSystem;
  timezone?: string | null;
  userWeightKg?: number | null;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: () => void;
  onEnterSelection: () => void;
}) {
  const navigate = useNavigate();
  // Long-press detector — fires `onEnterSelection` after 500ms
  // without a >10px drift. On touch devices (mobile) this is the
  // standard multi-select gesture; on desktop it also works
  // (mouse-hold), which is convenient for testing in the dev
  // tools. When selectionMode is already active the row's
  // click-tap behavior switches to `onToggleSelect` via the
  // merged handler below.
  const longPress = useLongPress<HTMLButtonElement>({
    onLongPress: () => onEnterSelection(),
    onPressStart: () => { /* no-op visual: the row gets a faint highlight via the :active rule */ },
  });
  // Reduce of an empty array throws if no initial value is passed.
  // Pass 0 as the initial value so workouts with no exercises (e.g.
  // a CARDIO or MOBILITY log) render without crashing. Use the
  // bodyweight-aware helper so pushups don't inflate to 100% of
  // user weight (they're ~0.64).
  const totalVolume = (w.exercises ?? []).reduce(
    (acc: number, ex: any) => acc + (ex.sets ?? []).reduce(
      (s: number, set: any) => s + setVolumeKg(set, ex.name ?? '', userWeightKg ?? 0), 0,
    ),
    0,
  );
  const volDisplay = units === 'IMPERIAL'
    ? Math.round(kgToLb(totalVolume))
    : Math.round(totalVolume);
  const isFitImport = typeof w.notes === 'string' && w.notes.startsWith('[FIT]');
  const fitMetrics = isFitImport ? parseFitNotes(w.notes) : null;

  return (
    <button
      type="button"
      // Click behavior: in selectionMode, toggle selection. Otherwise
      // (default) navigate to the detail page. The long-press handlers
      // sit alongside — they're passive on touch devices and don't
      // interfere with the click path.
      onClick={selectionMode ? onToggleSelect : () => navigate(`/activities/${w.id}`)}
      {...longPress}
      className={classNames(
        'w-full block border p-3 text-left transition-all',
        selected
          ? 'border-neon-rose/80 bg-rose-500/10 ring-1 ring-neon-rose/40'
          : isFitImport
            ? 'border-neon-amber/40 bg-neon-amber/5 hover:border-neon-cyan/60'
            : 'border-ink-500/30 bg-bg-700/40 hover:border-neon-cyan/60',
      )}
    >
      {selectionMode && (
        <div
          aria-hidden
          className="absolute top-2 right-2 w-4 h-4 rounded-sm border-2 flex items-center justify-center"
          style={{
            borderColor: selected ? '#ff3a6a' : '#3a3f4a',
            background: selected ? '#ff3a6a' : 'transparent',
          }}
        >
          {selected && (
            <svg viewBox="0 0 16 16" className="w-3 h-3 text-bg-900" fill="currentColor" aria-hidden>
              <path d="M13.485 1.929a1 1 0 0 0-1.414 0L5 8.999 1.929 5.929a1 1 0 0 0-1.414 1.414l3.5 3.5a1 1 0 0 0 1.414 0L13.485 3.343a1 1 0 0 0 0-1.414z" />
            </svg>
          )}
        </div>
      )}
      <div className="flex justify-between items-baseline mb-2 gap-2">
        <span className="font-display tracking-wider text-sm text-neon-cyan truncate">
          {w.name || w.type}
        </span>
        <span className="text-[10px] font-mono text-ink-400 shrink-0 text-right" title={`${new Date(w.performedAt).toISOString()} (UTC)`}>
          {formatAbsolute(w.performedAt, timezone ?? null)}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-ink-300 mb-2">
        <span>{w.type}</span>
        <span>· {w.duration ?? 0}m</span>
        {volDisplay > 0 && (
          <span className="text-neon-cyan">{volDisplay.toLocaleString()} {weightUnitLabel(units)} vol</span>
        )}
        {isFitImport && <span className="text-neon-amber">⟂ FIT</span>}
        {(() => {
          const c = w.cardio;
          if (!c) return null;
          const parts: string[] = [];
          if (c.distanceKm != null) {
            const d = units === 'IMPERIAL' ? c.distanceKm / 1.609344 : c.distanceKm;
            parts.push(`${d.toFixed(2)} ${units === 'IMPERIAL' ? 'mi' : 'km'}`);
          }
          if (c.durationSec != null) parts.push(formatSeconds(c.durationSec));
          if (c.pace) parts.push(c.pace.toLowerCase().replace(/_/g, ' '));
          if (parts.length === 0) return null;
          return <span className="text-neon-amber">⚡ {parts.join(' · ')}</span>;
        })()}
      </div>

      {fitMetrics && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-ink-300 mb-2 border-t border-ink-500/15 pt-2">
          {fitMetrics.distance != null && (
            <span>{(() => {
              const d = convertForDisplay(fitMetrics.distance, 'm', units);
              return `${d.value.toFixed(2)} ${d.unit}`;
            })()}</span>
          )}
          {fitMetrics.avgHr != null && <span>avg HR {fitMetrics.avgHr}</span>}
          {fitMetrics.maxHr != null && <span>max HR {fitMetrics.maxHr}</span>}
          {fitMetrics.calories != null && <span>{fitMetrics.calories} kcal</span>}
          {fitMetrics.avgPower != null && <span>{fitMetrics.avgPower}W</span>}
          {fitMetrics.np != null && <span>NP {fitMetrics.np}W</span>}
        </div>
      )}

      {!isFitImport && (
        <div className="text-[10px] font-mono text-ink-400 truncate mb-2">
          {w.exercises.slice(0, 3).map((ex: any) => ex.name).filter(Boolean).join(' · ')}
          {w.exercises.length > 3 && ` +${w.exercises.length - 3} more`}
        </div>
      )}

      <div className="text-[9px] font-mono text-ink-500 pt-1 border-t border-ink-500/10">→ open</div>
    </button>
  );
}

// =============================================================================
// FIT notes parser — extracts key metrics from the [FIT] ... notes string
// the import route writes. Survives here because it's a parsing helper
// tied to ActivityCard's display logic, not to the workout form.
// =============================================================================

function parseFitNotes(notes: string): {
  sport?: string;
  distance?: number;
  avgHr?: number;
  maxHr?: number;
  calories?: number;
  avgPower?: number;
  np?: number;
} {
  const out: ReturnType<typeof parseFitNotes> = {};
  // Notes format: "[FIT] running/generic · 1.62 km · avg HR 136 · max HR 147 · 80 kcal · avg 337W · NP 352W"
  const parts = notes.replace(/^\[FIT\]\s*/, '').split(' · ').map((p) => p.trim());
  for (const p of parts) {
    const dist = p.match(/^([\d.]+)\s*(km|mi)$/);
    if (dist) {
      const km = Number(dist[1]) * (dist[2] === 'mi' ? 1.609344 : 1);
      if (Number.isFinite(km)) out.distance = km * 1000;
    } else if (/^avg HR \d/.test(p)) {
      out.avgHr = parseInt(p.replace(/^avg HR /, ''), 10);
    } else if (/^max HR \d/.test(p)) {
      out.maxHr = parseInt(p.replace(/^max HR /, ''), 10);
    } else if (/kcal$/.test(p)) {
      out.calories = parseInt(p, 10);
    } else if (/^avg \d+W$/.test(p)) {
      out.avgPower = parseInt(p.replace(/^avg /, '').replace(/W$/, ''), 10);
    } else if (/^NP \d+W$/.test(p)) {
      out.np = parseInt(p.replace(/^NP /, '').replace(/W$/, ''), 10);
    } else if (!out.sport) {
      out.sport = p;
    }
  }
  return out;
}