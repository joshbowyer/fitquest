import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
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

function kgToLb(kg: number): number { return kg * 2.20462; }
function weightUnitLabel(units: UnitSystem): string {
  return units === 'IMPERIAL' ? 'lb' : 'kg';
}

export function ActivitiesPage() {
  const { user } = useAuth();
  const units: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';

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

  return (
    <Layout>
      <PageHeader title="// Activities" subtitle="Log a session. Auto-detect PRs. Gain XP." />

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

            {logMode === 'live' ? (
              <LiveWorkoutLogger user={user} units={units} />
            ) : (
              <WorkoutLogger
                user={user}
                units={units}
                copyFrom={copyFromQ.data?.item}
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
              <ActivityCard key={w.id} workout={w} units={units} timezone={user?.timezone ?? null} userWeightKg={user?.weightKg ?? null} />
            ))}
            {(list.data?.items || []).length === 0 && (
              <div className="text-xs text-ink-300 font-mono text-center py-6 border border-dashed border-ink-700/30">
                No sessions logged yet.
              </div>
            )}
          </div>
        </Panel>
      </div>
    </Layout>
  );
}

function ActivityCard({ workout: w, units, timezone, userWeightKg }: { workout: any; units: UnitSystem; timezone?: string | null; userWeightKg?: number | null }) {
  const navigate = useNavigate();
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
      onClick={() => navigate(`/activities/${w.id}`)}
      className={classNames(
        'w-full block border p-3 text-left transition-all hover:border-neon-cyan/60',
        isFitImport
          ? 'border-neon-amber/40 bg-neon-amber/5'
          : 'border-ink-500/30 bg-bg-700/40',
      )}
    >
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