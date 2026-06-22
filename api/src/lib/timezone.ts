/**
 * Timezone-aware date helpers shared across routes that answer
 * "what's today's date for this user?" / "what's the UTC instant
 * of local midnight?".
 *
 * Why this exists: just doing `Date.now() - 24 * 3600 * 1000` is
 * wrong for the "today" question — it leaks yesterday's late
 * evening entries into today's view (e.g. water logged at 6pm
 * yesterday is still "today" if you check at 10am). The same bug
 * bit meals.ts and dailies.ts in the past. Centralising the
 * helpers so /measurements?days=1, /meals/today, /dailies/today,
 * and the morning report all agree on "today".
 */

/// Return the user's local-date (YYYY-MM-DD) at the given instant.
/// Falls back to UTC if the timezone is missing/invalid so the
/// server never returns a 500 for a bad tz string.
export function todayInTz(timezone: string | null, at: Date = new Date()): string {
  const tz = timezone || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/// Return the timezone offset (in minutes) for the given IANA tz
/// at the given UTC instant. Uses Intl.DateTimeFormat with the
/// 'longOffset' tzName, which returns strings like 'GMT-04:00' or
/// 'GMT+05:30' (handles half-hour zones correctly). Returns 0 for
/// UTC or on any error so the fallback is "today = UTC", never
/// "yesterday" or "tomorrow".
export function tzOffsetMinutes(timezone: string, at: Date = new Date()): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, timeZoneName: 'longOffset',
    });
    const parts = dtf.formatToParts(at);
    const offset = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
    // Parse "GMT-04:00" / "GMT+05:30" / "GMT" / "UTC".
    const m = offset.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    if (!m) return 0;
    const sign = m[1] === '+' ? 1 : -1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? '0'));
  } catch {
    return 0;
  }
}

/// Get the UTC instant for local midnight on a given local-date
/// string (YYYY-MM-DD). The local-date is interpreted in the user's
/// timezone; the function returns the UTC equivalent of local 00:00.
/// This is the lower boundary that "today" / "yesterday" filters use.
export function localMidnightUtc(localDate: string, timezone: string): Date {
  const offsetMin = tzOffsetMinutes(timezone, new Date(`${localDate}T12:00:00Z`));
  // The 12:00 UTC anchor is just to pick a DST-safe instant; we only
  // care about the offset for that calendar day.
  return new Date(new Date(`${localDate}T00:00:00Z`).getTime() - offsetMin * 60_000);
}