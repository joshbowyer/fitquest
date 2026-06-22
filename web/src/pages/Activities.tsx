import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { formatRelative, formatSeconds, classNames, formatAbsolute } from '@/lib/format';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import type { Workout, WorkoutType } from '@/lib/types';
import { convertForDisplay, type UnitSystem } from '@/lib/units';
import { musclesForExercise, loadForExercise } from '@/lib/muscles';
import { ExerciseAutocomplete } from '@/components/ExerciseAutocomplete';
import { RestTimer, REST_PRESETS } from '@/components/RestTimer';

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
  return new Date(s).toISOString();
}

// Quick-pick shortcuts for the "Performed at" picker.
const PERFORMED_AT_PRESETS: { label: string; minutes: number; title: string }[] = [
  { label: 'Now',       minutes: 0,         title: 'Log at the current time' },
  { label: '−1h',       minutes: 60,        title: '1 hour ago' },
  { label: '−3h',       minutes: 180,       title: '3 hours ago' },
  { label: 'Yesterday', minutes: 60 * 24,   title: 'Same time yesterday' },
  { label: '−2d',       minutes: 60 * 48,   title: '2 days ago' },
];

// ============================================================================
// Non-set cardio (hike / run / cycle / row / swim)
// ============================================================================

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
  distanceKm: string;
  duration: string;
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

function computePaceSecPerKm(distanceKm: number, durationSec: number): number | null {
  if (distanceKm <= 0 || durationSec <= 0) return null;
  return Math.round(durationSec / distanceKm);
}

const distanceUnit = (units: UnitSystem) => (units === 'IMPERIAL' ? 'mi' : 'km');
const distanceInputToKm = (val: number, units: UnitSystem) => (units === 'IMPERIAL' ? val * 1.609344 : val);

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

function hasUsableContent(
  type: WorkoutType,
  exercises: DraftExercise[],
  cardio: DraftCardio,
  name: string,
  duration: number,
): boolean {
  // Strength types: at least one filled exercise row.
  if (type === 'STRENGTH' || type === 'HYPERTROPHY' || type === 'CALISTHENICS') {
    return exercises.some(
      (e) => e.name.trim() && e.sets.some((s) => s.reps > 0 || s.duration > 0),
    );
  }
  // Cardio: distance OR duration in the cardio block.
  if (type === 'CARDIO') {
    const dist = Number(cardio.distanceKm);
    const dur = parseDuration(cardio.duration);
    return (Number.isFinite(dist) && dist > 0) || (dur != null && dur > 0);
  }
  // Freeform (MOBILITY / OTHER): activity name + duration.
  return name.trim().length > 0 && duration > 0;
}

