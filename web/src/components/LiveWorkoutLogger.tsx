import { useState, useEffect, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { classNames } from '@/lib/format';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import type { WorkoutType } from '@/lib/types';
import type { UnitSystem } from '@/lib/units';
import { musclesForExercise, loadForExercise } from '@/lib/muscles';
import { ExerciseAutocomplete } from '@/components/ExerciseAutocomplete';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { Modal } from '@/components/Modal';
import {
  buildRoundRobinOrder,
  currentPositionLabel,
  type RoundEntry,
} from '@/lib/supersetRoundRobin';
import {
  emptyExercise,
  TYPE_OPTIONS,
  kgToLb,
  weightToKg,
  weightUnitLabel,
  toLocalInput,
  localInputToIso,
  formatDuration,
  type DraftExercise,
  type DraftSet,
} from './workout-types';

// =============================================================================
// LiveWorkoutLogger
// =============================================================================
//
// Enter-as-you-go workout logger. Replaces the bulk form for strength /
// hypertrophy / calisthenics. The user sets up exercises + planned set
// counts up front, taps Start, then walks through one set at a time:
//
//   ┌─ Set entry ──────────────┐   tap Continue   ┌─ Rest ──────────────┐
//   │ Squat                    │ ───────────────▶ │                     │
//   │ Set 2 / 3                │                  │   0:47 elapsed      │
//   │ [weight] [reps] [rpe]    │                  │   Set took 0:42     │
//   │ ━━━━ Continue ━━━━        │   tap Next set   │                     │
//   └──────────────────────────┘ ◀──────────────── │ ━━━━ Next set ━━━━  │
//                                                └─────────────────────┘
//
// All timestamps are captured client-side at the moment of the action so
// we can correlate with future Garmin FIT imports. restSeconds is computed
// at commit time from (nextSet.startedAt - thisSet.completedAt).
//
// Bulk mode lives in WorkoutLogger.tsx and is selected via the mode toggle
// on Activities.tsx. Live mode is the default.
// =============================================================================

export type LiveWorkoutLoggerProps = {
  user: { id: string; weightKg?: number | null } | null;
  units: UnitSystem;
  title?: string;
  initialType?: WorkoutType;
  onCommit?: (workoutId: string, response: any) => void;
  /**
   * Optional WorkoutTemplate to prefill the setup phase with. The parent
   * should also pass a unique `key` so this component remounts on
   * template change — otherwise the user picks a new template and the
   * state stays the same.
   *
   * Weight is intentionally left at 0 even if the template stored it;
   * the user said "leave weight blank" so they fill it in live.
   */
  templatePrefill?: {
    name?: string | null;
    notes?: string | null;
    type?: WorkoutType;
    exercises?: Array<{
      name: string;
      /// Superset pairing. Optional in the type so older callers
      /// (or hand-rolled prefill objects) don't have to provide it.
      groupIndex?: number | null;
      sets: Array<{
        targetReps: number;
        targetDuration?: number | null;
      }>;
    }>;
  } | null;
  /**
   * Tightens the visual density for narrow containers (e.g. the
   * team-workout split-pane). Off by default — the solo Activities
   * call site must keep the full padding/gap experience. When on:
   *   - Panel padding drops from p-4 to p-2
   *   - Section vertical rhythm drops from space-y-4 to space-y-2
   *   - Width is forced to w-full so it fills the parent column
   * No logic, state, or rendering branches are affected — purely
   * layout density.
   */
  compact?: boolean;
};

// One planned set up front. The user only configures count + a single
// target for "weight" / "reps" per exercise — actual values are entered
// at runtime as they go through the workout.
type PlannedSet = {
  targetReps: number;
  targetWeight: number;
  /** Seconds — for timed exercises (plank, run, burpees, etc).
   *  Strength sets leave this at 0. */
  targetDuration: number;
};

type PlannedExercise = {
  name: string;
  /// Superset pairing. Two exercises sharing the same groupIndex
  /// are walked round-robin by the live logger (1A → 1B → 2A → 2B).
  /// Null = walk linearly. Set by the Routines page when the user
  /// clicks "Pair with next"; carried through to the live logger
  /// via templatePrefill.
  groupIndex: number | null;
  sets: PlannedSet[];
};

type CapturedSet = {
  // Identity: where this set lives in the workout.
  exerciseIndex: number;
  setIndex: number;
  // What the user actually did.
  reps: number;
  weight: number;
  duration: number;
  rpe: number;
  // Timing — captured as ISO strings because we serialize the whole
  // list to JSON at the end and these get POSTed straight through.
  startedAt: string;
  completedAt: string;
  // Rest AFTER this set (computed at commit). null for the last set of
  // the workout (no "rest" after — the workout ended).
  restSeconds: number | null;
  // Skipped flag for live mode: tap "skip" mid-set if you need to bail
  // (e.g. equipment's taken, pain). The row is preserved in history but
  // excluded from PR/volume math, same as bulk-mode skipped sets.
  skipped?: boolean;
  skipReason?: 'INJURY' | 'ILLNESS' | 'FATIGUE' | 'EQUIPMENT' | 'SCHEDULE' | 'OTHER';
  // UI lock. When true, the captured-set row is rendered read-only
  // so a stray tap on the inputs can't overwrite the value mid-workout.
  // Per-set, not global — the user can edit earlier sets and lock
  // later ones (or vice versa) depending on how confident they are
  // in the entry. Defaults to true (capture moment is sacred — the
  // user explicitly tapped Continue, that's the lock).
  locked: boolean;
};

type Phase = 'setup' | 'live' | 'done';

const STRENGTH_TYPES: WorkoutType[] = ['STRENGTH', 'HYPERTROPHY', 'CALISTHENICS'];
// Time-based types: no per-set reps/weight. The setup phase shows
// just a duration field per exercise; live phase goes straight to
// commit when the user taps Done.
const TIMED_TYPES: WorkoutType[] = ['CARDIO', 'MOBILITY', 'OTHER'];

export function LiveWorkoutLogger({
  user, units, title = 'Log Session', initialType = 'STRENGTH', onCommit,
  templatePrefill, compact = false,
}: LiveWorkoutLoggerProps) {
  const qc = useQueryClient();

  // ── Layout-density knobs for the compact (split-pane) call site.
  // !p-2 is required because Panel hard-codes p-4 in its base classes
  // and p-4 sorts after p-2 in Tailwind's generated stylesheet, so
  // without the important modifier our override would lose. w-full
  // is technically redundant on a <section> (block default) but is
  // kept explicit per the spec so the intent reads in code review.
  const panelClass = compact ? '!p-2 w-full' : '';
  const sectionClass = compact ? 'space-y-2' : 'space-y-4';

  // ── Setup-phase state ────────────────────────────────────────────────
  // When the parent passes `templatePrefill`, seed exercises/type/notes
// from it. The parent should remount this component (via key prop)
// when the user picks a different template so we always start clean.
  const seedExercises: PlannedExercise[] = templatePrefill?.exercises?.length
    ? templatePrefill.exercises.map((ex) => ({
        name: ex.name,
        // Superset pairing flows through verbatim. Null = linear.
        groupIndex: ex.groupIndex ?? null,
        // targetWeight stays 0 — the user said "leave weight blank".
        // targetDuration carries through (for cardio / timed types).
        sets: ex.sets.map((s) => ({
          targetReps: s.targetReps,
          targetWeight: 0,
          targetDuration: s.targetDuration ?? 0,
        })),
      }))
    : [{ name: '', groupIndex: null, sets: [{ targetReps: 8, targetWeight: 0, targetDuration: 0 }] }];

  const [type, setType] = useState<WorkoutType>(templatePrefill?.type ?? initialType);
  const [name, setName] = useState(templatePrefill?.name ?? '');
  const [notes, setNotes] = useState(templatePrefill?.notes ?? '');
  // Post-session reflection. Distinct from `notes` (preflight). Captured
  // on the rest screen of the FINAL set so the user can record how the
  // workout actually went (vs. how they expected it to go pre-session).
  const [postNotes, setPostNotes] = useState('');
  const [performedAt, setPerformedAt] = useState<string>(() => toLocalInput(new Date()));
  const [exercises, setExercises] = useState<PlannedExercise[]>(seedExercises);

  // ── Live-phase state ─────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('setup');
  // Round-robin walk order. Recomputed whenever the exercises array
  // changes (so editing the plan in setup re-flows the order). The
  // current position is a single integer index into this flat list;
  // currentExerciseIndex + currentSetIndex are kept in sync as derived
  // state so the rest of the JSX (which reads them by name) doesn't
  // need to know about the round-robin walker.
  const roundOrder = useMemo(() => buildRoundRobinOrder(exercises), [exercises]);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0);
  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  const [capturedSets, setCapturedSets] = useState<CapturedSet[]>([]);
  const [liveStartedAt, setLiveStartedAt] = useState<Date | null>(null);
  const [currentSetStartedAt, setCurrentSetStartedAt] = useState<Date | null>(null);
  const [currentSetDurationSec, setCurrentSetDurationSec] = useState(0);
  const [restStartedAt, setRestStartedAt] = useState<Date | null>(null);
  const [restElapsedSec, setRestElapsedSec] = useState(0);

  // The current set entry. Initialized from the planned target; the
  // user can override (e.g. planned 8 but you got 6). Persists across
  // the Continue → Next-set cycle so the user can type once and the
  // field stays populated.
  const [currentReps, setCurrentReps] = useState(0);
  const [currentWeight, setCurrentWeight] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(0);
  const [currentRpe, setCurrentRpe] = useState(0);

  // Discard-warning state: opens when the user tries to close mid-workout.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // ── Tickers ──────────────────────────────────────────────────────────
  // Workout elapsed (counts up the entire time phase === 'live').
  // Set duration (counts up while the user is entering the current set).
  // Rest elapsed (counts up during the rest screen).
  // All three tick at 1Hz off the same internal interval when needed.
  useEffect(() => {
    if (phase !== 'live') return;
    const id = window.setInterval(() => {
      const now = new Date();
      if (liveStartedAt) {
        // Handled by separate "workout elapsed" widget below; not in state.
      }
      if (currentSetStartedAt) {
        setCurrentSetDurationSec(Math.round((now.getTime() - currentSetStartedAt.getTime()) / 1000));
      }
      if (restStartedAt) {
        setRestElapsedSec(Math.round((now.getTime() - restStartedAt.getTime()) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, liveStartedAt, currentSetStartedAt, restStartedAt]);

  // ── beforeunload guard ───────────────────────────────────────────────
  // If the user closes the tab mid-workout, browsers won't actually show
  // a custom message anymore (security), but the return value triggers
  // the native "Leave site?" prompt. Better than silently losing 30 min
  // of logging.
  useEffect(() => {
    if (phase !== 'live') return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [phase]);

  // ── Derived values ───────────────────────────────────────────────────
  const isStrength = STRENGTH_TYPES.includes(type);
  const isCardio = type === 'CARDIO';
  const isTimed = TIMED_TYPES.includes(type);
  const totalPlannedSets = exercises.reduce((acc, e) => acc + e.sets.length, 0);
  const completedSets = capturedSets.filter((s) => !s.skipped).length;

  const currentExercise = exercises[currentExerciseIndex];
  const currentPlannedSet = currentExercise?.sets[currentSetIndex];

  const load = currentExercise ? loadForExercise(currentExercise.name) : 'BARBELL';
  const isBw = load === 'BODYWEIGHT';
  const isWeightedBw = load === 'WEIGHTED_BODYWEIGHT';
  const showWeight = !!currentExercise && isStrength && !isBw;

  const bodyweightDisplay = units === 'IMPERIAL'
    ? Math.round(kgToLb(user?.weightKg ?? 0))
    : Math.round(user?.weightKg ?? 0);

  const workoutElapsedSec = useMemo(() => {
    if (!liveStartedAt) return 0;
    return Math.round((Date.now() - liveStartedAt.getTime()) / 1000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentSetDurationSec, restElapsedSec, capturedSets.length]);

  // ── Setup-phase mutations ────────────────────────────────────────────
  const startWorkout = () => {
    if (!isStrength) return;
    if (exercises.some((e) => !e.name.trim())) return;
    if (totalPlannedSets === 0) return;
    const now = new Date();
    setPhase('live');
    setLiveStartedAt(now);
    setCurrentExerciseIndex(0);
    setCurrentSetIndex(0);
    // Seed the entry fields from the first planned set's target.
    seedFromPlanned(exercises[0].sets[0]);
    setCurrentSetStartedAt(now);
  };

  function seedFromPlanned(planned: PlannedSet | undefined) {
    if (!planned) return;
    setCurrentReps(planned.targetReps);
    setCurrentWeight(planned.targetWeight);
    setCurrentDuration(0);
    setCurrentRpe(0);
  }

  // ── Live-phase actions ───────────────────────────────────────────────
  function tapContinue() {
    if (phase !== 'live') return;
    if (currentSetStartedAt == null) return;
    const now = new Date();
    const set: CapturedSet = {
      exerciseIndex: currentExerciseIndex,
      setIndex: currentSetIndex,
      reps: currentReps,
      weight: currentWeight,
      duration: currentDuration,
      rpe: currentRpe,
      startedAt: currentSetStartedAt.toISOString(),
      completedAt: now.toISOString(),
      // restSeconds is filled in when the NEXT set is entered (or at
      // commit for the final set, where it stays null).
      restSeconds: null,
      // Lock by default — the moment the user taps Continue, the
      // captured values are sacred. They can tap ✎ Edit on the
      // history strip below to unlock + edit if they fat-fingered
      // a value.
      locked: true,
    };
    setCapturedSets((prev) => [...prev, set]);
    // Enter rest state — the Continue tap doubles as "rest starts now".
    setCurrentSetStartedAt(null);
    setCurrentSetDurationSec(0);
    setRestStartedAt(now);
    setRestElapsedSec(0);
  }

  function tapSkip(reason: CapturedSet['skipReason']) {
    if (phase !== 'live') return;
    if (currentSetStartedAt == null) return;
    const now = new Date();
    const set: CapturedSet = {
      exerciseIndex: currentExerciseIndex,
      setIndex: currentSetIndex,
      reps: 0,
      weight: 0,
      duration: 0,
      rpe: 0,
      startedAt: currentSetStartedAt.toISOString(),
      completedAt: now.toISOString(),
      restSeconds: null,
      skipped: true,
      skipReason: reason,
      // Skipped sets are always locked — no value to fix anyway.
      locked: true,
    };
    setCapturedSets((prev) => [...prev, set]);
    setCurrentSetStartedAt(null);
    setCurrentSetDurationSec(0);
    setRestStartedAt(now);
    setRestElapsedSec(0);
  }

  function advanceToNextSet() {
    if (phase !== 'live') return;
    const now = new Date();
    // Fill in the restSeconds for the just-finished set (the one we
    // committed via tapContinue). Index = capturedSets.length - 1
    // UNLESS the user just skipped, in which case the last entry is
    // the skip and we need to fill restSeconds on the second-to-last.
    setCapturedSets((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      const restSec = restStartedAt
        ? Math.round((now.getTime() - restStartedAt.getTime()) / 1000)
        : 0;
      const updated = { ...last, restSeconds: restSec };
      return [...prev.slice(0, -1), updated];
    });

    // Move to the next set. Walks the round-robin order rather than
    // the raw exercises[] array so paired exercises alternate
    // (1A → 1B → 2A → 2B). Linear (un-paired) exercises walk in
    // their array order; the round-robin walker produces the same
    // order for them.
    const nextRoundIdx = currentRoundIndex + 1;
    if (nextRoundIdx < roundOrder.length) {
      const next = roundOrder[nextRoundIdx];
      setCurrentRoundIndex(nextRoundIdx);
      setCurrentExerciseIndex(next.exerciseIndex);
      setCurrentSetIndex(next.setIndex);
      seedFromPlanned(exercises[next.exerciseIndex].sets[next.setIndex]);
    } else {
      // Workout done — no more sets. Fire the commit so the
      // server persists the capturedSets. onSuccess will reset
      // phase back to 'setup' (via confirmDiscard), so the
      // "Wrapping up…" fallback never renders in the happy path.
      setPhase('done');
      createM.run(undefined);
      return;
    }

    // Re-arm the current-set clock and clear the rest clock.
    setRestStartedAt(null);
    setRestElapsedSec(0);
    setCurrentSetStartedAt(now);
  }

  // Per-set lock toggle on the captured-sets history strip. Unlocks
  // the row so the user can edit (e.g. they typo'd 135 instead of 145
  // and want to fix without scrolling back through the workout).
  function toggleCapturedLock(idx: number) {
    setCapturedSets((prev) => prev.map((s, i) => (i === idx ? { ...s, locked: !s.locked } : s)));
  }
  function patchCaptured(idx: number, patch: Partial<CapturedSet>) {
    setCapturedSets((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function tapAbortWorkout() {
    setConfirmingDiscard(true);
  }

  function confirmDiscard() {
    setConfirmingDiscard(false);
    // Reset all state and return to setup.
    setPhase('setup');
    setCurrentRoundIndex(0);
    setCurrentExerciseIndex(0);
    setCurrentSetIndex(0);
    setCapturedSets([]);
    setLiveStartedAt(null);
    setCurrentSetStartedAt(null);
    setCurrentSetDurationSec(0);
    setRestStartedAt(null);
    setRestElapsedSec(0);
    setCurrentReps(0);
    setCurrentWeight(0);
    setCurrentDuration(0);
    setCurrentRpe(0);
  }

  // ── Commit ───────────────────────────────────────────────────────────
  const createM = useDelayedMutation({
    mutationFn: () => {
      // ── STRENGTH path: use the captured sets with full timestamps
      //    (live-mode per-set timing). Existing behavior.
      // ── TIMED path (CARDIO / MOBILITY / OTHER): no captured sets,
      //    no per-set timing. Build the payload straight from the
      //    planned exercises with a single timed set each.
      const exPayload = isStrength
        ? buildLivePayload()
        : buildTimedPayload();

      // Workout duration: for live mode, use the elapsed seconds;
      // for timed mode, derive seconds directly from the target durations.
      // The server uses this for XP / PR calculations only — actual
      // effort shows up in the set rows.
      const durationSec = isStrength
        ? Math.max(1, workoutElapsedSec)
        : Math.max(1, exercises.reduce((acc, ex) => acc + (ex.sets[0]?.targetDuration ?? 0), 0));

      return api<any>('/workouts', {
        method: 'POST',
        body: {
          type,
          name: name || undefined,
          durationSec,
          notes: notes || undefined,
          postNotes: postNotes.trim() || undefined,
          performedAt: localInputToIso(performedAt),
          exercises: exPayload,
        },
      });

      function buildLivePayload() {
        // Final restSeconds for the very last captured set = time since
        // its completedAt until "now" (when Finish was tapped).
        const finalized: CapturedSet[] = capturedSets.map((s, i) => {
          if (i < capturedSets.length - 1) return s;
          if (s.restSeconds != null) return s;
          const elapsed = Math.max(0, Math.round((Date.now() - new Date(s.completedAt).getTime()) / 1000));
          return { ...s, restSeconds: elapsed };
        });
        return exercises.map((ex, ei) => {
          const exSets = finalized.filter((s) => s.exerciseIndex === ei);
          const exStart = exSets.length
            ? exSets.reduce((min, s) => (s.startedAt < min ? s.startedAt : min), exSets[0].startedAt)
            : null;
          const exEnd = exSets.length
            ? exSets.reduce((max, s) => (s.completedAt > max ? s.completedAt : max), exSets[0].completedAt)
            : null;
          return {
            name: ex.name,
            order: ei,
            musclesWorked: musclesForExercise(ex.name),
            startedAt: exStart,
            completedAt: exEnd,
            // Superset pairing carries through to the persisted
            // Exercise row so the live round-robin walking can be
            // reconstructed from a saved workout (e.g. for replay /
            // analytics). Null = linear walk, same as if no pairing
            // had ever been set.
            groupIndex: ex.groupIndex ?? null,
            sets: exSets.map((s, j) => {
              let weight: number | undefined;
              const bodyweight = user?.weightKg ?? null;
              if (loadForExercise(ex.name) === 'BODYWEIGHT' && bodyweight) {
                weight = bodyweight;
              } else if (loadForExercise(ex.name) === 'WEIGHTED_BODYWEIGHT' && bodyweight) {
                weight = bodyweight + weightToKg(s.weight, units)!;
              } else {
                weight = weightToKg(s.weight, units);
              }
              return {
                reps: s.skipped ? 0 : s.reps,
                weight: weight || undefined,
                duration: s.skipped ? undefined : (s.duration || undefined),
                rpe: s.skipped ? undefined : (s.rpe || undefined),
                order: j,
                completed: !s.skipped,
                skipped: !!s.skipped,
                skipReason: s.skipReason ?? null,
                startedAt: s.startedAt,
                completedAt: s.completedAt,
                restSeconds: s.restSeconds,
              };
            }),
          };
        });
      }

      function buildTimedPayload() {
        // Each planned exercise becomes a single timed set.
        // Cardio sets have reps=0 (we don't track cardio reps).
        // Mobility/Other sets use the duration as-is.
        return exercises.map((ex, ei) => {
          const targetDuration = ex.sets[0]?.targetDuration ?? 0;
          return {
            name: ex.name,
            order: ei,
            musclesWorked: musclesForExercise(ex.name),
            startedAt: null,
            completedAt: null,
            sets: [{
              reps: 0,
              weight: undefined,
              duration: targetDuration || undefined,
              rpe: undefined,
              order: 0,
              completed: true,
              skipped: false,
              skipReason: null,
              startedAt: null,
              completedAt: null,
              restSeconds: null,
            }],
          };
        });
      }
    },
    onSuccess: (r) => {
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
      // Reset to setup phase so the user can log another workout.
      confirmDiscard();
      if (onCommit) onCommit(r.workout?.id ?? '', r);
    },
  }, 1500);

  // ── Render: Setup phase ──────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <Panel variant="cyan" title={title} scanline className={panelClass}>
        <div className={sectionClass}>
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
                      : 'border-ink-500/40 text-ink-300 hover:border-ink-300',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {!isStrength && isCardio && (
              <div className="mt-2 text-[10px] font-mono text-amber-300/90">
                Cardio mode: per-set weight/reps are hidden. Time + distance are the metric — log the activity and a single target duration below.
              </div>
            )}
            {!isStrength && !isCardio && isTimed && (
              <div className="mt-2 text-[10px] font-mono text-amber-300/90">
                Mobility / Other: each exercise is logged as a single timed entry. Weight and reps are hidden.
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
              Workout name (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-neon mt-1"
              placeholder="e.g. Push day"
            />
          </div>

          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
              Date / time
            </label>
            <input
              type="datetime-local"
              value={performedAt}
              onChange={(e) => setPerformedAt(e.target.value)}
              className="input-neon mt-1"
            />
          </div>

          {isStrength && (
            <div className="space-y-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
                Plan your sets
              </div>
              {exercises.map((ex, ei) => (
                <div key={ei} className="border border-ink-500/30 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <ExerciseAutocomplete
                      className="flex-1"
                      value={ex.name}
                      filterCategory={type as any}
                      onChange={(v) => {
                        const copy = [...exercises];
                        copy[ei] = { ...copy[ei], name: v };
                        setExercises(copy);
                      }}
                    />
                    {exercises.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setExercises(exercises.filter((_, i) => i !== ei))}
                        className="px-2 h-9 text-[10px] font-mono border border-rose-500/40 text-rose-300 hover:border-rose-300"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="text-[9px] font-mono text-ink-400">
                    {isStrength
                      ? `${ex.sets.length} planned set${ex.sets.length === 1 ? '' : 's'}`
                      : isTimed
                        ? 'timed entry'
                        : ''}
                  </div>

                  {/* Per-set inputs — strength only. Timed types use a
                      single duration field per exercise below. */}
                  {isStrength && (
                    <>
                      <div className="grid grid-cols-1 gap-1">
                        {ex.sets.map((s, si) => (
                          <div key={si} className="flex items-center gap-2 text-xs">
                            <span className="font-mono text-ink-400 w-12">#{si + 1}</span>
                            <input
                              type="number"
                              min={-500}
                              inputMode="numeric"
                              value={s.targetWeight || ''}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                const copy = [...exercises];
                                copy[ei] = {
                                  ...copy[ei],
                                  sets: copy[ei].sets.map((ss, jj) => jj === si ? { ...ss, targetWeight: v } : ss),
                                };
                                setExercises(copy);
                              }}
                              className="input-neon flex-1"
                              placeholder={`weight (${weightUnitLabel(units)}) · − for band assist`}
                            />
                            <input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              value={s.targetReps || ''}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                const copy = [...exercises];
                                copy[ei] = {
                                  ...copy[ei],
                                  sets: copy[ei].sets.map((ss, jj) => jj === si ? { ...ss, targetReps: v } : ss),
                                };
                                setExercises(copy);
                              }}
                              className="input-neon flex-1"
                              placeholder="reps"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const copy = [...exercises];
                                copy[ei] = { ...copy[ei], sets: copy[ei].sets.filter((_, jj) => jj !== si) };
                                setExercises(copy);
                              }}
                              className="px-2 h-9 text-[10px] font-mono border border-ink-500/40 text-ink-300 hover:border-ink-300"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const copy = [...exercises];
                          // For strength, repeat the previous set's
                          // weight + default 8 reps. For timed types,
                          // repeat the previous set's duration so
                          // adding a second interval doesn't reset
                          // the user's first entry.
                          const prev = copy[ei].sets[copy[ei].sets.length - 1];
                          copy[ei] = {
                            ...copy[ei],
                            sets: [...copy[ei].sets, {
                              targetReps: prev?.targetReps ?? 8,
                              targetWeight: prev?.targetWeight ?? 0,
                              targetDuration: prev?.targetDuration ?? 0,
                            }],
                          };
                          setExercises(copy);
                        }}
                        className="px-3 h-9 text-[10px] font-mono border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10"
                      >
                        + Add set
                      </button>
                    </>
                  )}

                  {/* Timed input — single duration field per exercise
                      for CARDIO / MOBILITY / OTHER. Stores in the first
                      set's targetDuration so the API shape is
                      uniform (no schema change). */}
                  {isTimed && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-[10px] font-mono text-ink-400 w-12 shrink-0">
                        {isCardio ? 'run' : 'time'}
                      </span>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={ex.sets[0]?.targetDuration ?? ''}
                        onChange={(e) => {
                          const v = e.target.value === '' ? 0 : Number(e.target.value);
                          const copy = [...exercises];
                          // Replace the first set's targetDuration.
                          // reps/weight stay 0 — irrelevant for timed.
                          copy[ei] = {
                            ...copy[ei],
                            sets: [{ targetReps: 0, targetWeight: 0, targetDuration: v }],
                          };
                          setExercises(copy);
                        }}
                        className="input-neon flex-1"
                        placeholder={isCardio ? 'minutes' : 'seconds'}
                      />
                      <span className="text-[10px] font-mono text-ink-400">
                        {isCardio ? 'min' : 'sec'}
                      </span>
                    </div>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={() => setExercises([
                  ...exercises,
                  {
                    name: '',
                    groupIndex: null,
                    sets: [{
                      targetReps: isStrength ? 8 : 0,
                      targetWeight: 0,
                      targetDuration: isStrength ? 0 : (isCardio ? 30 * 60 : 60),
                    }],
                  },
                ])}
                className="px-3 h-9 text-[10px] font-mono border border-neon-cyan/60 text-neon-cyan bg-neon-cyan/5 hover:bg-neon-cyan/10"
              >
                + Add exercise
              </button>
            </div>
          )}

          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input-neon mt-1 min-h-[60px]"
            />
          </div>

          {isStrength && (
            <div className="flex justify-end gap-2 pt-2 border-t border-ink-500/20">
              <NeonButton
                variant="cyan"
                onClick={startWorkout}
                disabled={
                  exercises.some((e) => !e.name.trim())
                  || totalPlannedSets === 0
                }
              >
                Start workout →
              </NeonButton>
            </div>
          )}

          {/* Timed types commit straight from setup — no per-set flow.
              The single duration per exercise is the only thing the
              user has to fill in, so a separate "live" phase would
              just add clicks. */}
          {!isStrength && (
            <div className="flex justify-end gap-2 pt-2 border-t border-ink-500/20">
              <NeonButton
                variant="cyan"
                onClick={() => createM.run(undefined)}
                loading={createM.isPending}
                disabled={
                  exercises.some((e) => !e.name.trim())
                  || exercises.every((e) => !e.sets[0]?.targetDuration)
                  || createM.isPending
                }
              >
                Log workout →
              </NeonButton>
            </div>
          )}

          <div className="text-[9px] font-mono text-ink-400 leading-relaxed">
            Live mode walks through one set at a time. Rest timer auto-starts after each
            Continue; timestamps captured for later Garmin FIT correlation.
          </div>
        </div>
      </Panel>
    );
  }

  // ── Render: Live phase ───────────────────────────────────────────────
  if (phase === 'live' && currentExercise && currentPlannedSet) {
    const inRest = restStartedAt !== null;
    const progressPct = totalPlannedSets > 0 ? Math.round((completedSets / totalPlannedSets) * 100) : 0;
    return (
      <Panel
        variant="cyan"
        title={`${currentExercise.name} · Set ${currentSetIndex + 1} / ${currentExercise.sets.length}`}
        scanline
        className={panelClass}
        action={
          <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest">
            <span className="text-neon-cyan">⏱ {formatDuration(workoutElapsedSec)}</span>
            <span className="text-ink-400">{completedSets} / {totalPlannedSets}</span>
            <button
              type="button"
              onClick={tapAbortWorkout}
              className="px-2 h-7 text-[10px] font-mono border border-rose-500/60 text-rose-300 hover:bg-rose-500/10"
            >
              End
            </button>
          </div>
        }
      >
        <div className={sectionClass}>
          {/* Progress bar */}
          <div className="h-1 bg-bg-700 border border-ink-500/30">
            <div
              className="h-full bg-neon-cyan transition-all"
              style={{ width: `${progressPct}%`, boxShadow: '0 0 6px rgba(20,214,232,0.55)' }}
            />
          </div>

          {/* Exercise context (which exercise we're on, which set).
              The 1A/1B pair label prefixes the exercise name when the
              current exercise is part of a superset, so the user
              always knows which side of the pair they're on. */}
          <div className="text-[10px] font-mono text-ink-400 uppercase tracking-widest">
            {(() => {
              const pairLabel = roundOrder[currentRoundIndex]?.label ?? null;
              return pairLabel ? `${pairLabel} · ` : '';
            })()}{currentExercise.name} · Set {currentSetIndex + 1} of {currentExercise.sets.length} · Target {currentPlannedSet.targetReps} reps{showWeight ? ` @ ${currentPlannedSet.targetWeight} ${weightUnitLabel(units)}` : ''}
          </div>

          {/* Captured-sets history strip. Each row is read-only by
              default (the user explicitly tapped Continue, the row
              is locked). Tap ✎ to unlock and edit a single value if
              needed (typo, mid-set adjustment, etc.) — the lock
              prevents accidental overwrites from a stray tap on
              the live entry below. */}
          {capturedSets.length > 0 && (
            <div className="space-y-1 max-h-44 overflow-y-auto border border-ink-700/40 p-1.5 bg-bg-900/40">
              <div className="text-[9px] font-mono text-ink-400 uppercase tracking-widest px-1 pt-0.5">
                Captured sets ({capturedSets.length})
              </div>
              {capturedSets.map((cs, idx) => {
                const ex = exercises[cs.exerciseIndex];
                return (
                  <div
                    key={`${cs.exerciseIndex}-${cs.setIndex}-${idx}`}
                    className={classNames(
                      'flex items-center gap-2 px-1.5 py-1 text-[10px] font-mono border',
                      cs.locked
                        ? 'border-ink-700/30 text-ink-200 bg-bg-700/30'
                        : 'border-neon-amber/60 text-ink-100 bg-neon-amber/5',
                      cs.skipped && 'opacity-60 line-through',
                    )}
                  >
                    <span className="text-ink-400 shrink-0">
                      {ex?.name?.slice(0, 14) ?? 'ex'} s{cs.setIndex + 1}
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      disabled={cs.locked}
                      value={cs.reps || ''}
                      onChange={(e) => patchCaptured(idx, { reps: Number(e.target.value) })}
                      className="w-12 bg-transparent border-b border-ink-700/40 px-1 text-right disabled:text-ink-400"
                      title="Reps"
                    />
                    <span className="text-ink-500">×</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      disabled={cs.locked}
                      value={cs.weight || ''}
                      onChange={(e) => patchCaptured(idx, { weight: Number(e.target.value) })}
                      className="w-14 bg-transparent border-b border-ink-700/40 px-1 text-right disabled:text-ink-400"
                      title={`Weight (${weightUnitLabel(units)})`}
                    />
                    <span className="text-ink-500 text-[9px]">{weightUnitLabel(units)}</span>
                    <button
                      type="button"
                      onClick={() => toggleCapturedLock(idx)}
                      className={classNames(
                        'ml-auto text-[10px] px-1.5 py-0.5 border shrink-0',
                        cs.locked
                          ? 'border-ink-500/40 text-ink-300 hover:border-neon-amber hover:text-neon-amber'
                          : 'border-neon-amber/60 text-neon-amber hover:border-ink-500/40 hover:text-ink-300',
                      )}
                      title={cs.locked ? 'Unlock to edit' : 'Lock this row'}
                    >
                      {cs.locked ? '✎ Edit' : '✓ Lock'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {!inRest ? (
            // ── Set entry ──
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {showWeight && (
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
                      Weight ({weightUnitLabel(units)})
                    </label>
                    <input
                      type="number"
                      min={-500}
                      inputMode="decimal"
                      value={currentWeight || ''}
                      onChange={(e) => setCurrentWeight(Number(e.target.value))}
                      className="input-neon mt-1 text-lg font-display"
                    />
                    {isWeightedBw && (
                      <div className="text-[9px] font-mono text-ink-400 mt-1">
                        + {bodyweightDisplay} {weightUnitLabel(units)} bodyweight
                      </div>
                    )}
                  </div>
                )}
                <div className={showWeight ? '' : 'col-span-2'}>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
                    Reps
                  </label>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={currentReps || ''}
                    onChange={(e) => setCurrentReps(Number(e.target.value))}
                    className="input-neon mt-1 text-lg font-display"
                  />
                </div>
              </div>

              <details className="text-[10px] font-mono">
                <summary className="cursor-pointer text-ink-400 uppercase tracking-widest">
                  + RPE / timed set
                </summary>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
                      Duration (sec)
                    </label>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={currentDuration || ''}
                      onChange={(e) => setCurrentDuration(Number(e.target.value))}
                      className="input-neon mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
                      RPE (1-10)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step={0.5}
                      inputMode="decimal"
                      value={currentRpe || ''}
                      onChange={(e) => setCurrentRpe(Number(e.target.value))}
                      className="input-neon mt-1"
                    />
                  </div>
                </div>
              </details>

              <div className="text-[10px] font-mono text-ink-400 uppercase tracking-widest text-center">
                Set in progress · {formatDuration(currentSetDurationSec)}
              </div>

              <button
                type="button"
                onClick={tapContinue}
                className="w-full h-14 text-lg font-display tracking-widest uppercase border-2 border-neon-cyan text-neon-cyan bg-neon-cyan/10 hover:bg-neon-cyan/20 shadow-neon-cyan/30 hover:shadow-neon-cyan"
              >
                Continue →
              </button>

              <button
                type="button"
                onClick={() => {
                  const reason = window.prompt(
                    'Skip this set? Type a reason: INJURY, ILLNESS, FATIGUE, EQUIPMENT, SCHEDULE, OTHER',
                    'FATIGUE',
                  );
                  if (!reason) return;
                  const normalized = reason.toUpperCase();
                  if (!['INJURY', 'ILLNESS', 'FATIGUE', 'EQUIPMENT', 'SCHEDULE', 'OTHER'].includes(normalized)) return;
                  tapSkip(normalized as CapturedSet['skipReason']);
                }}
                className="w-full h-9 text-[10px] font-mono border border-ink-500/40 text-ink-300 hover:border-ink-300 uppercase tracking-widest"
              >
                Skip this set
              </button>
            </div>
          ) : (
            // ── Rest screen ──
            <div className="space-y-3">
              <div className="text-center py-4">
                <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
                  Resting
                </div>
                <div
                  className="font-display tracking-widest text-5xl mt-2"
                  style={{
                    color: '#56e88e',
                    textShadow: '0 0 12px rgba(86,232,142,0.7)',
                  }}
                >
                  {formatDuration(restElapsedSec)}
                </div>
                <div className="text-[10px] font-mono text-ink-400 mt-2">
                  Set took {formatDuration(currentPlannedSet ? currentSetDurationSecForLastSet(capturedSets, currentSetIndex, currentExerciseIndex) : 0)}
                </div>
              </div>

              {/* Show the next set preview if any. Walks the round-robin
                  order so paired exercises get the "1B" / "2A" labels. */}
              {(() => {
                const nextRoundIdx = currentRoundIndex + 1;
                const isFinalSet = nextRoundIdx >= roundOrder.length;
                let nextLabel = '';
                if (!isFinalSet) {
                  const next = roundOrder[nextRoundIdx];
                  const nextEx = exercises[next.exerciseIndex];
                  const nextPlanned = nextEx.sets[next.setIndex];
                  const positionLabel = next.label ? `${next.label} · ` : '';
                  nextLabel = `Next: ${positionLabel}${nextEx.name} · set ${next.setIndex + 1} · target ${nextPlanned.targetReps} reps${showWeight ? ` @ ${nextPlanned.targetWeight} ${weightUnitLabel(units)}` : ''}`;
                } else {
                  nextLabel = 'Next: finish workout';
                }
                return (
                  <>
                    <div className="text-[10px] font-mono text-ink-300 text-center uppercase tracking-widest">
                      {nextLabel}
                    </div>
                    {/* Post-session reflection. Rendered only on the
                        rest screen of the FINAL set so the user can
                        log how the workout went (vs. the preflight
                        notes they typed in setup). The field is
                        optional — empty values are dropped before
                        commit. */}
                    {isFinalSet && (
                      <div className="mt-2 pt-2 border-t border-ink-700/40">
                        <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
                          How did it go? (optional)
                        </label>
                        <textarea
                          value={postNotes}
                          onChange={(e) => setPostNotes(e.target.value)}
                          rows={3}
                          maxLength={2000}
                          placeholder="Left shoulder pain got sharper on set 3, will back off next time."
                          className="input-neon w-full text-xs"
                        />
                      </div>
                    )}
                  </>
                );
              })()}

              <button
                type="button"
                onClick={advanceToNextSet}
                disabled={createM.isPending}
                className="w-full h-14 text-lg font-display tracking-widest uppercase border-2 border-neon-lime text-neon-lime bg-neon-lime/10 hover:bg-neon-lime/20 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ boxShadow: '0 0 8px rgba(86,232,142,0.4)' }}
              >
                {(() => {
                  // While commit is in flight, lock the label so the
                  // user can't tap a 2nd or 3rd time and re-fire the
                  // commit (idempotent at the server but slow at the
                  // wire).
                  if (createM.isPending) return 'Committing…';
                  const hasNext = currentRoundIndex + 1 < roundOrder.length;
                  const nextEntry = hasNext ? roundOrder[currentRoundIndex + 1] : null;
                  if (hasNext && nextEntry) {
                    // Differentiate "next set" (same exercise, set+1)
                    // from "next exercise" (different exercise). The
                    // round-robin walker flips back to a paired exercise
                    // on every set, so "next exercise" is the common
                    // case for supersets — pair label included so the
                    // user sees "Next: 1B" not just "Next: Bench Press".
                    const nextEx = exercises[nextEntry.exerciseIndex];
                    const isSameEx = nextEntry.exerciseIndex === currentExerciseIndex;
                    const prefix = nextEntry.label ? `${nextEntry.label} ` : '';
                    return isSameEx
                      ? `Next set → ${prefix}${nextEx.name}`
                      : `Next exercise → ${prefix}${nextEx.name}`;
                  }
                  return 'Finish workout ✓';
                })()}
              </button>
            </div>
          )}
        </div>

        <Modal
          open={confirmingDiscard}
          onClose={() => setConfirmingDiscard(false)}
          title="End this workout?"
        >
          <div className="space-y-3">
            <p className="text-sm text-ink-200">
              You've logged <strong>{capturedSets.filter((s) => !s.skipped).length}</strong> sets so far. Ending now will discard them.
            </p>
            <p className="text-[10px] font-mono text-ink-400">
              (Bulk mode commits a workout even with partial data. Live mode is "all or nothing" — tap Finish workout when you're ready.)
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmingDiscard(false)}
                className="px-3 h-9 text-xs font-mono border border-ink-500/40 text-ink-300 hover:border-ink-300"
              >
                Keep going
              </button>
              <button
                type="button"
                onClick={confirmDiscard}
                className="px-3 h-9 text-xs font-mono border border-rose-500/60 text-rose-300 bg-rose-500/10 hover:bg-rose-500/20"
              >
                Discard sets
              </button>
            </div>
          </div>
        </Modal>
      </Panel>
    );
  }

  // ── Render: Done (fallback; usually the commit's onSuccess resets to setup) ──
  return (
    <Panel variant="cyan" title="Wrapping up…" className={panelClass}>
      <div className="text-sm text-ink-200">Committing your workout…</div>
    </Panel>
  );
}

// Helper: the duration of the most recently committed set. Used by
// the rest screen to show "Set took X" while the user is resting.
function currentSetDurationSecForLastSet(
  capturedSets: CapturedSet[],
  currentSetIndex: number,
  currentExerciseIndex: number,
): number {
  for (let i = capturedSets.length - 1; i >= 0; i--) {
    const s = capturedSets[i];
    if (s.exerciseIndex === currentExerciseIndex && s.setIndex === currentSetIndex) {
      return Math.max(0, Math.round((new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) / 1000));
    }
  }
  return 0;
}