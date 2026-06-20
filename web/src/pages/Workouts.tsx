import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { formatRelative, formatSeconds, classNames } from '@/lib/format';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import type { Workout, WorkoutType } from '@/lib/types';
import { type UnitSystem } from '@/lib/units';
import { musclesForExercise, loadForExercise } from '@/lib/muscles';
import { ExerciseAutocomplete } from '@/components/ExerciseAutocomplete';

function kgToLb(kg: number): number {
  return kg * 2.20462;
}
function lbToKg(lb: number): number {
  return lb / 2.20462;
}

const TYPE_OPTIONS: { value: WorkoutType; label: string; color: 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet' }[] = [
  { value: 'STRENGTH', label: 'Strength', color: 'cyan' },
  { value: 'HYPERTROPHY', label: 'Hypertrophy', color: 'magenta' },
  { value: 'CALISTHENICS', label: 'Calisthenics', color: 'lime' },
  { value: 'CARDIO', label: 'Cardio', color: 'amber' },
  { value: 'MOBILITY', label: 'Mobility', color: 'violet' },
  { value: 'OTHER', label: 'Other', color: 'cyan' },
];

type DraftSet = {
  reps: number;
  weight: number;  // displayed in user's preferred unit (kg or lb)
  duration: number;  // seconds (for timed sets)
  rpe: number;
};

type DraftExercise = { name: string; sets: DraftSet[] };

function emptyExercise(): DraftExercise {
  return { name: '', sets: [{ reps: 0, weight: 0, duration: 0, rpe: 0 }] };
}

// Convert weight entered in user's preferred unit back to kg for storage.
function weightToKg(displayed: number, units: UnitSystem): number | undefined {
  if (!displayed) return undefined;
  if (units === 'IMPERIAL') return lbToKg(displayed);
  return displayed;
}

function weightFromKg(storedKg: number | null | undefined, units: UnitSystem): number {
  if (storedKg == null) return 0;
  if (units === 'IMPERIAL') return Math.round(kgToLb(storedKg) * 10) / 10;
  return Math.round(storedKg * 10) / 10;
}

function weightUnitLabel(units: UnitSystem): string {
  return units === 'IMPERIAL' ? 'lb' : 'kg';
}

