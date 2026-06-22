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
import { RestTimer, REST_PRESETS } from '@/components/RestTimer';
import { PlateCalculator } from '@/components/PlateCalculator';

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

type SkipReason = 'INJURY' | 'ILLNESS' | 'FATIGUE' | 'EQUIPMENT' | 'SCHEDULE' | 'OTHER';
const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  INJURY: 'Injury',
  ILLNESS: 'Illness',
  FATIGUE: 'Fatigue',
  EQUIPMENT: 'No equipment',
  SCHEDULE: 'Out of time',
  OTHER: 'Other',
};
const SKIP_REASONS: SkipReason[] = ['INJURY', 'ILLNESS', 'FATIGUE', 'EQUIPMENT', 'SCHEDULE', 'OTHER'];

type ValidityFlag = {
  exercise: string;
  setIndex: number;
  field: 'weight' | 'reps';
  value: number;
  reason: 'possible_typo' | 'unusually_high';
};

type DraftSet = {
  reps: number;
  weight: number;  // displayed in user's preferred unit (kg or lb)
  duration: number;  // seconds (for timed sets)
  rpe: number;
  skipped?: boolean;
  skipReason?: SkipReason | null;
};

type DraftExercise = { name: string; sets: DraftSet[] };

function emptyExercise(): DraftExercise {
  return { name: '', sets: [{ reps: 0, weight: 0, duration: 0, rpe: 0, skipped: false, skipReason: null }] };
}

// Convert a stored workout into DraftExercise[] for the form.
function workoutToDraft(
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
      skipped: s.skipped ?? false,
      skipReason: s.skipReason ?? null,
    })),
  }));
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

// Format a Date for a <input type="datetime-local">: "YYYY-MM-DDTHH:mm"
// in the user's local time. The native input always uses local time
// (no timezone), so the round-trip via toISOString is wrong: we'd lose
// the user's wall-clock selection.
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convert the datetime-local value back into a full ISO string for
// the API. Treat the local string as the user's wall-clock time.
function localInputToIso(s: string): string {
  // new Date('YYYY-MM-DDTHH:mm') parses as LOCAL time, which is what
  // we want — the user picked their local clock time.
  return new Date(s).toISOString();
}

// Quick-pick shortcuts. The label is human-friendly; the value
// updates performedAt via toLocalInput.
const PERFORMED_AT_PRESETS: { label: string; minutes: number; title: string }[] = [
  { label: 'Now',          minutes: 0,         title: 'Log at the current time' },
  { label: '−1h',          minutes: 60,        title: '1 hour ago' },
  { label: '−3h',          minutes: 180,       title: '3 hours ago' },
  { label: 'Yesterday',    minutes: 60 * 24,   title: 'Same time yesterday' },
  { label: '−2d',          minutes: 60 * 48,   title: '2 days ago' },
];

// ============================================================================
// Non-set cardio (hike / run / cycle / row / swim)
// ============================================================================
//
// A single distance + duration + pace entry with no exercise breakdown.
// Independent of `WorkoutType` so future HIKING / RUNNING / CYCLING types
// can reuse the same shape. Server schema: api/prisma/schema.prisma
// `Workout.cardio` (JSONB, nullable).

type CardioPace =
  | 'WALK_CASUAL'
  | 'WALK_BRISK'
  | 'JOG'
  | 'RUN'
  | 'SPRINT'
  | 'CRUISE'
  | 'INTERVALS';

const PACE_OPTIONS: { value: CardioPace; label: string; hint: string }[] = [
  { value: 'WALK_CASUAL', label: 'Casual walk',  hint: 'leisurely, conversation pace' },
  { value: 'WALK_BRISK',  label: 'Brisk walk',   hint: 'purposeful, can\'t quite sing' },
  { value: 'JOG',         label: 'Jog',          hint: 'easy run, can hold a sentence' },
  { value: 'RUN',         label: 'Run',          hint: 'steady, can speak in phrases' },
  { value: 'SPRINT',      label: 'Sprint',       hint: 'all-out, max effort' },
  { value: 'CRUISE',      label: 'Cruise',       hint: 'long, comfortable pace' },
  { value: 'INTERVALS',   label: 'Intervals',    hint: 'repeats with recovery' },
];

