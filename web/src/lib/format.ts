export function formatNumber(v: number, digits = 1): string {
  if (Number.isNaN(v) || v == null) return '—';
  return v.toFixed(digits);
}

export function formatSeconds(v: number): string {
  if (!Number.isFinite(v) || v == null) return '—';
  const s = Math.max(0, Math.round(v));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${r.toString().padStart(2, '0')}` : `${r}s`;
}

export function formatPct(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function formatDate(s: string | Date): string {
  const d = typeof s === 'string' ? new Date(s) : s;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Format an ISO date in the user's preferred timezone (IANA name).
 *  Returns absolute date + 24h time, e.g. "Jun 20, 2026, 09:46 EDT".
 *  If `tz` is null/undefined, falls back to the browser's local zone. */
export function formatAbsolute(
  s: string | Date,
  tz: string | null | undefined,
): string {
  const d = typeof s === 'string' ? new Date(s) : s;
  if (!tz) {
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  try {
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz,
      timeZoneName: 'short',
    });
  } catch {
    return d.toLocaleString();
  }
}

export function formatRelative(s: string | Date): string {
  const d = typeof s === 'string' ? new Date(s) : s;
  const diff = Date.now() - d.getTime();
  const s_ = Math.floor(diff / 1000);
  if (s_ < 60) return `${s_}s ago`;
  const m = Math.floor(s_ / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dys = Math.floor(h / 24);
  if (dys < 30) return `${dys}d ago`;
  return formatDate(d);
}

export function classNames(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(' ');
}

// Format a metric value based on its unit
export function formatMetricValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  if (unit === 's') return formatSeconds(value);
  if (unit === '%' || unit === '/10' || unit === 'ms' || unit === 'bpm') return value.toFixed(0);
  if (unit === 'h') return `${value.toFixed(1)} h`;
  if (unit === 'kg' || unit === 'cm') return value.toFixed(1);
  // Default: integer for whole-number units
  return Math.round(value).toString();
}

export function formatMetricWithUnit(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  if (unit === '/10') return `${Math.round(value)}/10`;
  if (unit === 's') return formatSeconds(value);
  if (unit === 'h') return `${value.toFixed(1)} h`;
  if (unit === 'kg' || unit === 'cm') return `${value.toFixed(1)} ${unit}`;
  if (unit === 'kcal' || unit === 'g' || unit === 'ml' || unit === 'bpm' || unit === 'ms') {
    return `${Math.round(value)} ${unit}`;
  }
  return `${value} ${unit}`;
}
