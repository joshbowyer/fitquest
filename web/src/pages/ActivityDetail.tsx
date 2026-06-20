import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { api, ApiError } from '@/lib/api';
import { classNames, formatRelative, formatSeconds, formatMetricWithUnit } from '@/lib/format';
import { convertForDisplay, displayUnit, type UnitSystem } from '@/lib/units';
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
  duration: number | null;
  notes: string | null;
  performedAt: string;
  createdAt: string;
  exercises: ExerciseEntry[];
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

export function ActivityDetailPage() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const system: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';

  const q = useQuery({
    queryKey: ['workout', params.id],
    queryFn: () => api<Workout>(`/workouts/${params.id}`),
    enabled: !!params.id,
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

  if (!user) return null;
  if (q.isLoading) {
    return (
      <Layout>
        <PageHeader title="// Activity" />
        <Panel><div className="text-[10px] font-mono text-ink-300">loading…</div></Panel>
      </Layout>
    );
  }
  if (!q.data) {
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

  const w = q.data;
  const isFit = typeof w.notes === 'string' && w.notes.startsWith('[FIT]');
  const fit = isFit && w.notes ? parseFitNotes(w.notes) : null;

  // Aggregates
  const totalVolumeKg = w.exercises.reduce(
    (acc, ex) => acc + ex.sets.reduce((s, set) => s + (set.weight ?? 0) * set.reps, 0),
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

  return (
    <Layout>
      <PageHeader
        title={w.name || `Activity ${w.id.slice(-6)}`}
        subtitle={`${w.type} · ${formatRelative(w.performedAt)} · ${new Date(w.performedAt).toLocaleString()}`}
        action={
          <Link
            to="/activities"
            className="text-[10px] font-mono uppercase tracking-widest neon-text-cyan hover:underline"
          >
            ← history
          </Link>
        }
      />

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Type" value={w.type} accent="#14d6e8" />
        <Stat label="Duration" value={w.duration ? `${w.duration}m` : '—'} accent="#cba6ff" />
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* Left: Exercises */}
        <Panel variant="cyan" title="Exercises">
          {w.exercises.length === 0 ? (
            <div className="text-[10px] font-mono text-ink-400 italic text-center py-4">
              No exercises logged for this session.
            </div>
          ) : (
            <div className="space-y-3">
              {w.exercises.map((ex) => (
                <div key={ex.id} className="border border-ink-500/30 p-3">
                  <div className="flex items-baseline justify-between mb-2">
                    <div className="font-display tracking-wider text-sm text-ink-100">{ex.name}</div>
                    <div className="text-[10px] font-mono text-ink-400">
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
                  <div className="space-y-1">
                    {ex.sets.map((s, idx) => {
                      const wDisp = s.weight != null
                        ? convertForDisplay(s.weight, 'kg', system)
                        : null;
                      return (
                        <div
                          key={s.id}
                          className={classNames(
                            'grid grid-cols-[24px_1fr_1fr_1fr_1fr] gap-2 items-center text-[11px] font-mono px-2 py-1 border',
                            s.completed
                              ? 'border-neon-lime/30 bg-neon-lime/5'
                              : 'border-ink-700/40',
                          )}
                        >
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
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Right: metadata + FIT metrics */}
        <div className="space-y-4">
          {/* Aggregates */}
          <Panel variant="magenta" title="Aggregates">
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <Row k="Total sets" v={String(totalSets)} />
              <Row k="Completed" v={String(completedSets)} accent={completedSets === totalSets ? 'lime' : 'amber'} />
              <Row k="Total reps" v={String(totalReps)} />
              <Row
                k="Total volume"
                v={system === 'IMPERIAL'
                  ? `${Math.round(convertForDisplay(totalVolumeKg, 'kg', 'IMPERIAL').value).toLocaleString()} lb`
                  : `${Math.round(totalVolumeKg).toLocaleString()} kg`}
              />
            </div>
          </Panel>

          {/* FIT metrics */}
          {fit && (
            <Panel variant="amber" title="FIT data">
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                {fit.sport && <Row k="Sport" v={fit.sport} />}
                {fit.distance != null && (
                  <Row
                    k="Distance"
                    v={(() => {
                      const d = convertForDisplay(fit.distance, 'm', system);
                      return d.unit === 'mi'
                        ? `${d.value.toFixed(2)} mi`
                        : `${(fit.distance / 1000).toFixed(2)} km`;
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
              <div className="mt-3 text-[10px] font-mono text-ink-500 italic">
                Imported from a FIT file. Graphs (pace / HR / elevation / splits) coming once we add chart support.
              </div>
            </Panel>
          )}

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