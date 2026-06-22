import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { classNames } from '@/lib/format';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import type { WorkoutType } from '@/lib/types';
import type { UnitSystem } from '@/lib/units';
import { musclesForExercise, loadForExercise } from '@/lib/muscles';
import { ExerciseAutocomplete } from '@/components/ExerciseAutocomplete';
import { RestTimer, REST_PRESETS } from '@/components/RestTimer';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';

// =============================================================================
// Shared types + helpers used by both Activities page and TeamWorkout panes.
// =============================================================================

type DraftSet = {
  reps: number;
  /// Displayed in user's preferred unit (kg or lb). Converted back
  /// to kg at submit time via weightToKg().
  weight: number;
  /// Seconds. For timed sets (plank, l-sit, etc.).
  duration: number;
  rpe: number;
};

type DraftExercise = { name: string; sets: DraftSet[] };

export function emptyExercise(): DraftExercise {
  return { name: '', sets: [{ reps: 0, weight: 0, duration: 0, rpe: 0 }] };
}

const TYPE_OPTIONS: { value: WorkoutType; label: string; color: 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet' }[] = [
  { value: 'STRENGTH', label: 'Strength', color: 'cyan' },
  { value: 'HYPERTROPHY', label: 'Hypertrophy', color: 'magenta' },
  { value: 'CALISTHENICS', label: 'Calisthenics', color: 'lime' },
  { value: 'CARDIO', label: 'Cardio', color: 'amber' },
  { value: 'MOBILITY', label: 'Mobility', color: 'violet' },
  { value: 'OTHER', label: 'Other', color: 'cyan' },
];

function kgToLb(kg: number): number { return kg * 2.20462; }
function lbToKg(lb: number): number { return lb / 2.20462; }
function weightToKg(displayed: number, units: UnitSystem): number | undefined {
  if (!displayed) return undefined;
  return units === 'IMPERIAL' ? lbToKg(displayed) : displayed;
}
function weightUnitLabel(units: UnitSystem): string {
  return units === 'IMPERIAL' ? 'lb' : 'kg';
}
function distanceUnit(units: UnitSystem): string {
  return units === 'IMPERIAL' ? 'mi' : 'km';
}
function distanceInputToKm(val: number, units: UnitSystem): number {
  return units === 'IMPERIAL' ? val * 1.609344 : val;
}

// datetime-local format helpers. The native input always uses
// local time (no timezone), so the round-trip via toISOString
// would lose the user's wall-clock selection.
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(s: string): string {
  return new Date(s).toISOString();
}

// Cardio (non-set) block. Used by CARDIO type or by freeform
// types that include a distance component (e.g. "hike").
type CardioPace =
  | 'WALK_CASUAL' | 'WALK_BRISK' | 'JOG' | 'RUN' | 'SPRINT' | 'CRUISE' | 'INTERVALS';

type DraftCardio = {
  distanceKm: string;
  duration: string;
  pace: CardioPace | '';
  elevationGainM: string;
  avgHr: string;
  maxHr: string;
  source: 'MANUAL' | 'GPS';
};

function emptyCardio(): DraftCardio {
  return { distanceKm: '', duration: '', pace: '', elevationGainM: '', avgHr: '', maxHr: '', source: 'MANUAL' };
}

function parseDuration(s: string): number | null {
  if (!s || !s.trim()) return null;
  const parts = s.trim().split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}
function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function hasUsableContent(
  type: WorkoutType,
  exercises: DraftExercise[],
  cardio: DraftCardio,
  name: string,
  duration: number,
): boolean {
  if (type === 'STRENGTH' || type === 'HYPERTROPHY' || type === 'CALISTHENICS') {
    return exercises.some((e) => e.name.trim() && e.sets.some((s) => s.reps > 0 || s.duration > 0));
  }
  if (type === 'CARDIO') {
    const dist = Number(cardio.distanceKm);
    const dur = parseDuration(cardio.duration);
    return (Number.isFinite(dist) && dist > 0) || (dur != null && dur > 0);
  }
  return name.trim().length > 0 && duration > 0;
}