function CardioBlock({
  cardio,
  setCardio,
  open,
  setOpen,
  units,
  distanceUnit,
}: {
  cardio: DraftCardio;
  setCardio: (c: DraftCardio) => void;
  open: boolean;
  setOpen: (b: boolean) => void;
  units: UnitSystem;
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

export function ActivitiesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const units: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';
  const [type, setType] = useState<WorkoutType>('STRENGTH');
  const [name, setName] = useState('');
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState('');
  // performedAt — defaults to "now", can be backdated. datetime-local
  // string format (YYYY-MM-DDTHH:mm) so the native input round-trips.
  const [performedAt, setPerformedAt] = useState<string>(() => toLocalInput(new Date()));
  // Non-set cardio block. Shown when the user picks CARDIO type.
  // Server schema: api/prisma/schema.prisma Workout.cardio (JSONB).
  const [cardio, setCardio] = useState<DraftCardio>(emptyCardio());
  const [cardioOpen, setCardioOpen] = useState(false);
  const [exercises, setExercises] = useState<DraftExercise[]>([emptyExercise()]);
  const [result, setResult] = useState<any | null>(null);
  const [selectedExerciseIdx, setSelectedExerciseIdx] = useState<number | null>(null);

  // History filters. Default to 'all' because the user routinely
  // bulk-imports a season of workouts at once (e.g. Gadgetbridge's
  // /tmp/gadgetbridge/ACTIVITY/*.fit dump). The '30d' default from
  // earlier was hiding anything older than a month — the user
  // kept wondering where the FIT imports went. The API caps the
  // page at 200 (see api/src/routes/workouts.ts), which covers a
  // couple of years of daily activity.
  const [historyFilter, setHistoryFilter] = useState<'all' | '7d' | '30d' | '90d'>('all');
  const [exerciseFilter, setExerciseFilter] = useState('');

  const list = useQuery({
    queryKey: ['workouts'],
    queryFn: () => api<{ items: Workout[]; total: number }>('/workouts?limit=100'),
  });

  // Copy last session helper. Matches the new type-specific form
  // shapes: for CARDIO it pre-fills the cardio block (and clears
  // the unused exercise list), for freeform types it just copies
  // the name + duration + notes, for strength types it pre-fills
  // the exercise list.
  function copyLastSession() {
    if (!list.data?.items.length) return;
    const last = list.data.items[0];
    setType(last.type);
    setName(last.name ? `${last.name} (copy)` : '');
    setDuration(last.duration ?? 60);
    setNotes(last.notes ?? '');
    if (last.type === 'CARDIO') {
      if ((last as any).cardio) {
        setCardio(cardioToDraft((last as any).cardio, units));
        setCardioOpen(true);
      } else {
        setCardio(emptyCardio());
        setCardioOpen(true);
      }
      setExercises([emptyExercise()]);
    } else if (last.type === 'MOBILITY' || last.type === 'OTHER') {
      setCardio(emptyCardio());
      setCardioOpen(false);
      setExercises([emptyExercise()]);
    } else {
      setExercises(workoutToDraft(last, units));
      setCardio(emptyCardio());
      setCardioOpen(false);
    }
  }

  // Honor ?copyFrom=<workoutId> from the detail page. We fetch that one
  // workout directly (instead of scanning the list, which may paginate
  // and not include older entries) and pre-fill the form.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const copyFrom = searchParams.get('copyFrom');
    if (!copyFrom) return;
    api<{ item: Workout }>(`/workouts/${copyFrom}`)
      .then((r) => {
        if (r.item) {
          setExercises(workoutToDraft(r.item, units));
          setName(r.item.name ? `${r.item.name} (copy)` : '');
          setDuration(r.item.duration ?? 60);
          setNotes(r.item.notes ?? '');
        }
        // Strip the query param so refreshes don't re-copy.
        const next = new URLSearchParams(searchParams);
        next.delete('copyFrom');
        setSearchParams(next, { replace: true });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('copyFrom')]);

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
  // user hasn't filled in anything useful so the server can leave the
  // field as-is. Distance is converted to km before sending; pace is
  // preserved; GPS source is preserved (the importer will pre-fill
  // these from trackJson).
  function buildCardioBody(): any | null {
    const distRaw = Number(cardio.distanceKm);
    const distKm = Number.isFinite(distRaw) && distRaw > 0
      ? Math.round(distanceInputToKm(distRaw, units) * 1000) / 1000
      : null;
    const durSec = parseDuration(cardio.duration);
    if (distKm == null && durSec == null) return null;
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
      // Filter exercises to ones the user actually filled in.
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
      <PageHeader title="// Activities" subtitle="Log a session. Auto-detect PRs. Gain XP." />

      {/* Side-by-side layout: Log Session (left, ~66%) + History (right, ~33%).
          Stacks vertically below the lg breakpoint so phone users get a
          single-column scroll. The History list itself stays single-column
          even at lg — the previous 3-col grid crushed the activity cards
          and made volumes/dates hard to read. */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 items-start">

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
                      // Auto-expand the cardio block the first time
                      // the user picks CARDIO. For OTHER we used to
                      // expand it too, but the new freeform form
                      // renders its own banner; the cardio block
                      // only makes sense for CARDIO now.
                      if (t.value === 'CARDIO' && !cardioOpen) {
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

              {/* Form sections — only one renders at a time based on type:
                  - STRENGTH/HYPERTROPHY/CALISTHENICS: exercise list (sets × reps × weight)
                  - CARDIO: non-set CardioBlock (distance + duration + pace + HR)
                  - MOBILITY/OTHER: freeform activity (name + duration + notes)
                The "Name" + "Duration" pair above stays — for freeform
                types the Name IS the activity name (e.g. "Jumprope"),
                for strength it's an optional session label. */}
              {isStrength && (
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
                              'grid grid-cols-1 sm:grid-cols-[20px_1fr_1fr_1fr_1fr_30px]',
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
                            ) : isBw ? (
                              <input
                                className="input-neon text-xs opacity-40 cursor-not-allowed"
                                type="number"
                                disabled
                                placeholder="BW"
                                title="Bodyweight exercise — uses your profile bodyweight"
                              />
                            ) : (
                              <input
                                className="input-neon text-xs opacity-40 cursor-not-allowed"
                                type="number"
                                disabled
                                placeholder="—"
                                title="Weight doesn't apply to this workout type"
                              />
                            )}
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
              )}

              {/* Non-set cardio block (hike / run / cycle / row / swim).
                  Only rendered when type is CARDIO — for strength
                  types the old "always present, collapsed" banner was
                  visual noise; for freeform types the cardio-specific
                  fields (pace / distance / HR) don't apply. */}
              {isCardio && (
                <CardioBlock
                  cardio={cardio}
                  setCardio={setCardio}
                  open={cardioOpen}
                  setOpen={setCardioOpen}
                  units={units}
                  distanceUnit={distanceUnit(units)}
                />
              )}

              {/* Freeform activity form for MOBILITY/OTHER. Just name +
                  duration + notes. For jumprope, rock climbing, hiking
                  (without GPS), stretching, etc. The top-of-form Name +
                  Duration fields above are reused: the "Name" is the
                  activity name (e.g. "Jumprope"), "Duration" is the
                  total session time in minutes. */}
              {isTimed && (
                <div className="border border-neon-violet/30 p-3 space-y-2">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-neon-violet/80">
                    ◌ Freeform activity
                    <span className="text-ink-500 normal-case tracking-normal ml-2">
                      · {type === 'MOBILITY' ? 'mobility / stretching / yoga' : 'misc: jumprope, climbing, hike, …'}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-ink-400">
                    The "Name" + "Duration" fields above define this session.
                    Add optional notes below (e.g. "5 boulder problems V0–V2",
                    "10 sets of 100 jumps", "rope 5.10a/b").
                  </div>
                </div>
              )}

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

            {/* The exercise list is rendered above conditionally
                (only for STRENGTH/HYPERTROPHY/CALISTHENICS). For
                CARDIO we show the cardio block, for MOBILITY/OTHER
                we show the freeform activity banner. The single
                Notes textarea below applies to all types. */}

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
                disabled={!hasUsableContent(type, exercises, cardio, name, duration)}
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

      {/* History (full width, below the log block) */}
      <Panel
        variant="magenta"
        title="History"
        className="mt-4"
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

        {/* Single-column history list — see comment on the side-by-side
            grid above for why we don't multi-col here. Each card needs
            its own row to keep volumes / dates / FIT metrics readable. */}
        <div className="space-y-2 max-h-[80vh] overflow-y-auto pr-1">
          {filteredHistory.map((w) => (
            <ActivityCard key={w.id} workout={w} units={units} timezone={user?.timezone ?? null} />
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

function ActivityCard({ workout: w, units, timezone }: { workout: any; units: UnitSystem; timezone?: string | null }) {
  const navigate = useNavigate();
  const totalVolume = (w.exercises ?? []).reduce((acc: number, ex: any) => {
    return acc + (ex.sets ?? []).reduce((s: number, set: any) => s + (set.weight ?? 0) * set.reps, 0);
  }, 0);
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
        'border p-3 text-left transition-all hover:border-neon-cyan/60',
        isFitImport
          ? 'border-neon-amber/40 bg-neon-amber/5'
          : 'border-ink-500/30 bg-bg-700/40',
      )}
    >
      <div className="flex justify-between items-baseline mb-1 gap-2">
        <span className="font-display tracking-wider text-sm text-neon-cyan truncate">
          {w.name || w.type}
        </span>
        <span className="text-[10px] font-mono text-ink-400 shrink-0 text-right" title={`${new Date(w.performedAt).toISOString()} (UTC)`}>
          {formatAbsolute(w.performedAt, timezone ?? null)}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-ink-300 mb-1">
        <span>{w.type}</span>
        <span>· {w.duration ?? 0}m</span>
        {volDisplay > 0 && (
          <span className="text-neon-cyan">{volDisplay.toLocaleString()} {weightUnitLabel(units)} vol</span>
        )}
        {isFitImport && <span className="text-neon-amber">⟂ FIT</span>}
        {(() => {
          // Non-set cardio block summary. Show distance + duration
          // + pace label so the history card stays informative.
          const c = w.cardio;
          if (!c) return null;
          const parts: string[] = [];
          if (c.distanceKm != null) {
            const d = units === 'IMPERIAL' ? c.distanceKm / 1.609344 : c.distanceKm;
            parts.push(`${d.toFixed(2)} ${units === 'IMPERIAL' ? 'mi' : 'km'}`);
          }
          if (c.durationSec != null) parts.push(formatDuration(c.durationSec));
          if (c.pace) parts.push(c.pace.toLowerCase().replace(/_/g, ' '));
          if (parts.length === 0) return null;
          return <span className="text-neon-amber">⚡ {parts.join(' · ')}</span>;
        })()}
      </div>

      {/* Key FIT metrics */}
      {fitMetrics && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-ink-300 mb-1">
          {fitMetrics.distance != null && (
            <span>{(() => {
              // distance stored in meters; convert to user units via
              // the shared units util so we match the rest of the app.
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

      {/* Strength exercises preview */}
      {!isFitImport && (
        <div className="text-[10px] font-mono text-ink-500 truncate">
          {w.exercises.slice(0, 3).map((ex: any) => ex.name).filter(Boolean).join(' · ')}
          {w.exercises.length > 3 && ` +${w.exercises.length - 3} more`}
        </div>
      )}

      <div className="text-[9px] font-mono text-ink-500 mt-1">→ open</div>
    </button>
  );
}

/** Parse the [FIT] <sport> · distance · ... notes string written by
 *  the import route so the activity card can show key metrics without
 *  re-parsing the FIT file. */
function parseFitNotes(notes: string): {
  sport?: string;
  distance?: number; // meters
  avgHr?: number;
  maxHr?: number;
  calories?: number;
  avgPower?: number;
  np?: number;
} {
  const out: any = {};
  // Format is "[FIT] <sport>[/<subsport>] · X.XX km · avg HR N · max HR N · N kcal · avg NW · NP NW · RPE N"
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
    } else if (!out.sport) {
      // First token (e.g. "running" or "running/street")
      out.sport = p;
    }
  }
  return out;
}
