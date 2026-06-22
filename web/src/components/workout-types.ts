// Shared types + helpers for the workout logger form. Lives in
// its own file (not the .tsx component file) so Vite's React
// Fast Refresh can hot-reload the component cleanly without
// invalidating whenever a non-component helper changes.

import type { WorkoutType } from '@/lib/types';
import type { UnitSystem } from '@/lib/units';

export type DraftSet = {
  reps: number;
  /** Displayed in user's preferred unit (kg or lb). Converted
   * back to kg at submit time via weightToKg(). */
  weight: number;
  /** Seconds. For timed sets (plank, l-sit, etc.). */
  duration: number;
  rpe: number;
};

export type DraftExercise = { name: string; sets: DraftSet[] };

export function emptyExercise(): DraftExercise {
  return { name: '', sets: [{ reps: 0, weight: 0, duration: 0, rpe: 0 }] };
}

export const TYPE_OPTIONS: { value: WorkoutType; label: string; color: 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet' }[] = [
  { value: 'STRENGTH', label: 'Strength', color: 'cyan' },
  { value: 'HYPERTROPHY', label: 'Hypertrophy', color: 'magenta' },
  { value: 'CALISTHENICS', label: 'Calisthenics', color: 'lime' },
  { value: 'CARDIO', label: 'Cardio', color: 'amber' },
  { value: 'MOBILITY', label: 'Mobility', color: 'violet' },
  { value: 'OTHER', label: 'Other', color: 'cyan' },
];

export function kgToLb(kg: number): number { return kg * 2.20462; }
export function lbToKg(lb: number): number { return lb / 2.20462; }

export function weightToKg(displayed: number, units: UnitSystem): number | undefined {
  if (!displayed) return undefined;
  return units === 'IMPERIAL' ? lbToKg(displayed) : displayed;
}

export function weightUnitLabel(units: UnitSystem): string {
  return units === 'IMPERIAL' ? 'lb' : 'kg';
}

export function distanceUnit(units: UnitSystem): string {
  return units === 'IMPERIAL' ? 'mi' : 'km';
}

export function distanceInputToKm(val: number, units: UnitSystem): number {
  return units === 'IMPERIAL' ? val * 1.609344 : val;
}

/** datetime-local format helpers. The native input always uses
 * local time (no timezone), so the round-trip via toISOString
 * would lose the user's wall-clock selection. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(s: string): string {
  return new Date(s).toISOString();
}

/** Cardio (non-set) block. Used by CARDIO type or by freeform
 * types that include a distance component. */
export type CardioPace =
  | 'WALK_CASUAL' | 'WALK_BRISK' | 'JOG' | 'RUN' | 'SPRINT' | 'CRUISE' | 'INTERVALS';

export type DraftCardio = {
  distanceKm: string;
  duration: string;
  pace: CardioPace | '';
  elevationGainM: string;
  avgHr: string;
  maxHr: string;
  source: 'MANUAL' | 'GPS';
};

export function emptyCardio(): DraftCardio {
  return { distanceKm: '', duration: '', pace: '', elevationGainM: '', avgHr: '', maxHr: '', source: 'MANUAL' };
}

export function parseDuration(s: string): number | null {
  if (!s || !s.trim()) return null;
  const parts = s.trim().split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function hasUsableContent(
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

export function buildCardioBody(cardio: DraftCardio, units: UnitSystem): any | null {
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