type DraftCardio = {
  distanceKm: string;   // user-entered, in user's preferred unit
  duration: string;      // hh:mm:ss or mm:ss
  pace: CardioPace | '';
  elevationGainM: string;
  avgHr: string;
  maxHr: string;
  source: 'MANUAL' | 'GPS';
};

function emptyCardio(): DraftCardio {
  return {
    distanceKm: '',
    duration: '',
    pace: '',
    elevationGainM: '',
    avgHr: '',
    maxHr: '',
    source: 'MANUAL',
  };
}

// Parse an hh:mm:ss or mm:ss string into total seconds. Returns
// null if the input is empty or malformed.
function parseDuration(s: string): number | null {
  if (!s || !s.trim()) return null;
  const parts = s.trim().split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0]; // bare seconds
  return null;
}

// Render total seconds as hh:mm:ss (or m:ss if < 1h). Used to show
// the user a friendly preview of what they're about to log.
function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Compute pace in sec/km from distance (km) + duration (sec). Returns
// null if either is missing or non-positive.
function computePaceSecPerKm(distanceKm: number, durationSec: number): number | null {
  if (distanceKm <= 0 || durationSec <= 0) return null;
  return Math.round(durationSec / distanceKm);
}

// Distance display: the user enters in their preferred unit (km or mi).
// We always store km on the server, so the unit toggle flips both the
// input's unit label AND the conversion.
const distanceUnit = (units: UnitSystem) => (units === 'IMPERIAL' ? 'mi' : 'km');
const distanceInputToKm = (val: number, units: UnitSystem) => (units === 'IMPERIAL' ? val * 1.609344 : val);