// =============================================================================
// Props for <WorkoutLogger>
// =============================================================================

export type WorkoutLoggerProps = {
  /// User, for bodyweight-derived set weights.
  user: { id: string; weightKg?: number | null } | null;
  /// Display unit (kg/lb). Falls back to METRIC.
  units: UnitSystem;
  /// Optional panel title. Defaults to "Log Session".
  title?: string;
  /// Optional initial type. Defaults to STRENGTH.
  initialType?: WorkoutType;
  /// Compact mode (team-workout split-pane): smaller labels, no
  /// recent-workouts block, no copy-last button, no performed-at
  /// presets (assumes "now"), no notes, no commit-result banner
  /// (parent renders its own outcome). Same form shape so the
  /// user doesn't have to relearn anything.
  compact?: boolean;
  /// Called AFTER a successful create with the new workout id.
  /// The parent (Activities page, TeamWorkout pane) handles
  /// navigation, banner display, and cross-pane state. If
  /// omitted, the logger just clears its form.
  onCommit?: (workoutId: string, response: any) => void;
  /// Optional ref to the most-recent workout from this user's
  /// history (used for the copy-last shortcut). Ignored in compact.
  copyFrom?: any;
};

// =============================================================================
// Component
// =============================================================================

export function WorkoutLogger({
  user, units, title = 'Log Session', initialType = 'STRENGTH', compact = false, onCommit, copyFrom,
}: WorkoutLoggerProps) {
  const qc = useQueryClient();
  const [type, setType] = useState<WorkoutType>(initialType);
  const [name, setName] = useState('');
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState('');
  const [performedAt, setPerformedAt] = useState<string>(() => toLocalInput(new Date()));
  const [cardio, setCardio] = useState<DraftCardio>(emptyCardio());
  const [cardioOpen, setCardioOpen] = useState(false);
  const [exercises, setExercises] = useState<DraftExercise[]>([emptyExercise()]);
  const [result, setResult] = useState<any | null>(null);

  // Apply `copyFrom` once on mount. Used by the ActivityDetail
  // page to pre-fill from a past workout via ?copyFrom=<id>.
  useEffect(() => {
    if (!copyFrom) return;
    setExercises(workoutToDraft(copyFrom, units));
    setName(copyFrom.name ? `${copyFrom.name} (copy)` : '');
    setDuration(copyFrom.duration ?? 60);
    setNotes(copyFrom.notes ?? '');
    if (copyFrom.type === 'CARDIO') {
      setCardio((copyFrom as any).cardio ? cardioToDraft((copyFrom as any).cardio, units) : emptyCardio());
      setCardioOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyFrom?.id]);

  const isStrength = type === 'STRENGTH' || type === 'HYPERTROPHY' || type === 'CALISTHENICS';
  const isCardio = type === 'CARDIO';
  const isTimed = type === 'MOBILITY' || type === 'OTHER';

  const createM = useDelayedMutation({
    mutationFn: () => {
      const cardioBody = buildCardioBody(cardio, units);
      const realExercises = exercises.filter(
        (e) => e.name.trim() && e.sets.some((s) => s.reps > 0 || s.duration > 0),
      );
      return api<any>('/workouts', {
        method: 'POST',
        body: {
          type,
          name: name || undefined,
          duration,
          notes: compact ? undefined : (notes || undefined),
          // Compact mode forces "now" so the team session timeline
          // stays clean. Full mode honors the picker.
          performedAt: compact ? new Date().toISOString() : localInputToIso(performedAt),
          cardio: cardioBody ?? undefined,
          exercises: realExercises.map((e, i) => {
            const load = loadForExercise(e.name);
            const bodyweight = user?.weightKg ?? null;
            return {
              name: e.name,
              order: i,
              musclesWorked: musclesForExercise(e.name),
              sets: e.sets
                .filter((s) => s.reps > 0 || s.duration > 0)
                .map((s, j) => {
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
      });
    },
    onSuccess: (r) => {
      setResult(r);
      // Compact panes rely on the parent to refetch / refresh.
      // Full-mode pages refresh their own queries.
      if (!compact) {
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
        api('/quest/check', { method: 'POST' })
          .then(() => {
            qc.invalidateQueries({ queryKey: ['quest-worlds'] });
            qc.invalidateQueries({ queryKey: ['quest-world'] });
          })
          .catch(() => {});
      }
      setExercises([emptyExercise()]);
      setName('');
      setNotes('');
      setCardio(emptyCardio());
      setCardioOpen(false);
      setPerformedAt(toLocalInput(new Date()));
      if (onCommit) onCommit(r.workout?.id ?? '', r);
    },
  }, compact ? 600 : 1500);

  const wrapperClass = compact ? 'space-y-3' : 'space-y-4';

  return (
    <Panel
      variant="cyan"
      title={title}
      scanline
      action={!compact ? (
        copyFrom ? (
          <span className="text-[10px] font-mono text-neon-cyan tracking-widest uppercase">⎘ from copy</span>
        ) : null
      ) : null}
    >
      <div className={wrapperClass}>
        {/* Rest timer — shared global instance; the rest of the
            app dispatches CustomEvents to drive it. We only show
            the shortcut buttons (full mode); compact mode skips
            these to save vertical space (the global timer is still
            reachable from anywhere via the icon in the top bar). */}
        {!compact && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
                Rest timer
              </div>
              <div className="text-[9px] font-mono text-ink-400">30s · 60s · 90s · 2m · 3m · 5m</div>
            </div>
            <div className="flex items-center gap-2">
              <RestTimer />
              <div className="flex gap-1">
                {REST_PRESETS.map((p) => (
                  <button
                    key={p.seconds}
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('set-rest', { detail: p.seconds }))}
                    className="px-2 h-8 text-[10px] font-mono border border-ink-500/40 text-ink-300 hover:border-ink-300"
                    title={`Set timer to ${p.label}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 mb-1.5">Type</div>
          <div className="flex flex-wrap gap-2">
            {TYPE_OPTIONS.map((t) => (
              <button
                key={t.value}
                onClick={() => {
                  setType(t.value);
                  if (t.value === 'CARDIO' && !cardioOpen) setCardioOpen(true);
                }}
                className={classNames(
                  compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs',
                  'font-display tracking-widest uppercase border transition-all',
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

        {/* Form sections — only one renders at a time based on type */}
        {isStrength && (
          <div className="space-y-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">Exercises</div>
            {exercises.map((ex, i) => {
              const muscles = musclesForExercise(ex.name);
              const load = loadForExercise(ex.name);
              const isBw = load === 'BODYWEIGHT';
              const isWeightedBw = load === 'WEIGHTED_BODYWEIGHT';
              const showWeight = isStrength && !isBw;
              const bodyweightDisplay = units === 'IMPERIAL'
                ? Math.round(kgToLb(user?.weightKg ?? 0))
                : Math.round(user?.weightKg ?? 0);
              return (
                <div key={i} className="border border-ink-500/30 p-2 space-y-2">
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
                      <button onClick={() => setExercises(exercises.filter((_, j) => j !== i))} className="btn-ghost">✕</button>
                    )}
                  </div>
                  {!compact && muscles.length > 0 && (
                    <div className="text-[10px] font-mono text-ink-400 leading-relaxed">
                      <span className="text-neon-cyan/70">→ muscles:</span>{' '}
                      {muscles.slice(0, 8).map((m) => (
                        <span key={m} className="text-ink-200 mr-2">{m.replace(/_/g, ' ').toLowerCase()}</span>
                      ))}
                      {muscles.length > 8 && <span className="text-ink-500">+{muscles.length - 8} more</span>}
                    </div>
                  )}
                  {!compact && isBw && user?.weightKg && (
                    <div className="text-[10px] font-mono text-neon-lime/80">
                      ⚖ bodyweight · weight = profile ({bodyweightDisplay} {weightUnitLabel(units)}) · input disabled
                    </div>
                  )}
                  {!compact && isWeightedBw && user?.weightKg && (
                    <div className="text-[10px] font-mono text-neon-amber/80">
                      ⚖ weighted · effective load = bodyweight ({bodyweightDisplay} {weightUnitLabel(units)}) + extra you enter below
                    </div>
                  )}
                  <div className="space-y-1">
                    {ex.sets.map((s, j) => (
                      <div
                        key={j}
                        className={classNames(
                          compact
                            ? 'grid grid-cols-[20px_1fr_1fr_1fr_24px] gap-1.5 items-center'
                            : 'gap-2 items-center grid grid-cols-1 sm:grid-cols-[20px_1fr_1fr_1fr_1fr_30px]',
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
                              className={classNames('input-neon text-xs', isWeightedBw && 'pl-3')}
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
                        ) : isBw ? (
                          <input className="input-neon text-xs opacity-40 cursor-not-allowed" type="number" disabled placeholder="BW" />
                        ) : (
                          <input className="input-neon text-xs opacity-40 cursor-not-allowed" type="number" disabled placeholder="—" />
                        )}
                        {compact ? (
                          <input
                            className="input-neon text-xs"
                            type="number"
                            placeholder="RPE"
                            value={s.rpe || ''}
                            onChange={(e) => {
                              const copy = [...exercises];
                              copy[i].sets[j] = { ...s, rpe: Number(e.target.value) };
                              setExercises(copy);
                            }}
                          />
                        ) : (
                          <>
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
                            <input
                              className="input-neon text-xs"
                              type="number"
                              step="0.5"
                              min={0}
                              max={10}
                              placeholder="RPE"
                              value={s.rpe || ''}
                              onChange={(e) => {
                                const copy = [...exercises];
                                copy[i].sets[j] = { ...s, rpe: Number(e.target.value) };
                                setExercises(copy);
                              }}
                            />
                          </>
                        )}
                        {ex.sets.length > 1 ? (
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
                        ) : (
                          <span />
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
            <NeonButton variant="magenta" onClick={() => setExercises([...exercises, emptyExercise()])}>
              + Exercise
            </NeonButton>
          </div>
        )}

        {isCardio && (
          <CardioBlockInline
            cardio={cardio}
            setCardio={setCardio}
            open={cardioOpen}
            setOpen={setCardioOpen}
            units={units}
            compact={compact}
          />
        )}

        {isTimed && !compact && (
          <div className="border border-neon-violet/30 p-3 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-neon-violet/80">
              ◌ Freeform activity
              <span className="text-ink-500 normal-case tracking-normal ml-2">
                · {type === 'MOBILITY' ? 'mobility / stretching / yoga' : 'misc: jumprope, climbing, hike, …'}
              </span>
            </div>
            <div className="text-[10px] font-mono text-ink-400">
              The "Name" + "Duration" fields above define this session.
            </div>
          </div>
        )}

        {/* Performed-at picker — full mode only. Compact forces "now"
            so the team-session timeline stays synchronized. */}
        {!compact && (
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
              Performed at
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input-neon flex-1 min-w-[200px]"
                type="datetime-local"
                value={performedAt}
                onChange={(e) => setPerformedAt(e.target.value)}
              />
              {[
                { label: 'Now', minutes: 0 },
                { label: '−1h', minutes: 60 },
                { label: '−3h', minutes: 180 },
                { label: 'Yesterday', minutes: 60 * 24 },
                { label: '−2d', minutes: 60 * 48 },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setPerformedAt(toLocalInput(new Date(Date.now() - p.minutes * 60_000)))}
                  className="px-2 h-8 text-[10px] font-mono border border-ink-500/40 text-ink-300 hover:border-ink-300"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={compact ? 'space-y-2' : 'grid grid-cols-2 gap-3'}>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
              Name {compact ? '' : '(optional)'}
            </label>
            <input
              className="input-neon"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={compact ? 'Push Day A' : 'Push Day A'}
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

        {/* Notes — full mode only. Compact: skip; the team's shared
            notes come from the session-level recap instead. */}
        {!compact && (
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
        )}

        <div className="flex items-center gap-3">
          <NeonButton
            onClick={() => createM.run()}
            loading={createM.isPending}
            disabled={!hasUsableContent(type, exercises, cardio, name, duration)}
            icon={compact ? undefined : '⚡'}
            loadingText="Committing…"
          >
            {compact ? 'Log session' : 'Commit Session'}
          </NeonButton>
          {result && !createM.isPending && !compact && (
            <div className="border border-neon-lime/40 bg-neon-lime/5 px-3 py-2 text-xs font-mono flex-1">
              <div className="flex items-center flex-wrap gap-x-4 gap-y-1">
                <span className="text-neon-lime font-display tracking-widest">✓ COMMITTED</span>
                <span className="text-neon-lime">+{result.rewards?.xp ?? 0} XP</span>
                <span className="text-neon-amber">+{result.rewards?.gold ?? 0} G</span>
                {result.rewards?.prs?.length > 0 && (
                  <span className="neon-text-amber">{result.rewards.prs.length} PR!</span>
                )}
              </div>
              {result.raid?.damage && result.raid.damage.total > 0 && (
                <div className="text-neon-magenta mt-1">⚔ {result.raid.damage.total} dmg</div>
              )}
            </div>
          )}
          {result && !createM.isPending && compact && onCommit && (
            <div className="border border-neon-lime/40 bg-neon-lime/5 px-2 py-1 text-[10px] font-mono neon-text-lime">
              ✓ logged
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

// =============================================================================
// Cardio block (inline version, simplified from the original CardioBlock)
// =============================================================================

function CardioBlockInline({
  cardio, setCardio, open, setOpen, units, compact,
}: {
  cardio: DraftCardio;
  setCardio: (c: DraftCardio) => void;
  open: boolean;
  setOpen: (b: boolean) => void;
  units: UnitSystem;
  compact: boolean;
}) {
  const distNum = Number(cardio.distanceKm);
  const durSec = parseDuration(cardio.duration);
  const distKm = Number.isFinite(distNum) && distNum > 0 ? distanceInputToKm(distNum, units) : null;
  const pace = distKm != null && durSec != null ? Math.round(durSec / distKm) : null;
  const paceDisplay = pace != null
    ? units === 'IMPERIAL' ? `${formatDuration(Math.round(pace * 1.609344))}/mi` : `${formatDuration(pace)}/km`
    : null;
  const preview = distKm != null && durSec != null
    ? `→ ${distKm.toFixed(2)} km · ${formatDuration(durSec)}${paceDisplay ? ` · ${paceDisplay}` : ''}`
    : null;
  return (
    <div className="border border-neon-amber/30 p-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="text-[10px] font-mono uppercase tracking-widest text-neon-amber/80">
          ⚡ Cardio block
        </div>
        <span className="text-[10px] font-mono text-ink-400">{open ? '▾' : '▸'}</span>
      </button>
      {!open ? (
        preview && <div className="mt-1 text-[10px] font-mono text-ink-300">{preview}</div>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] uppercase text-slate-500">Distance ({distanceUnit(units)})</span>
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                type="number" step="0.01" min="0"
                value={cardio.distanceKm}
                onChange={(e) => setCardio({ ...cardio, distanceKm: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase text-slate-500">Duration</span>
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm font-mono"
                type="text" placeholder="32:14"
                value={cardio.duration}
                onChange={(e) => setCardio({ ...cardio, duration: e.target.value })}
              />
            </label>
          </div>
          {!compact && (
            <>
              <div>
                <div className="text-[10px] uppercase text-slate-500 mb-1">Pace</div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setCardio({ ...cardio, pace: '' })}
                    className={classNames(
                      'px-2 py-1 text-[10px] font-mono border',
                      cardio.pace === '' ? 'border-amber-400 text-amber-300 bg-amber-400/10' : 'border-ink-500/30 text-ink-300 hover:border-ink-300',
                    )}
                  >
                    none
                  </button>
                  {(['WALK_CASUAL', 'WALK_BRISK', 'JOG', 'RUN', 'SPRINT', 'CRUISE', 'INTERVALS'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setCardio({ ...cardio, pace: p })}
                      className={classNames(
                        'px-2 py-1 text-[10px] font-mono border',
                        cardio.pace === p ? 'border-amber-400 text-amber-300 bg-amber-400/10' : 'border-ink-500/30 text-ink-300 hover:border-ink-300',
                      )}
                    >
                      {p.replace(/_/g, ' ').toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-[10px] uppercase text-slate-500">Elev gain (m)</span>
                  <input className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" type="number" min="0" value={cardio.elevationGainM} onChange={(e) => setCardio({ ...cardio, elevationGainM: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase text-slate-500">Avg HR</span>
                  <input className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" type="number" min="0" value={cardio.avgHr} onChange={(e) => setCardio({ ...cardio, avgHr: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase text-slate-500">Max HR</span>
                  <input className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" type="number" min="0" value={cardio.maxHr} onChange={(e) => setCardio({ ...cardio, maxHr: e.target.value })} />
                </label>
              </div>
            </>
          )}
          {preview && <div className="text-[10px] font-mono text-amber-300">{preview}</div>}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Helpers exposed for callers + reuse
// =============================================================================

export function workoutToDraft(
  w: { exercises: Array<{ name: string; sets: Array<{ reps: number; weight: number | null; duration: number | null; rpe: number | null }> }> },
  units: UnitSystem,
): DraftExercise[] {
  return w.exercises.map((ex) => ({
    name: ex.name,
    sets: ex.sets.map((s) => ({
      reps: s.reps,
      weight: s.weight != null
        ? (units === 'IMPERIAL' ? Math.round(kgToLb(s.weight) * 10) / 10 : Math.round(s.weight * 10) / 10)
        : 0,
      duration: s.duration ?? 0,
      rpe: s.rpe ?? 0,
    })),
  }));
}

export function cardioToDraft(c: any, units: UnitSystem): DraftCardio {
  return {
    distanceKm: c?.distanceKm != null
      ? String(units === 'IMPERIAL' ? c.distanceKm / 1.609344 : c.distanceKm)
      : '',
    duration: c?.durationSec != null ? formatDuration(c.durationSec) : '',
    pace: c?.pace ?? '',
    elevationGainM: c?.elevationGainM != null ? String(c.elevationGainM) : '',
    avgHr: c?.avgHr != null ? String(c.avgHr) : '',
    maxHr: c?.maxHr != null ? String(c.maxHr) : '',
    source: c?.source === 'GPS' ? 'GPS' : 'MANUAL',
  };
}

function buildCardioBody(cardio: DraftCardio, units: UnitSystem): any | null {
  const distRaw = Number(cardio.distanceKm);
  const distKm = Number.isFinite(distRaw) && distRaw > 0
    ? Math.round(distanceInputToKm(distRaw, units) * 1000) / 1000
    : null;
  const durSec = parseDuration(cardio.duration);
  if (distKm == null && durSec == null) return null;
  const elevM = Number(cardio.elevationGainM);
  const avgHr = Number(cardio.avgHr);
  const maxHr = Number(cardio.maxHr);
  const paceSecPerKm = distKm != null && durSec != null ? Math.round(durSec / distKm) : null;
  return {
    distanceKm: distKm ?? undefined,
    durationSec: durSec ?? undefined,
    pace: cardio.pace || undefined,
    elevationGainM: Number.isFinite(elevM) && elevM > 0 ? elevM : undefined,
    avgHr: Number.isFinite(avgHr) && avgHr > 0 ? Math.round(avgHr) : undefined,
    maxHr: Number.isFinite(maxHr) && maxHr > 0 ? Math.round(maxHr) : undefined,
    avgPaceSecPerKm: paceSecPerKm ?? undefined,
    source: cardio.source,
  };
}