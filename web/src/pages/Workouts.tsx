import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { formatRelative, formatSeconds, classNames } from '@/lib/format';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import type { Workout, WorkoutType } from '@/lib/types';

const TYPE_OPTIONS: { value: WorkoutType; label: string; color: 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet' }[] = [
  { value: 'STRENGTH', label: 'Strength', color: 'cyan' },
  { value: 'HYPERTROPHY', label: 'Hypertrophy', color: 'magenta' },
  { value: 'CALISTHENICS', label: 'Calisthenics', color: 'lime' },
  { value: 'CARDIO', label: 'Cardio', color: 'amber' },
  { value: 'MOBILITY', label: 'Mobility', color: 'violet' },
  { value: 'OTHER', label: 'Other', color: 'cyan' },
];

type DraftExercise = { name: string; sets: { reps: number; weight: number; duration: number; rpe: number }[] };

function emptyExercise(): DraftExercise {
  return { name: '', sets: [{ reps: 0, weight: 0, duration: 0, rpe: 0 }] };
}

export function WorkoutsPage() {
  const qc = useQueryClient();
  const [type, setType] = useState<WorkoutType>('STRENGTH');
  const [name, setName] = useState('');
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState('');
  const [exercises, setExercises] = useState<DraftExercise[]>([emptyExercise()]);
  const [result, setResult] = useState<any | null>(null);

  const list = useQuery({
    queryKey: ['workouts'],
    queryFn: () => api<{ items: Workout[]; total: number }>('/workouts?limit=50'),
  });

  const createM = useDelayedMutation({
    mutationFn: () =>
      api<any>('/workouts', {
        method: 'POST',
        body: {
          type,
          name: name || undefined,
          duration,
          notes: notes || undefined,
          exercises: exercises.map((e, i) => ({
            name: e.name,
            order: i,
            sets: e.sets
              .filter((s) => s.reps > 0 || s.duration > 0)
              .map((s, j) => ({
                reps: s.reps,
                weight: s.weight || undefined,
                duration: s.duration || undefined,
                rpe: s.rpe || undefined,
                order: j,
                completed: true,
              })),
          })),
        },
      }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['workouts'] });
      qc.invalidateQueries({ queryKey: ['prs'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['genetic-max'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      setExercises([emptyExercise()]);
      setName('');
      setNotes('');
    },
  }, 1500);

  return (
    <Layout>
      <PageHeader title="// Workouts" subtitle="Log a session. Auto-detect PRs. Gain XP." />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
        {/* Form */}
        <Panel variant="cyan" title="Log Session" scanline>
          <div className="space-y-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 mb-1.5">Type</div>
              <div className="flex flex-wrap gap-2">
                {TYPE_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setType(t.value)}
                    className={classNames(
                      'px-3 py-1.5 text-xs font-display tracking-widest uppercase border transition-all',
                      type === t.value
                        ? `border-neon-${t.color}/80 text-neon-${t.color} bg-neon-${t.color}/10`
                        : 'border-ink-500/40 text-ink-300 hover:border-ink-300'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
                  Name (optional)
                </label>
                <input
                  className="input-neon"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Push Day A"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
                  Duration (min)
                </label>
                <input
                  className="input-neon"
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  min={0}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">Exercises</div>
              {exercises.map((ex, i) => (
                <div key={i} className="border border-ink-500/30 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      className="input-neon flex-1"
                      placeholder="Exercise name (e.g. Bench Press)"
                      value={ex.name}
                      onChange={(e) => {
                        const copy = [...exercises];
                        copy[i] = { ...copy[i], name: e.target.value };
                        setExercises(copy);
                      }}
                    />
                    {exercises.length > 1 && (
                      <button
                        onClick={() => setExercises(exercises.filter((_, j) => j !== i))}
                        className="btn-ghost"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {ex.sets.map((s, j) => (
                      <div key={j} className="grid grid-cols-[20px_1fr_1fr_1fr_1fr_30px] gap-2 items-center">
                        <span className="text-[10px] font-mono text-ink-400">#{j + 1}</span>
                        <input
                          className="input-neon text-xs"
                          type="number"
                          placeholder="reps"
                          value={s.reps || ''}
                          onChange={(e) => {
                            const copy = [...exercises];
                            copy[i].sets[j] = { ...s, reps: Number(e.target.value) };
                            setExercises(copy);
                          }}
                        />
                        <input
                          className="input-neon text-xs"
                          type="number"
                          step="0.5"
                          placeholder="kg"
                          value={s.weight || ''}
                          onChange={(e) => {
                            const copy = [...exercises];
                            copy[i].sets[j] = { ...s, weight: Number(e.target.value) };
                            setExercises(copy);
                          }}
                        />
                        <input
                          className="input-neon text-xs"
                          type="number"
                          placeholder="sec"
                          value={s.duration || ''}
                          onChange={(e) => {
                            const copy = [...exercises];
                            copy[i].sets[j] = { ...s, duration: Number(e.target.value) };
                            setExercises(copy);
                          }}
                        />
                        <input
                          className="input-neon text-xs"
                          type="number"
                          step="0.5"
                          min="0"
                          max="10"
                          placeholder="RPE"
                          value={s.rpe || ''}
                          onChange={(e) => {
                            const copy = [...exercises];
                            copy[i].sets[j] = { ...s, rpe: Number(e.target.value) };
                            setExercises(copy);
                          }}
                        />
                        {ex.sets.length > 1 && (
                          <button
                            onClick={() => {
                              const copy = [...exercises];
                              copy[i].sets = copy[i].sets.filter((_, k) => k !== j);
                              setExercises(copy);
                            }}
                            className="text-ink-400 hover:text-neon-magenta text-xs"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const copy = [...exercises];
                        copy[i].sets.push({ reps: 0, weight: 0, duration: 0, rpe: 0 });
                        setExercises(copy);
                      }}
                      className="btn-ghost text-[10px] mt-1"
                    >
                      + Set
                    </button>
                  </div>
                </div>
              ))}
              <NeonButton
                variant="magenta"
                onClick={() => setExercises([...exercises, emptyExercise()])}
              >
                + Exercise
              </NeonButton>
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
                Notes
              </label>
              <textarea
                className="input-neon"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Felt strong, elbow a bit tweaky…"
              />
            </div>

            <div className="flex items-center gap-3">
              <NeonButton
                onClick={() => createM.run()}
                loading={createM.isPending}
                disabled={exercises.every((e) => !e.name || e.sets.every((s) => !s.reps && !s.duration))}
                icon="⚡"
                loadingText="Committing…"
              >
                Commit Session
              </NeonButton>
              {result && (
                <div className="text-xs font-mono text-neon-lime">
                  +{result.rewards.xp} XP · +{result.rewards.gold} gold · lvl {result.rewards.level}
                  {result.rewards.prs.length > 0 && (
                    <span className="neon-text-amber ml-2">
                      {result.rewards.prs.length} PR{result.rewards.prs.length > 1 ? 's' : ''}!
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </Panel>

        {/* History */}
        <Panel variant="magenta" title="History">
          <div className="space-y-2 max-h-[70vh] overflow-y-auto">
            {(list.data?.items || []).map((w) => (
              <div key={w.id} className="border border-ink-500/30 p-2 text-xs font-mono">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-display tracking-wider text-neon-cyan">
                    {w.name || w.type}
                  </span>
                  <span className="text-ink-400">{formatRelative(w.performedAt)}</span>
                </div>
                <div className="text-ink-300">
                  {w.exercises.length} exercise{w.exercises.length !== 1 ? 's' : ''} · {w.duration ?? 0}m
                </div>
                {w.notes && <div className="text-ink-400 text-[10px] mt-1 italic">"{w.notes}"</div>}
              </div>
            ))}
            {(list.data?.items || []).length === 0 && (
              <div className="text-xs text-ink-300 font-mono text-center py-4">No sessions logged yet.</div>
            )}
          </div>
        </Panel>
      </div>
    </Layout>
  );
}
