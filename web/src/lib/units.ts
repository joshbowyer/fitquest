export type UnitSystem = 'METRIC' | 'IMPERIAL';

const CM_TO_IN = 0.393701;
const KG_TO_LB = 2.20462;
const ML_TO_FL_OZ = 0.033814;

const IMPERIAL_UNIT_MAP: Record<string, string> = {
  cm: 'in',
  kg: 'lb',
  ml: 'fl oz',
};

const METRIC_UNIT_MAP: Record<string, string> = {
  in: 'cm',
  lb: 'kg',
  'fl oz': 'ml',
};

/**
 * Convert a stored metric value (always in metric) into the user's display
 * unit system. Returns the converted value and the display unit label.
 * Units that don't convert (s, h, bpm, /10, ms, kcal, %) pass through.
 */
export function convertForDisplay(
  value: number,
  unit: string,
  system: UnitSystem
): { value: number; unit: string } {
  if (system === 'METRIC') return { value, unit };
  switch (unit) {
    case 'cm':
      return { value: value * CM_TO_IN, unit: 'in' };
    case 'kg':
      return { value: value * KG_TO_LB, unit: 'lb' };
    case 'ml':
      return { value: value * ML_TO_FL_OZ, unit: 'fl oz' };
    default:
      return { value, unit };
  }
}

/**
 * Convert a value entered by the user in their preferred unit system back
 * to the stored metric value + unit. Used by forms.
 */
export function convertForStorage(
  value: number,
  unit: string,
  system: UnitSystem
): { value: number; unit: string } {
  if (system === 'METRIC') return { value, unit };
  switch (unit) {
    case 'in':
      return { value: value / CM_TO_IN, unit: 'cm' };
    case 'lb':
      return { value: value / KG_TO_LB, unit: 'kg' };
    case 'fl oz':
      return { value: value / ML_TO_FL_OZ, unit: 'ml' };
    default:
      return { value, unit };
  }
}

/** Map a base metric unit to the display unit for the given system. */
export function displayUnit(unit: string, system: UnitSystem): string {
  if (system === 'METRIC') return unit;
  return IMPERIAL_UNIT_MAP[unit] ?? unit;
}

/** Map a user-entered display unit back to the base metric unit. */
export function storageUnit(unit: string, system: UnitSystem): string {
  if (system === 'METRIC') return unit;
  return METRIC_UNIT_MAP[unit] ?? unit;
}

/** Display a metric value with the right unit and decimals for the system. */
export function formatInUnits(
  value: number,
  unit: string,
  system: UnitSystem
): string {
  if (!Number.isFinite(value)) return '—';
  const { value: v, unit: u } = convertForDisplay(value, unit, system);
  if (u === '/10') return `${Math.round(v)}/10`;
  if (u === 's') return formatSecondsLocal(v);
  if (u === 'h') return `${v.toFixed(1)} h`;
  if (u === 'kg' || u === 'lb' || u === 'cm' || u === 'in') {
    return `${v.toFixed(1)} ${u}`;
  }
  if (u === 'kcal' || u === 'g' || u === 'ml' || u === 'fl oz' || u === 'bpm' || u === 'ms') {
    return `${Math.round(v)} ${u}`;
  }
  return `${v} ${u}`;
}

function formatSecondsLocal(v: number): string {
  const s = Math.max(0, Math.round(v));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${r.toString().padStart(2, '0')}` : `${r}s`;
}

/** Round a converted value to sensible decimals. */
export function roundForUnits(value: number, unit: string): number {
  if (unit === 's' || unit === 'bpm' || unit === '/10' || unit === 'ms' || unit === 'kcal' || unit === 'g' || unit === 'ml' || unit === 'fl oz') {
    return Math.round(value);
  }
  return Math.round(value * 10) / 10;
}