// Convert a stored cardio block back into the form's draft shape.
function cardioToDraft(c: any, units: UnitSystem): DraftCardio {
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

// True if the form has either a usable exercise row or a usable cardio
// block. Used to gate the Commit button.
function hasUsableContent(exercises: DraftExercise[], cardio: DraftCardio): boolean {
  const hasExercise = exercises.some(
    (e) => e.name.trim() && e.sets.some((s) => s.reps > 0 || s.duration > 0),
  );
  if (hasExercise) return true;
  const dist = Number(cardio.distanceKm);
  const dur = parseDuration(cardio.duration);
  return (Number.isFinite(dist) && dist > 0) || (dur != null && dur > 0);
}

// ============================================================================
// CardioBlock — inline form for non-set activities (hike / run / cycle)
// ============================================================================
//
// Single distance + duration + pace entry. Distance is stored in km
// regardless of the user's units; the input shows the right unit label
// and converts on the fly. Duration accepts mm:ss or hh:mm:ss. Pace is
// a preset chip (the user usually knows whether it was a walk / jog /
// run; precise pace is computed and shown as a preview).
//
// Kept collapsible so the strength form stays compact when not in use.
// Auto-opens when the user picks CARDIO type (handled in the parent).

function CardioBlock({
  cardio,
  setCardio,
  open,
  setOpen,
  units,
  parseDuration,
  formatDuration,
  computePaceSecPerKm,
  distanceUnit,
}: {
  cardio: DraftCardio;
  setCardio: (c: DraftCardio) => void;
  open: boolean;
  setOpen: (b: boolean) => void;
  units: UnitSystem;
  parseDuration: (s: string) => number | null;
  formatDuration: (sec: number) => string;
  computePaceSecPerKm: (km: number, sec: number) => number | null;
  distanceUnit: string;
}) {
  const distNum = Number(cardio.distanceKm);
  const durSec = parseDuration(cardio.duration);
  const distKm = Number.isFinite(distNum) && distNum > 0
    ? distanceInputToKm(distNum, units)
    : null;
  const pace = distKm != null && durSec != null ? computePaceSecPerKm(distKm, durSec) : null;
  const paceDisplay = pace != null
    ? units === 'IMPERIAL'
      ? `${formatDuration(Math.round(pace * 1.609344))}/mi`
      : `${formatDuration(pace)}/km`
    : null;
  const preview = distKm != null && durSec != null
    ? `→ ${distKm.toFixed(2)} km · ${formatDuration(durSec)}${paceDisplay ? ` · ${paceDisplay}` : ''}`
    : null;
  return (
    <div className="border border-neon-amber/30 p-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left"
        title="Non-set activity — log distance + duration instead of exercises"
      >
        <div className="text-[10px] font-mono uppercase tracking-widest text-neon-amber/80">
          ⚡ Cardio block (hike / run / cycle / row / swim)
        </div>
        <span className="text-[10px] font-mono text-ink-400">
          {open ? '▾ collapse' : '▸ expand'}
        </span>
      </button>
      {!open ? (
        cardio.distanceKm || cardio.duration ? (
          <div className="mt-2 text-[10px] font-mono text-ink-300">
            {preview ?? 'partial entry'}
          </div>
        ) : null
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] uppercase text-slate-500">
                Distance ({distanceUnit})
              </span>
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                type="number"
                step="0.01"
                min="0"
                placeholder={units === 'IMPERIAL' ? '3.1' : '5'}
                value={cardio.distanceKm}
                onChange={(e) => setCardio({ ...cardio, distanceKm: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase text-slate-500">
                Duration (mm:ss or hh:mm:ss)
              </span>
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm font-mono"
                type="text"
                placeholder="32:14"
                value={cardio.duration}
                onChange={(e) => setCardio({ ...cardio, duration: e.target.value })}
              />
            </label>
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-500 mb-1">Pace</div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setCardio({ ...cardio, pace: '' })}
                className={classNames(
                  'px-2 py-1 text-[10px] font-mono border',
                  cardio.pace === ''
                    ? 'border-amber-400 text-amber-300 bg-amber-400/10'
                    : 'border-ink-500/30 text-ink-300 hover:border-ink-300',
                )}
                title="No pace label — just log the numbers"
              >
                none
              </button>
              {PACE_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setCardio({ ...cardio, pace: p.value })}
                  className={classNames(
                    'px-2 py-1 text-[10px] font-mono border',
                    cardio.pace === p.value
                      ? 'border-amber-400 text-amber-300 bg-amber-400/10'
                      : 'border-ink-500/30 text-ink-300 hover:border-ink-300',
                  )}
                  title={p.hint}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-[10px] uppercase text-slate-500">Elev gain (m)</span>
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                type="number"
                min="0"
                placeholder="120"
                value={cardio.elevationGainM}
                onChange={(e) => setCardio({ ...cardio, elevationGainM: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase text-slate-500">Avg HR</span>
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                type="number"
                min="0"
                placeholder="142"
                value={cardio.avgHr}
                onChange={(e) => setCardio({ ...cardio, avgHr: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase text-slate-500">Max HR</span>
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                type="number"
                min="0"
                placeholder="171"
                value={cardio.maxHr}
                onChange={(e) => setCardio({ ...cardio, maxHr: e.target.value })}
              />
            </label>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono text-ink-400">
            <span>Source:</span>
            <button
              type="button"
              onClick={() => setCardio({ ...cardio, source: 'MANUAL' })}
              className={classNames(
                'px-2 py-0.5 border',
                cardio.source === 'MANUAL'
                  ? 'border-amber-400 text-amber-300 bg-amber-400/10'
                  : 'border-ink-500/30 text-ink-300',
              )}
            >
              manual
            </button>
            <button
              type="button"
              onClick={() => setCardio({ ...cardio, source: 'GPS' })}
              className={classNames(
                'px-2 py-0.5 border',
                cardio.source === 'GPS'
                  ? 'border-amber-400 text-amber-300 bg-amber-400/10'
                  : 'border-ink-500/30 text-ink-300',
              )}
              title="Distance + duration were pulled from a GPS track"
            >
              gps
            </button>
            {preview && (
              <span className="text-amber-300 ml-auto">{preview}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkoutsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const units: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';
  const [type, setType] = useState<WorkoutType>('STRENGTH');
  const [name, setName] = useState('');
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState('');
  // performedAt — defaults to "now", can be backdated. Stored as a
  // datetime-local string in the form (YYYY-MM-DDTHH:mm) so the native
  // input round-trips cleanly. Submitting converts to ISO.
  const [performedAt, setPerformedAt] = useState<string>(() => toLocalInput(new Date()));
  // Non-set cardio block. Shown when the user picks CARDIO type
  // (and we encourage it for OTHER too — anything that isn't set-based).
  // Server schema: api/prisma/schema.prisma Workout.cardio (JSONB).
  const [cardio, setCardio] = useState<DraftCardio>(emptyCardio());
  const [cardioOpen, setCardioOpen] = useState(false);
  const [exercises, setExercises] = useState<DraftExercise[]>([emptyExercise()]);
  const [result, setResult] = useState<any | null>(null);
  const [selectedExerciseIdx, setSelectedExerciseIdx] = useState<number | null>(null);

  // History filters
  const [historyFilter, setHistoryFilter] = useState<'all' | '7d' | '30d' | '90d'>('30d');
  const [exerciseFilter, setExerciseFilter] = useState('');

  const list = useQuery({
    queryKey: ['workouts'],
    queryFn: () => api<{ items: Workout[]; total: number }>('/workouts?limit=100'),
  });

  // Copy last session helper
  function copyLastSession() {
    if (!list.data?.items.length) return;
    const last = list.data.items[0];
    setExercises(workoutToDraft(last, units));
    setName(last.name ? `${last.name} (copy)` : '');
    setDuration(last.duration ?? 60);
    setNotes(last.notes ?? '');
    // Carry over the cardio block too if the previous session had one.
    if ((last as any).cardio) {
      setCardio(cardioToDraft((last as any).cardio, units));
      setCardioOpen(true);
    } else {
      setCardio(emptyCardio());
      setCardioOpen(false);
    }
  }

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

  // Build the cardio block from the form state. Returns null if the
  // user hasn't filled in anything useful (no distance and no duration)
  // so the server can leave the field as-is. Distance is converted to
  // km before sending; pace is preserved; GPS source is preserved
  // (the importer will pre-fill these from trackJson).
  function buildCardioBody(): any | null {
    const distRaw = Number(cardio.distanceKm);
    const distKm = Number.isFinite(distRaw) && distRaw > 0
      ? Math.round(distanceInputToKm(distRaw, units) * 1000) / 1000
      : null;
    const durSec = parseDuration(cardio.duration);
    if (distKm == null && durSec == null) return null; // nothing filled in
    const elevM = Number(cardio.elevationGainM);
    const avgHr = Number(cardio.avgHr);
    const maxHr = Number(cardio.maxHr);
    const paceSecPerKm = distKm != null && durSec != null
      ? computePaceSecPerKm(distKm, durSec)
      : null;
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

  const createM = useDelayedMutation({
    mutationFn: () => {
      const cardioBody = buildCardioBody();
      // Filter exercises to ones the user actually filled in (a row
      // with no name and no reps/duration is just a placeholder).
      const realExercises = exercises.filter(
        (e) => e.name.trim() && e.sets.some((s) => s.reps > 0 || s.duration > 0),
      );
      return api<any>('/workouts', {
        method: 'POST',
        body: {
          type,
          name: name || undefined,
          duration,
          notes: notes || undefined,
          performedAt: localInputToIso(performedAt),
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
                    completed: !s.skipped,
                    skipped: !!s.skipped,
                    skipReason: s.skipped ? s.skipReason ?? 'OTHER' : null,
                  };
                }),
            };
          }),
        },
      });
    },
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
      setCardio(emptyCardio());
      setCardioOpen(false);
      setPerformedAt(toLocalInput(new Date()));
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
        <Panel
          variant="cyan"
          title="Log Session"
          scanline
          action={
            list.data?.items && list.data.items.length > 0 ? (
              <button
                type="button"
                onClick={copyLastSession}
                className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan hover:underline"
                title="Duplicate your most recent workout into the form"
              >
                ⎘ copy last
              </button>
            ) : null
          }
        >
          <div className="space-y-4">
            {/* Rest timer — useful between sets */}
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
                      onClick={() => {
                        const ev = new CustomEvent('set-rest', { detail: p.seconds });
                        window.dispatchEvent(ev);
                      }}
                      className="px-2 h-8 text-[10px] font-mono border border-ink-500/40 text-ink-300 hover:border-ink-300"
                      title={`Set timer to ${p.label}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 mb-1.5">Type</div>
              <div className="flex flex-wrap gap-2">
                {TYPE_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => {
                      setType(t.value);
                      // Auto-open the cardio block for cardio/other
                      // (anything that often isn't set-based).
                      if (t.value === 'CARDIO' || t.value === 'OTHER') {
                        setCardioOpen(true);
                      }
                    }}
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

            {/* -------- Non-set cardio block (hike / run / cycle / row / swim) -------- */}
            <CardioBlock
              cardio={cardio}
              setCardio={setCardio}
              open={cardioOpen}
              setOpen={setCardioOpen}
              units={units}
              parseDuration={parseDuration}
              formatDuration={formatDuration}
              computePaceSecPerKm={computePaceSecPerKm}
              distanceUnit={distanceUnit(units)}
            />

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

            {/* When did this happen? (date picker for backdating) */}
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
                  title="Wall-clock time of the session (your local time)"
                />
                {PERFORMED_AT_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      const d = new Date(Date.now() - p.minutes * 60_000);
                      setPerformedAt(toLocalInput(d));
                    }}
                    className="px-2 h-8 text-[10px] font-mono border border-ink-500/40 text-ink-300 hover:border-ink-300"
                    title={p.title}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="text-[10px] font-mono text-ink-400 mt-1">
                Default is "now". Pick a past time if logging a session you already did.
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
                                copy[i].sets[j] = s.skipped
                                  ? { ...s, skipped: false, skipReason: null }
                                  : { ...s, skipped: true, skipReason: s.skipReason ?? 'OTHER' };
                                setExercises(copy);
                              }}
                              className={classNames(
                                'text-xs',
                                s.skipped
                                  ? 'text-amber-400 hover:text-amber-300'
                                  : 'text-ink-400 hover:text-amber-400',
                              )}
                              title={s.skipped ? 'Un-skip this set' : 'Mark as skipped (injury, fatigue, etc.)'}
                            >
                              {s.skipped ? '⊘' : '○'}
                            </button>
                          )}
                          {ex.sets.length > 1 && (
                            <button
                              onClick={() => {
                                const copy = [...exercises];
                                copy[i].sets = copy[i].sets.filter((_, k) => k !== j);
                                setExercises(copy);
                              }}
                              className="text-ink-400 hover:text-neon-magenta text-xs"
                              title="Remove set"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                      {/* Skipped-set row: shows a small reason picker
                          under each set that was marked skipped. Stays
                          collapsed otherwise. */}
                      {ex.sets.some((s) => s.skipped) && (
                        <div className="mt-1 text-[10px] font-mono text-slate-400 space-y-1">
                          {ex.sets.map((s, j) =>
                            s.skipped ? (
                              <div key={j} className="flex items-center gap-2 flex-wrap">
                                <span className="text-amber-400">⊘ Set {j + 1} skipped</span>
                                <span className="text-slate-500">reason:</span>
                                <select
                                  className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[10px]"
                                  value={s.skipReason ?? 'OTHER'}
                                  onChange={(e) => {
                                    const copy = [...exercises];
                                    copy[i].sets[j] = { ...s, skipReason: e.target.value as SkipReason };
                                    setExercises(copy);
                                  }}
                                >
                                  {SKIP_REASONS.map((r) => (
                                    <option key={r} value={r}>
                                      {SKIP_REASON_LABEL[r]}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => {
                                    const copy = [...exercises];
                                    copy[i].sets[j] = { ...s, skipped: false, skipReason: null };
                                    setExercises(copy);
                                  }}
                                  className="text-ink-500 hover:text-neon-cyan text-[10px]"
                                >
                                  undo
                                </button>
                              </div>
                            ) : null,
                          )}
                        </div>
                      )}
                      <button
                        onClick={() => {
                          const copy = [...exercises];
                          copy[i].sets.push({ reps: 0, weight: 0, duration: 0, rpe: 0, skipped: false, skipReason: null });
                          setExercises(copy);
                        }}
                        className="btn-ghost text-[10px] mt-1"
                      >
                        + Set
                      </button>
                    </div>
                    {/* Plate calculator: only for strength exercises with a
                        non-zero target weight. Uses the first set's weight
                        (rest of the sets are usually the same). */}
                    {ex.type === 'STRENGTH' &&
                      ex.sets.length > 0 &&
                      (() => {
                        const targetRaw = ex.sets[0].weight || 0;
                        const bwDisplay = user?.weightKg
                          ? units === 'IMPERIAL'
                            ? Math.round(kgToLb(user.weightKg) * 10) / 10
                            : Math.round(user.weightKg * 10) / 10
                          : 0;
                        // For bodyweight: effective = profile (input disabled)
                        // For weighted-bodyweight: effective = profile + extra
                        // For standard barbell: effective = entered value
                        let w = 0;
                        if (isBw) w = bwDisplay;
                        else if (isWeightedBw) w = bwDisplay + targetRaw;
                        else w = targetRaw;
                        return w > 0 ? (
                          <PlateCalculator weight={w} units={units} />
                        ) : null;
                      })()}
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
                disabled={!hasUsableContent(exercises, cardio)}
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
                  {result.validityFlags && result.validityFlags.length > 0 && (
                    <div className="mt-2 text-amber-400 space-y-0.5">
                      <div className="font-display tracking-widest text-[10px] uppercase text-amber-300">
                        ⚠ Check these values
                      </div>
                      {result.validityFlags.map((f: ValidityFlag, idx: number) => (
                        <div key={idx} className="text-[10px]">
                          {f.exercise} set {f.setIndex + 1}: {f.field} = {f.value}
                          {f.reason === 'possible_typo'
                            ? ' — possibly a typo'
                            : ' — unusually high'}
                        </div>
                      ))}
                    </div>
                  )}
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

          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {filteredHistory.map((w) => {
              const totalVolume = w.exercises.reduce((acc, ex) => {
                return acc + ex.sets.reduce((s, set) => s + (set.weight ?? 0) * set.reps, 0);
              }, 0);
              const volDisplay = units === 'IMPERIAL'
                ? Math.round(kgToLb(totalVolume))
                : Math.round(totalVolume);
              const c: any = (w as any).cardio;
              const hasCardio = c && (c.distanceKm != null || c.durationSec != null);
              return (
                <div key={w.id} className="border border-ink-500/30 p-2 text-xs font-mono">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-display tracking-wider text-neon-cyan">
                      {w.name || w.type}
                    </span>
                    <span className="text-ink-400">{formatRelative(w.performedAt)}</span>
                  </div>
                  <div className="text-ink-300 text-[10px]">
                    {w.exercises.length > 0 && (
                      <>
                        {w.exercises.length} exercise{w.exercises.length !== 1 ? 's' : ''}
                        {volDisplay > 0 && (
                          <span className="ml-2 text-neon-cyan">{volDisplay.toLocaleString()} {weightUnitLabel(units)} vol</span>
                        )}
                      </>
                    )}
                    {hasCardio && (
                      <span className={w.exercises.length > 0 ? 'ml-2 text-neon-amber' : 'text-neon-amber'}>
                        ⚡ {c.distanceKm != null
                          ? `${(units === 'IMPERIAL' ? c.distanceKm / 1.609344 : c.distanceKm).toFixed(2)} ${units === 'IMPERIAL' ? 'mi' : 'km'}`
                          : ''}
                        {c.distanceKm != null && c.durationSec != null ? ' · ' : ''}
                        {c.durationSec != null ? formatDuration(c.durationSec) : ''}
                        {c.pace && (
                          <span className="text-ink-400 ml-1">
                            ({c.pace.toLowerCase().replace(/_/g, ' ')})
                          </span>
                        )}
                        {c.avgHr && <span className="text-ink-400 ml-1">· HR {c.avgHr}</span>}
                      </span>
                    )}
                    {w.exercises.length === 0 && !hasCardio && `${w.duration ?? 0}m`}
                  </div>
                  {w.exercises.length > 0 && (
                    <div className="text-ink-500 text-[10px] mt-0.5 truncate">
                      {w.exercises.slice(0, 3).map((ex) => ex.name).filter(Boolean).join(' · ')}
                      {w.exercises.length > 3 && ` +${w.exercises.length - 3} more`}
                    </div>
                  )}
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
