// =============================================================================
// Timezone-aware date helpers for the web.
// =============================================================================
//
// The server's local timezone is usually UTC (containers, CI, Vercel
// etc). When the UI says "today" or "this morning", we want the
// USER's local time, not the server's. Mirrors api/src/lib/timezone.ts
// so the same data path produces the same answer client- and server-side.

/// Return the user's local date (YYYY-MM-DD) at the given instant.
/// Falls back to UTC if the timezone is missing/invalid.
export function todayInTz(
  timezone: string | null,
  at: Date = new Date(),
): string {
  const tz = timezone || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/// Return the local hour-of-day (0-23) at the given instant in the
/// given timezone. Used for "is this AM/PM/window-X" decisions on
/// the client.
export function getLocalHour(at: Date, timezone: string | null): number {
  const tz = timezone || 'UTC';
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', hour12: false,
    });
    const parts = fmt.formatToParts(at);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    return h === 24 ? 0 : h;
  } catch {
    return at.getUTCHours();
  }
}

/// Return the day-of-week (0=Sun..6=Sat) at the given instant.
export function getLocalDayOfWeek(at: Date, timezone: string | null): number {
  const tz = timezone || 'UTC';
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short',
    });
    const wd = fmt.format(at);
    const map: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return map[wd] ?? at.getUTCDay();
  } catch {
    return at.getUTCDay();
  }
}

/// UTC instant for the START of the user's local today (00:00 local).
export function localTodayStartUtc(
  timezone: string | null,
  at: Date = new Date(),
): Date {
  const dateStr = todayInTz(timezone, at);
  const noonUtc = new Date(`${dateStr}T12:00:00Z`);
  const offsetMin = tzOffsetMinutes(timezone, noonUtc);
  return new Date(noonUtc.getTime() - offsetMin * 60_000);
}

/// UTC instant for the END of the user's local today (23:59:59.999).
export function localTodayEndUtc(
  timezone: string | null,
  at: Date = new Date(),
): Date {
  const start = localTodayStartUtc(timezone, at);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

function tzOffsetMinutes(timezone: string, at: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, timeZoneName: 'longOffset',
    });
    const parts = dtf.formatToParts(at);
    const offset = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
    const m = offset.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    if (!m) return 0;
    const sign = m[1] === '+' ? 1 : -1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? '0'));
  } catch {
    return 0;
  }
}
