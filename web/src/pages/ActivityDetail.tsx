import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ActivityMap, type TrackPoint } from '@/components/ActivityMap';
import { ActivityStreamsChart } from '@/components/ActivityStreamsChart';
import { ActivityInsightPanel } from '@/components/ActivityInsightPanel';
import { api, ApiError } from '@/lib/api';
import { classNames, formatRelative, formatSeconds, formatMetricWithUnit, formatAbsolute } from '@/lib/format';
import { convertForDisplay, displayUnit, type UnitSystem } from '@/lib/units';
import { setVolumeKg } from '@/lib/exerciseVolume';
import { checkSetPlausibility } from '@/lib/exerciseLimits';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';

type SetEntry = {
  id: string;
  reps: number;
  weight: number | null;
  duration: number | null;
  rpe: number | null;
  completed: boolean;
};

type ExerciseEntry = {
  id: string;
  name: string;
  notes: string | null;
  sets: SetEntry[];
  musclesWorked?: string[];
};

type Workout = {
  id: string;
  userId: string;
  type: 'STRENGTH' | 'HYPERTROPHY' | 'CALISTHENICS' | 'CARDIO' | 'MOBILITY' | 'OTHER';
  name: string | null;
  durationSec: number | null;
  notes: string | null;
  performedAt: string;
  createdAt: string;
  exercises: ExerciseEntry[];
  /** Per-second trackpoints from FIT RecordMesg. Empty array otherwise. */
  trackJson?: TrackPoint[];
};

type PR = {
  id: string;
  exercise: string;
  type: 'WEIGHT' | 'REPS' | 'TIME' | 'HOLD';
  value: number;
  reps?: number | null;
  weightKg?: number | null;
  achievedAt: string;
};

type UserAchievement = {
  id: string;
  unlockedAt: string;
  achievement: {
    id: string;
    name: string;
    description: string;
    category: string;
    points: number;
    glyph?: string | null;
  };
};

type LevelProgress = {
  id: string;
  order: number;
  name: string;
  completedAt: string | null;
  requirementSummary?: string;
};

type World = {
  id: string;
  name: string;
  color: string;
  affiliation: string;
  levels: LevelProgress[];
};

function parseFitNotes(notes: string): {
  sport?: string;
  distance?: number;
  avgHr?: number;
  maxHr?: number;
  calories?: number;
  avgPower?: number;
  np?: number;
  rpe?: number;
} {
  const out: any = {};
  const after = notes.replace(/^\[FIT\]\s*/, '');
  const parts = after.split('·').map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    if (/km$/i.test(p)) {
      const km = parseFloat(p);
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
    } else if (/^RPE \d/.test(p)) {
      out.rpe = parseInt(p.replace(/^RPE /, ''), 10);
    } else if (!out.sport) {
      out.sport = p;
    }
  }
  return out;
}

/** Find PRs whose `achievedAt` falls within this workout's session window.
 *  window = [performedAt, performedAt + durationSec] (durationSec in seconds → ms). */
function prsInWindow(
  prs: PR[],
  performedAt: string,
  durationSec: number | null,
): Set<string> {
  const start = new Date(performedAt).getTime();
  const end = start + (durationSec ?? 3600) * 1000;
  const set = new Set<string>();
  for (const p of prs) {
    const t = new Date(p.achievedAt).getTime();
    if (t >= start - 5_000 && t <= end + 5_000) set.add(p.exercise);
  }
  return set;
}

function achievementsInWindow(
  achievements: UserAchievement[],
  performedAt: string,
  durationSec: number | null,
): UserAchievement[] {
  const start = new Date(performedAt).getTime();
  const end = start + (durationSec ?? 3600) * 1000;
  return achievements.filter((a) => {
    const t = new Date(a.unlockedAt).getTime();
    return t >= start - 5_000 && t <= end + 5_000;
  });
}

function levelsClearedInWindow(
  worlds: World[],
  performedAt: string,
  durationSec: number | null,
): Array<{ world: World; level: LevelProgress }> {
  const start = new Date(performedAt).getTime();
  const end = start + (durationSec ?? 3600) * 1000;
  const out: Array<{ world: World; level: LevelProgress }> = [];
  for (const w of worlds) {
    for (const lv of w.levels) {
      if (!lv.completedAt) continue;
      const t = new Date(lv.completedAt).getTime();
      if (t >= start - 5_000 && t <= end + 5_000) {
        out.push({ world: w, level: lv });
      }
    }
  }
  return out;
}

