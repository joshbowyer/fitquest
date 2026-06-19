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
