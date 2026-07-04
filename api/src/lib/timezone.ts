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

/// Return the local-date (YYYY-MM-DD) at the given instant in the
/// given timezone. Used as a per-row bucket key for streak counting,
/// correlation analysis, daily-bucketed nudges, etc — anywhere a
/// record's calendar day matters in the user's frame of reference
/// rather than the server's.
///
/// Distinct from todayInTz() (which is "what is today's date?") and
/// from localMidnightUtc() (which returns a UTC instant). This one
/// returns a STRING suitable for use as a Map/Set key.
///
/// Falls back to the UTC date on Intl error so the bucket key is at
/// least well-defined (and matches what the rest of the codebase
/// used to do before this helper existed).
export function localDayKey(d: Date, tz: string | null): string {
  const t = tz || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: t,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/// Return the most recent Sunday 00:00 (in the given timezone) as a
/// UTC Date. Used by the Hardcore heart-regen cron: every Sunday
/// the user gets +1 heart. Always returns a Sunday at-or-before
/// `at`, never a future one (so we can compute "weeks elapsed
/// since last Sunday tick" without worrying about partial weeks).
export function lastSundayMidnightUtc(
  timezone: string | null,
  at: Date = new Date(),
): Date {
  const tz = timezone || "UTC";
  // Local-date for the anchor instant, then the weekday.
  const localDate = todayInTz(tz, at);
  const anchor = localMidnightUtc(localDate, tz);
  // getUTCDay: 0=Sun, 1=Mon, ... 6=Sat. We want the most recent Sun.
  const dow = anchor.getUTCDay();
  const daysBack = dow; // 0 on Sun, 1 on Mon, etc.
  return new Date(anchor.getTime() - daysBack * 24 * 60 * 60 * 1000);
}

/// Fractional hours since local midnight for the given instant in
/// the given IANA timezone. e.g. 22:30 local → 22.5. Used by the
/// FIT sleep parser to store the onset time as a fractional-hour
/// number (22.5 = 10:30 PM) in the `SLEEP_ONSET` Measurement row.
export function hoursSinceLocalMidnightInTz(
  at: Date,
  timezone: string | null,
): number {
  const tz = timezone || 'UTC';
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = dtf.formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
    const hh = get('hour');
    const mm = get('minute');
    const ss = get('second');
    return Math.round((hh * 3600 + mm * 60 + ss) / 36) / 100;
  } catch {
    return at.getUTCHours() + at.getUTCMinutes() / 60;
  }
}

/// Return the local midnight (as a UTC Date) of the calendar day
/// that "owns" a sleep onset at the given instant. Convention:
/// onsets between local 18:00 and 23:59 belong to that same calendar
/// day; onsets between local 00:00 and 11:59 belong to the previous
/// calendar day; onsets between 12:00 and 17:59 are daytime and we
/// bucket to the same day (post-lunch nap → that day).
///
/// The chart's X-axis uses the returned Date as the row label, so
/// a sleep that starts at 12:30 AM Monday shows on the Monday row,
/// not Sunday. That matches how the user thinks about it ("Monday's
/// sleep started Sunday night").
export function localNightStartInTz(
  at: Date,
  timezone: string | null,
): Date {
  const tz = timezone || 'UTC';
  const localHour = hoursSinceLocalMidnightInTz(at, tz);
  // Date-only string in the user's tz for `at`.
  const localDate = todayInTz(tz, at);
  // Post-midnight (00:00 – 11:59) → previous calendar day.
  // Daytime (12:00 – 17:59) → same day (unusual but possible for naps).
  // Evening (18:00 – 23:59) → same day.
  let nightDate: string;
  if (localHour < 12) {
    const prev = new Date(localMidnightUtc(localDate, tz).getTime() - 24 * 60 * 60 * 1000);
    nightDate = todayInTz(tz, prev);
  } else {
    nightDate = localDate;
  }
  return localMidnightUtc(nightDate, tz);
}