export function WorkoutsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const units: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';
  const [type, setType] = useState<WorkoutType>('STRENGTH');
  const [name, setName] = useState('');
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState('');
  const [exercises, setExercises] = useState<DraftExercise[]>([emptyExercise()]);
  const [result, setResult] = useState<any | null>(null);
  const [selectedExerciseIdx, setSelectedExerciseIdx] = useState<number | null>(null);

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
          exercises: exercises.map((e, i) => {
            const load = loadForExercise(e.name);
            const bodyweight = user?.weightKg ?? null;
            return {
              name: e.name,
              order: i,
              musclesWorked: musclesForExercise(e.name),
              sets: e.sets
                .filter((s) => s.reps > 0 || s.duration > 0)
                .map((s, j) => {
                  // Compute the effective weight:
                  //  - BODYWEIGHT: just bodyweight, no input
                  //  - WEIGHTED_BODYWEIGHT: bodyweight + extra
                  //  - FREE_WEIGHT/MACHINE/OTHER: just the input
                  let weight: number | undefined;
                  if (load === 'BODYWEIGHT' && bodyweight) {
                    weight = bodyweight;
                  } else if (load === 'WEIGHTED_BODYWEIGHT' && bodyweight) {
                    weight = bodyweight + weightToKg(s.weight, units)!;
                  } else {
                    weight = weightToKg(s.weight, units);
                  }
                  return {
                    reps: s.reps,
                    weight: weight || undefined,
                    duration: s.duration || undefined,
                    rpe: s.rpe || undefined,
                    order: j,
                    completed: true,
                  };
                }),
            };
          }),
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
      qc.invalidateQueries({ queryKey: ['raids'] });
      qc.invalidateQueries({ queryKey: ['status'] });
      qc.invalidateQueries({ queryKey: ['quest-worlds'] });
      qc.invalidateQueries({ queryKey: ['quest-world'] });
      // Auto-recheck quest thresholds so any newly-cleared levels
      // are reflected in the UI.
      api('/quest/check', { method: 'POST' })
        .then(() => {
          qc.invalidateQueries({ queryKey: ['quest-worlds'] });
          qc.invalidateQueries({ queryKey: ['quest-world'] });
        })
        .catch(() => {});
      setExercises([emptyExercise()]);
      setName('');
      setNotes('');
    },
  }, 1500);

  const isStrength = type === 'STRENGTH' || type === 'HYPERTROPHY' || type === 'CALISTHENICS';
  const isCardio = type === 'CARDIO';
  const isTimed = type === 'MOBILITY' || type === 'OTHER';

  return (
    <Layout>
      <PageHeader title="// Workouts" subtitle="Log a session. Auto-detect PRs. Gain XP." />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4 md:gap-6">
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
              {exercises.map((ex, i) => {
                const muscles = musclesForExercise(ex.name);
                const load = loadForExercise(ex.name);
                const isBw = load === 'BODYWEIGHT';
                const isWeightedBw = load === 'WEIGHTED_BODYWEIGHT';
                // For weighted bodyweight: weight input = extra on top of bodyweight
                // For bodyweight: weight input disabled, use profile bodyweight
                const showWeight = isStrength && !isBw;
                const showDuration = isCardio || isTimed;
                const bodyweightDisplay = units === 'IMPERIAL'
                  ? Math.round(kgToLb(user?.weightKg ?? 0))
                  : Math.round(user?.weightKg ?? 0);
                return (
                  <div key={i} className="border border-ink-500/30 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <ExerciseAutocomplete
                        className="flex-1"
                        value={ex.name}
                        onChange={(v) => {
                          const copy = [...exercises];
                          copy[i] = { ...copy[i], name: v };
                          setExercises(copy);
                        }}
                        placeholder="Exercise name (start typing…)"
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
                    {muscles.length > 0 && (
                      <div className="text-[10px] font-mono text-ink-400 leading-relaxed">
                        <span className="text-neon-cyan/70">→ muscles:</span>{' '}
                        {muscles.slice(0, 8).map((m) => (
                          <span key={m} className="text-ink-200 mr-2">{m.replace(/_/g, ' ').toLowerCase()}</span>
                        ))}
                        {muscles.length > 8 && <span className="text-ink-500">+{muscles.length - 8} more</span>}
                      </div>
                    )}
                    {isBw && user?.weightKg && (
                      <div className="text-[10px] font-mono text-neon-lime/80">
                        ⚖ bodyweight exercise · weight = profile ({bodyweightDisplay} {weightUnitLabel(units)}) · input disabled
                      </div>
                    )}
                    {isWeightedBw && user?.weightKg && (
                      <div className="text-[10px] font-mono text-neon-amber/80">
                        ⚖ weighted · effective load = bodyweight ({bodyweightDisplay} {weightUnitLabel(units)}) + extra you enter below
                      </div>
                    )}
                    <div className="space-y-1">
                      {ex.sets.map((s, j) => (
                        <div
                          key={j}
                          className={classNames(
                            'gap-2 items-center',
                            // Mobile: stack vertically. Desktop: 5 or 6 columns.
                            showDuration
                              ? 'grid grid-cols-1 sm:grid-cols-[20px_1fr_1fr_1fr_30px]'
                              : 'grid grid-cols-1 sm:grid-cols-[20px_1fr_1fr_1fr_1fr_30px]',
                          )}
                        >
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
                          {showWeight ? (
                            <div className="relative">
                              {isWeightedBw && (
                                <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] font-mono text-neon-amber pointer-events-none">+</span>
                              )}
                              <input
                                className={classNames(
                                  'input-neon text-xs',
                                  isWeightedBw && 'pl-3',
                                )}
                                type="number"
                                step="0.5"
                                placeholder={weightUnitLabel(units)}
                                value={s.weight || ''}
                                onChange={(e) => {
                                  const copy = [...exercises];
                                  copy[i].sets[j] = { ...s, weight: Number(e.target.value) };
                                  setExercises(copy);
                                }}
                                title={
                                  isWeightedBw
                                    ? `Extra weight on top of bodyweight (${bodyweightDisplay} ${weightUnitLabel(units)})`
                                    : `Weight in ${weightUnitLabel(units)}`
                                }
                              />
                            </div>
                          ) : !isStrength ? (
                            <input
                              className="input-neon text-xs opacity-40 cursor-not-allowed"
                              type="number"
                              disabled
                              placeholder="—"
                              title="Weight doesn't apply to this workout type"
                            />
                          ) : (
                            // Bodyweight: weight column greyed out, value not stored
                            <input
                              className="input-neon text-xs opacity-40 cursor-not-allowed"
                              type="number"
                              disabled
                              placeholder="BW"
                              title="Bodyweight exercise — uses your profile bodyweight"
                            />
                          )}
                          {showDuration ? (
                            <input
                              className="input-neon text-xs"
                              type="number"
                              placeholder="min"
                              value={s.duration ? Math.round(s.duration / 60) : ''}
                              onChange={(e) => {
                                const copy = [...exercises];
                                copy[i].sets[j] = { ...s, duration: Number(e.target.value) * 60 };
                                setExercises(copy);
                              }}
                            />
                          ) : (
                            <input
                              className="input-neon text-xs opacity-40 cursor-not-allowed"
                              type="number"
                              disabled
                              placeholder="—"
                              title="Duration doesn't apply to this workout type"
                            />
                          )}
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
                );
              })}
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
              {result && !createM.isPending && (
                <div className="border border-neon-lime/40 bg-neon-lime/5 px-3 py-2 text-xs font-mono flex-1">
                  <div className="flex items-center flex-wrap gap-x-4 gap-y-1">
                    <span className="text-neon-lime font-display tracking-widest">✓ COMMITTED</span>
                    <span className="text-neon-lime">+{result.rewards.xp} XP</span>
                    <span className="text-neon-amber">+{result.rewards.gold} G</span>
                    <span className="text-ink-300">lvl {result.rewards.level}</span>
                    {result.rewards.prs.length > 0 && (
                      <span className="neon-text-amber">
                        {result.rewards.prs.length} PR{result.rewards.prs.length > 1 ? 's' : ''}!
                      </span>
                    )}
                  </div>
                  {result.raid?.damage && result.raid.damage.total > 0 && (
                    <div className="text-neon-magenta mt-1">
                      ⚔ {result.raid.damage.total} dmg
                      {result.raid.damage.crit > 0 && (
                        <span className="neon-text-amber ml-1">({result.raid.damage.crit} crit!)</span>
                      )}
                      {result.raid.damage.evade > 0 && (
                        <span className="text-ink-300 ml-1">({result.raid.damage.evade} evaded)</span>
                      )}
                      {result.raid.damage.shield > 0 && (
                        <span className="neon-text-periwinkle ml-1">+{result.raid.damage.shield} shield</span>
                      )}
                      {result.raid.contribution ? (
                        <span className="text-ink-400 ml-1">→ raid #{result.raid.contribution.raidId.slice(-6)}</span>
                      ) : (
                        <span className="text-ink-500 ml-1 italic">(no active raid — start one from /party)</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </Panel>

        {/* History */}
        <Panel variant="magenta" title="History">
          <div className="space-y-2 max-h-[70vh] overflow-y-auto">
            {(list.data?.items || []).map((w) => {
              const totalVolume = w.exercises.reduce((acc, ex) => {
                return acc + ex.sets.reduce((s, set) => s + (set.weight ?? 0) * set.reps, 0);
              }, 0);
              const volDisplay = units === 'IMPERIAL'
                ? Math.round(kgToLb(totalVolume))
                : Math.round(totalVolume);
              return (
                <div key={w.id} className="border border-ink-500/30 p-2 text-xs font-mono">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-display tracking-wider text-neon-cyan">
                      {w.name || w.type}
                    </span>
                    <span className="text-ink-400">{formatRelative(w.performedAt)}</span>
                  </div>
                  <div className="text-ink-300 text-[10px]">
                    {w.exercises.length} exercise{w.exercises.length !== 1 ? 's' : ''} · {w.duration ?? 0}m
                    {volDisplay > 0 && (
                      <span className="ml-2 text-neon-cyan">{volDisplay.toLocaleString()} {weightUnitLabel(units)} vol</span>
                    )}
                  </div>
                  <div className="text-ink-500 text-[10px] mt-0.5 truncate">
                    {w.exercises.slice(0, 3).map((ex) => ex.name).filter(Boolean).join(' · ')}
                    {w.exercises.length > 3 && ` +${w.exercises.length - 3} more`}
                  </div>
                  {w.notes && <div className="text-ink-400 text-[10px] mt-1 italic">"{w.notes}"</div>}
                </div>
              );
            })}
            {(list.data?.items || []).length === 0 && (
              <div className="text-xs text-ink-300 font-mono text-center py-4">
                No sessions logged yet.
                <br />
                <span className="text-ink-500 text-[10px]">Fill in the form on the left and hit Commit.</span>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </Layout>
  );
}