export function ActivityDetailPage() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const system: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';

  const q = useQuery({
    queryKey: ['workout', params.id],
    queryFn: () => api<{ item: Workout | null; error?: string }>(`/workouts/${params.id}`),
    enabled: !!params.id,
  });

  const prsQ = useQuery({
    queryKey: ['prs'],
    queryFn: () => api<{ items: PR[] }>('/prs?limit=200'),
  });
  const achQ = useQuery({
    queryKey: ['achievements', 'me'],
    queryFn: () => api<{ items: UserAchievement[] }>('/achievements/me'),
  });
  const worldsQ = useQuery({
    queryKey: ['quest-worlds'],
    queryFn: () => api<World[]>('/quest/worlds'),
  });

  const deleteM = useDelayedMutation<{ ok: boolean }, void>({
    mutationFn: () => api(`/workouts/${params.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workouts'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      qc.invalidateQueries({ queryKey: ['recovery'] });
      navigate('/activities');
    },
  }, 600);

  const workout = q.data?.item ?? null;
  const sessionStart = workout ? new Date(workout.performedAt).getTime() : 0;

  // PRs that were set in this session
  const prsSet = useMemo(() => {
    if (!workout || !prsQ.data) return new Set<string>();
    return prsInWindow(prsQ.data.items, workout.performedAt, workout.durationSec);
  }, [workout, prsQ.data]);

  // Achievements unlocked during this session
  const sessionAchievements = useMemo(() => {
    if (!workout || !achQ.data) return [];
    return achievementsInWindow(achQ.data.items, workout.performedAt, workout.durationSec);
  }, [workout, achQ.data]);

  // Quest levels cleared during this session
  const sessionClears = useMemo(() => {
    if (!workout || !worldsQ.data) return [];
    return levelsClearedInWindow(worldsQ.data, workout.performedAt, workout.durationSec);
  }, [workout, worldsQ.data]);

  if (!user) return null;
  if (q.isLoading) {
    return (
      <Layout>
        <PageHeader title="// Activity" />
        <Panel><div className="text-[10px] font-mono text-ink-300">loading…</div></Panel>
      </Layout>
    );
  }
  if (!workout) {
    return (
      <Layout>
        <PageHeader title="// Activity" />
        <Panel>
          <div className="text-center py-6 space-y-2">
            <div className="text-[10px] font-mono text-ink-300 uppercase tracking-widest">Activity not found</div>
            <Link to="/activities" className="text-neon-cyan text-xs hover:underline">
              ← back to history
            </Link>
          </div>
        </Panel>
      </Layout>
    );
  }

  const w = workout;
  const isFit = typeof w.notes === 'string' && w.notes.startsWith('[FIT]');
  const fit = isFit && w.notes ? parseFitNotes(w.notes) : null;

  // Aggregates (bodyweight-aware: see web/src/lib/exerciseVolume.ts)
  const userWeightKg = user?.weightKg ?? 0;
  const totalVolumeKg = w.exercises.reduce(
    (acc, ex) => acc + ex.sets.reduce((s, set) => s + setVolumeKg(set, ex.name, userWeightKg), 0),
    0,
  );
  const totalSets = w.exercises.reduce((acc, ex) => acc + ex.sets.length, 0);
  const completedSets = w.exercises.reduce(
    (acc, ex) => acc + ex.sets.filter((s) => s.completed).length,
    0,
  );
  const totalReps = w.exercises.reduce(
    (acc, ex) => acc + ex.sets.reduce((s, set) => s + set.reps, 0),
    0,
  );
  // Training density: kg moved per minute. Useful for comparing effort
  // across sessions of different lengths.
  const density = w.durationSec && w.durationSec > 0 ? totalVolumeKg / (w.durationSec / 60) : 0;
  const densityDisp = system === 'IMPERIAL'
    ? Math.round(convertForDisplay(density, 'kg', 'IMPERIAL').value)
    : Math.round(density);

  return (
    <Layout>
      <PageHeader
        title={w.name || `Activity ${w.id.slice(-6)}`}
        subtitle={
          `${w.type} · ` +
          formatAbsolute(w.performedAt, user?.timezone ?? null) +
          ` (${user?.timezone ? user.timezone : 'UTC'})`
        }
        action={
          <div className="flex items-center gap-2">
            <Link
              to={`/activities?copyFrom=${w.id}`}
              className="text-[10px] font-mono uppercase tracking-widest neon-text-cyan hover:underline"
              title="Pre-fill a new session from this one"
            >
              ↻ copy
            </Link>
            <Link
              to="/activities"
              className="text-[10px] font-mono uppercase tracking-widest neon-text-cyan hover:underline"
            >
              ← history
            </Link>
          </div>
        }
      />

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Type" value={w.type} accent="#14d6e8" />
        <Stat label="Duration" value={w.durationSec ? formatSeconds(w.durationSec) : '—'} accent="#cba6ff" />
        <Stat label="Exercises" value={String(w.exercises.length)} accent="#9bff5c" />
        <Stat
          label={system === 'IMPERIAL' ? 'Volume (lb)' : 'Volume (kg)'}
          value={(
            system === 'IMPERIAL'
              ? Math.round(convertForDisplay(totalVolumeKg, 'kg', 'IMPERIAL').value)
              : Math.round(totalVolumeKg)
          ).toLocaleString()}
          accent="#ffc34d"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Exercises */}
        <Panel variant="cyan" title="Exercises">
          {w.exercises.length === 0 ? (
            <div className="text-[10px] font-mono text-ink-400 italic text-center py-4">
              No exercises logged for this session.
            </div>
          ) : (
            <div className="space-y-3">
              {w.exercises.map((ex) => {
                const isPr = prsSet.has(ex.name);
                const exVolume = ex.sets.reduce(
                  (s, set) => s + setVolumeKg(set, ex.name, userWeightKg),
                  0,
                );
                const exMaxWeight = Math.max(0, ...ex.sets.map((s) => s.weight ?? 0));
                const exRepsTotal = ex.sets.reduce((s, set) => s + set.reps, 0);
                return (
                  <div
                    key={ex.id}
                    className={classNames(
                      'border p-3',
                      isPr ? 'border-neon-magenta/60 bg-neon-magenta/5' : 'border-ink-500/30',
                    )}
                  >
                    <div className="flex items-baseline justify-between mb-2 gap-2">
                      <div className="flex items-baseline gap-2 min-w-0 flex-1">
                        <div className="font-display tracking-wider text-sm text-ink-100 truncate">{ex.name}</div>
                        {isPr && (
                          <span className="text-[9px] font-mono neon-text-magenta tracking-widest uppercase shrink-0">
                            ★ PR
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-ink-400 shrink-0">
                        {ex.sets.length} set{ex.sets.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    {ex.notes && (
                      <div className="text-[10px] font-mono text-ink-400 italic mb-2">"{ex.notes}"</div>
                    )}
                    {ex.musclesWorked && ex.musclesWorked.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {ex.musclesWorked.map((m) => (
                          <span key={m} className="px-1.5 py-0.5 text-[9px] font-mono border border-ink-700/40 text-ink-300">
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Per-set breakdown */}
                    <div className="space-y-1">
                      {ex.sets.map((s, idx) => {
                        const wDisp = s.weight != null
                          ? convertForDisplay(s.weight, 'kg', system)
                          : null;
                        const setVol = setVolumeKg(s, ex.name, userWeightKg);
                        // Per-exercise plausibility verdict. Same
                        // rules the server's flagSuspectSets uses
                        // — if the chip lights up here, the row was
                        // also flagged at commit time. For
                        // historical workouts that pre-date the
                        // server fix, this surfaces the issue
                        // after the fact (no need to re-commit).
                        const verdict = s.weight != null
                          ? checkSetPlausibility(ex.name, s.weight, s.reps, userWeightKg)
                          : { severity: null, reason: null, oneRmKg: null };
                        // Bar width as % of this exercise's heaviest set
                        const barPct = exMaxWeight > 0 && s.weight
                          ? Math.round((s.weight / exMaxWeight) * 100)
                          : 0;
                        return (
                          <div
                            key={s.id}
                            className={classNames(
                              'border',
                              s.completed
                                ? 'border-neon-lime/30 bg-neon-lime/5'
                                : 'border-ink-700/40',
                              verdict.severity === 'block' && 'border-neon-magenta/60',
                              verdict.severity === 'flag' && 'border-neon-amber/60',
                            )}
                          >
                            <div className="grid grid-cols-[24px_1fr_1fr_1fr_1fr_auto] gap-2 items-center text-[11px] font-mono px-2 py-1">
                              <span className="text-ink-400">{idx + 1}</span>
                              <span className={classNames('text-ink-100', !s.completed && 'text-ink-500 line-through')}>
                                {s.reps} reps
                              </span>
                              <span className={classNames('text-neon-cyan', !s.completed && 'text-ink-500 line-through')}>
                                {wDisp ? `${wDisp.value.toFixed(1)} ${wDisp.unit}` : 'BW'}
                              </span>
                              {s.duration != null && s.duration > 0 ? (
                                <span className="text-ink-300">{formatSeconds(s.duration)}</span>
                              ) : (
                                <span className="text-ink-600">—</span>
                              )}
                              {s.rpe != null && s.rpe > 0 ? (
                                <span className="text-neon-amber">RPE {s.rpe}</span>
                              ) : (
                                <span className="text-ink-600">—</span>
                              )}
                              {verdict.severity && (
                                <span
                                  title={verdict.reason ?? ''}
                                  className={classNames(
                                    'shrink-0 inline-flex items-center justify-center w-5 h-5 border text-[10px] font-bold leading-none rounded',
                                    verdict.severity === 'block'
                                      ? 'border-neon-magenta text-neon-magenta bg-neon-magenta/10'
                                      : 'border-neon-amber text-neon-amber bg-neon-amber/10',
                                  )}
                                >
                                  !
                                </span>
                              )}
                            </div>
                            {/* Volume bar */}
                            {setVol > 0 && barPct > 0 && (
                              <div className="h-0.5 bg-bg-900/60 mx-2 mb-1 overflow-hidden">
                                <div
                                  className="h-full bg-neon-cyan/50"
                                  style={{ width: `${barPct}%` }}
                                  title={`${Math.round(setVol)} kg·reps`}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Exercise totals */}
                    <div className="flex justify-between text-[10px] font-mono text-ink-400 mt-2 pt-2 border-t border-ink-500/20">
                      <span>
                        {exRepsTotal} rep{exRepsTotal !== 1 ? 's' : ''} · {Math.round(exVolume).toLocaleString()} kg
                      </span>
                      {exMaxWeight > 0 && (
                        <span className="text-ink-300">top {Math.round(convertForDisplay(exMaxWeight, 'kg', system).value)} {convertForDisplay(exMaxWeight, 'kg', system).unit}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Right: metadata + impact panels */}
        <div className="space-y-4">
          {/* Aggregates */}
          <Panel variant="magenta" title="Aggregates">
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <Row k="Total sets" v={String(totalSets)} />
              <Row
                k="Completed"
                v={`${completedSets}/${totalSets}`}
                accent={completedSets === totalSets ? 'lime' : 'amber'}
              />
              <Row k="Total reps" v={String(totalReps)} />
              <Row
                k="Total volume"
                v={system === 'IMPERIAL'
                  ? `${Math.round(convertForDisplay(totalVolumeKg, 'kg', 'IMPERIAL').value).toLocaleString()} lb`
                  : `${Math.round(totalVolumeKg).toLocaleString()} kg`}
              />
              <Row
                k="Density"
                v={w.durationSec
                  ? `${densityDisp} ${system === 'IMPERIAL' ? 'lb' : 'kg'}/min`
                  : '—'}
                accent="cyan"
              />
              <Row k="Started" v={formatRelative(w.performedAt)} />
            </div>
          </Panel>

          {/* AI insight. Loads on mount; first time shows a "Generate"
              button, after that the cached insight renders directly.
              `key` ensures a fresh panel instance when navigating
              between activities — otherwise React would reuse the
              same component and the inner React Query cache key
              would lag the URL. */}
          <ActivityInsightPanel key={w.id} workoutId={w.id} />

          {/* Achievements unlocked by this session */}
          {sessionAchievements.length > 0 && (
            <Panel variant="amber" title={`UNLOCKED IN THIS SESSION · ${sessionAchievements.length}`}>
              <div className="space-y-1">
                {sessionAchievements.map((ua) => (
                  <div key={ua.id} className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="text-[14px]">{ua.achievement.glyph ?? '◆'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-ink-100 truncate">{ua.achievement.name}</div>
                      <div className="text-[9px] text-ink-400 truncate">{ua.achievement.description}</div>
                    </div>
                    <span className="text-[10px] text-neon-amber">+{ua.achievement.points}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* Quests cleared by this session */}
          {sessionClears.length > 0 && (
            <Panel variant="cyan" title={`QUESTS CLEARED · ${sessionClears.length}`}>
              <div className="space-y-1">
                {sessionClears.map(({ world, level }) => (
                  <Link
                    key={`${world.id}-${level.id}`}
                    to={`/quest/${world.id}`}
                    className="flex items-center gap-2 text-[11px] font-mono hover:underline"
                  >
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 border tracking-widest uppercase"
                      style={{ borderColor: '#9bff5c', color: '#9bff5c' }}
                    >
                      ✓
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-ink-100 truncate">{level.name}</div>
                      <div className="text-[9px] text-ink-400 truncate">
                        {world.name} · {level.requirementSummary ?? ''}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </Panel>
          )}

          {/* FIT metrics */}
          {fit && (
            <Panel variant="amber" title="FIT data">
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                {fit.sport && <Row k="Sport" v={fit.sport} />}
                {fit.distance != null && (
                  <Row
                    k="Distance"
                    v={(() => {
                      const d = convertForDisplay(fit.distance!, 'm', system);
                      return `${d.value.toFixed(2)} ${d.unit}`;
                    })()}
                  />
                )}
                {fit.avgHr != null && <Row k="Avg HR" v={`${fit.avgHr} bpm`} />}
                {fit.maxHr != null && <Row k="Max HR" v={`${fit.maxHr} bpm`} />}
                {fit.calories != null && <Row k="Calories" v={`${fit.calories} kcal`} />}
                {fit.avgPower != null && <Row k="Avg power" v={`${fit.avgPower} W`} />}
                {fit.np != null && <Row k="NP" v={`${fit.np} W`} />}
                {fit.rpe != null && <Row k="RPE" v={String(fit.rpe)} />}
              </div>
            </Panel>
          )}

          {/* Map + streams (only for activities with trackpoint data) */}
          {w.trackJson && w.trackJson.length > 1 ? (
            <>
              <Panel variant="cyan" title="Track">
                <ErrorBoundary>
                  <ActivityMap points={w.trackJson} />
                </ErrorBoundary>
              </Panel>
              <Panel variant="violet" title="Streams">
                <ErrorBoundary>
                  <ActivityStreamsChart points={w.trackJson} system={system} />
                </ErrorBoundary>
              </Panel>
            </>
          ) : isFit && w.trackJson && w.trackJson.length <= 1 ? (
            <Panel variant="amber" title="GPS track">
              <div className="text-[10px] font-mono text-ink-300">
                This FIT file had no GPS samples (likely an indoor activity). Map + streams unavailable.
              </div>
            </Panel>
          ) : isFit ? (
            <Panel variant="amber" title="GPS track">
              <div className="text-[10px] font-mono text-ink-300 space-y-1">
                <div>
                  This activity was imported <em>before</em> trackpoint extraction shipped. The map + streams chart require the new extraction.
                </div>
                <div className="text-neon-cyan">
                  Re-upload the source FIT file via <Link to="/import" className="underline">/import</Link> to populate GPS track + stream data on a new activity.
                </div>
              </div>
            </Panel>
          ) : null}

          {/* Notes */}
          {w.notes && !isFit && (
            <Panel variant="violet" title="Notes">
              <div className="text-xs font-mono text-ink-200 whitespace-pre-wrap">{w.notes}</div>
            </Panel>
          )}

          {/* Delete */}
          <Panel variant="magenta" title="Danger zone">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-mono text-ink-300">
                Delete this activity (also reverts raid damage + PRs).
              </div>
              <NeonButton
                onClick={() => {
                  if (confirm('Delete this activity?')) deleteM.run();
                }}
                loading={deleteM.isPending}
                variant="magenta"
                icon="✕"
                loadingText="Deleting…"
              >
                Delete
              </NeonButton>
            </div>
          </Panel>
        </div>
      </div>
    </Layout>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="border border-ink-500/30 p-2">
      <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">{label}</div>
      <div className="font-display text-xl" style={{ color: accent, textShadow: `0 0 6px ${accent}` }}>
        {value}
      </div>
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: 'lime' | 'amber' | 'cyan' }) {
  const color = accent === 'lime' ? '#9bff5c' : accent === 'amber' ? '#ffc34d' : accent === 'cyan' ? '#14d6e8' : '#fafafd';
  return (
    <div className="flex justify-between border-b border-ink-500/20 py-1">
      <span className="text-ink-300 text-[10px] uppercase tracking-widest">{k}</span>
      <span className="text-xs font-mono" style={{ color }}>{v}</span>
    </div>
  );
}