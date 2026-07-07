import { prisma } from './prisma.js';

/**
 * Open-Meteo client + DB cache for the /forecast page.
 *
 * Open-Meteo (https://open-meteo.com) is a free, no-API-key weather
 * API. Free tier is 10,000 requests/day — generous for a personal
 * app, but a single user hot-reloading the page could still burn
 * the budget in an afternoon. We cache the response in
 * WeatherCache keyed by a rounded lat/lng (same scheme as
 * GeoCache: 3 decimals ≈ 110m grid) with a 1-hour TTL — which
 * matches Open-Meteo's own update cadence for the forecast fields
 * we care about.
 *
 * The cache payload stores weather + air-quality under the same
 * key (both endpoints serve from the same data center for a given
 * coordinate, and they share the same effective update cadence).
 * On a cache miss we hit both endpoints in parallel.
 *
 * On any fetch error (network, non-2xx, malformed JSON) we return
 * null so the caller can fall back to a "weather unavailable" UI
 * state instead of crashing the page.
 */

const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export type CurrentWeather = {
  temperature: number;       // °F (we pass temperature_unit=fahrenheit)
  apparentTemperature: number;
  humidity: number;          // %
  windSpeed: number;         // mph
  windGusts: number;         // mph
  precipitation: number;     // current mm equivalent
  weatherCode: number;       // WMO weather code
  isDay: boolean;
  time: string;              // ISO timestamp from the API
};

export type DailyWeather = {
  date: string;              // YYYY-MM-DD
  weatherCode: number;
  tempMax: number;           // °F
  tempMin: number;           // °F
  precipSum: number;         // mm
  precipProbabilityMax: number; // %
  windMax: number;           // mph
  insight: DayInsight;
};

// Per-day training recommendation. Computed server-side from
// the hourly forecast so the client just renders. The "best
// window" is the contiguous 2-hour stretch that best satisfies
// rings (low wind, no precip), running (cool apparent temp, low
// precip), or just being outdoors in general — we pick the best
// 2-hour window regardless of activity, then per-activity
// ratings tell the user which exercises to slot into it.
export type DayInsight = {
  verdict: 'go' | 'caution' | 'skip';
  headline: string;             // one-liner (e.g. "Hot — train before 9am")
  bestWindow: {
    startHour: number;          // local hour, 0-23
    endHour: number;            // local hour, 0-23 (exclusive)
    apparentTempF: number;      // °F, average across the window
    precipProbability: number;  // % max across the window
    windGustMph: number;        // mph max across the window
    label: string;              // e.g. "7-9am, 78°F"
  } | null;
  peakHeat: {
    hour: number;               // local hour, 0-23
    apparentTempF: number;
    label: string;              // e.g. "peaks 4pm at 103°F"
  } | null;
  uvPeak: number;               // 0-11+ scale; -1 if unknown
  activityAdvice: {
    rings: ActivityRating;
    running: ActivityRating;
    walking: ActivityRating;
  };
};

export type ActivityRating = {
  verdict: 'ok' | 'caution' | 'skip';
  reason: string;
};

export type Forecast = {
  latitude: number;
  longitude: number;
  timezone: string;
  units: { temperature: 'fahrenheit'; windSpeed: 'mph' };
  current: CurrentWeather;
  daily: DailyWeather[];     // 3 entries, today + 2 days
  fetchedAt: string;         // ISO
  cached: boolean;
};

// US EPA Air Quality Index bands. Open-Meteo's `us_aqi` value
// ranges 0-500; we bucket to the EPA's standard categories.
// Reference: https://www.airnow.gov/aqi/aqi-basics/
export type UsAqiBand = 'good' | 'moderate' | 'unhealthySensitive' | 'unhealthy' | 'veryUnhealthy' | 'hazardous' | 'unknown';

export type AirQuality = {
  latitude: number;
  longitude: number;
  timezone: string;
  current: {
    usAqi: number | null;
    pm25: number | null;      // μg/m³
    pm10: number | null;      // μg/m³
    band: UsAqiBand;
    time: string;             // ISO
  };
  daily: Array<{
    date: string;             // YYYY-MM-DD
    pm25Max: number | null;   // μg/m³
    pm10Max: number | null;   // μg/m³
    usAqiMax: number | null;
    band: UsAqiBand;
  }>;
  fetchedAt: string;
  cached: boolean;
};

function round3(n: number): string {
  return Math.round(n * 1000) / 1000 + '';
}

function keyOf(lat: number, lng: number): string {
  return `${round3(lat)}_${round3(lng)}`;
}

/**
 * Map a US AQI number to its EPA band label + accent color.
 * 0-50 Good, 51-100 Moderate, 101-150 USG, 151-200 Unhealthy,
 * 201-300 Very Unhealthy, 301-500 Hazardous.
 */
export function usAqiBand(aqi: number | null): UsAqiBand {
  if (aqi == null || !Number.isFinite(aqi)) return 'unknown';
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'unhealthySensitive';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'veryUnhealthy';
  return 'hazardous';
}

export const AQI_BAND_META: Record<UsAqiBand, { label: string; short: string; tone: 'lime' | 'cyan' | 'amber' | 'magenta'; advice: string }> = {
  good:              { label: 'Good',              short: '✓', tone: 'lime',    advice: 'Air quality is fine. Train outside without concern.' },
  moderate:          { label: 'Moderate',          short: '○', tone: 'cyan',    advice: 'Acceptable for most. Sensitive groups should consider a lighter session.' },
  unhealthySensitive:{ label: 'Unhealthy for sensitive groups', short: '!', tone: 'amber', advice: 'Asthma / heart conditions: prefer inside or short outside work.' },
  unhealthy:         { label: 'Unhealthy',         short: '✗', tone: 'magenta', advice: 'Everyone may feel effects. Move the workout inside today.' },
  veryUnhealthy:     { label: 'Very Unhealthy',    short: '✗', tone: 'magenta', advice: 'Emergency conditions for at-risk groups. Stay inside.' },
  hazardous:         { label: 'Hazardous',         short: '✗', tone: 'magenta', advice: 'Health alert — do not train outside.' },
  unknown:           { label: 'No data',           short: '?', tone: 'cyan',    advice: 'Air quality data unavailable for this location.' },
};

/**
 * Map WMO weather codes (used by Open-Meteo) to a short label +
 * icon glyph. Codes 0-99 are standardized by the World
 * Meteorological Organization. We bucket to ~10 conditions.
 * Reference: https://open-meteo.com/en/docs (search "WMO Weather
 * interpretation codes").
 */
export function weatherCodeMeta(code: number): { label: string; icon: string } {
  if (code === 0) return { label: 'Clear', icon: '☀' };
  if (code <= 3) return { label: 'Partly cloudy', icon: '⛅' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: '☁' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: '☂' };
  if (code >= 61 && code <= 67) return { label: 'Rain', icon: '☂' };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: '❄' };
  if (code >= 80 && code <= 82) return { label: 'Rain showers', icon: '☂' };
  if (code === 85 || code === 86) return { label: 'Snow showers', icon: '❄' };
  if (code >= 95) return { label: 'Thunderstorm', icon: '⚡' };
  return { label: 'Unknown', icon: '○' };
}

/**
 * Heuristic: is this weather OK for outdoor exercise (rings,
 * running, calisthenics)? Score is binary — yes or no — but the
 * reason string explains why. Tuned by feel for the "feels
 * dangerous to be outside" cases rather than perfection.
 *
 * Deprecated in favor of `summarizeDay()` which produces a
 * richer DayInsight (best window, per-activity advice, peak
 * heat). Kept for back-compat with any old callers.
 */
export function isOutdoorFriendly(daily: DailyWeather): { ok: boolean; reason: string } {
  // Map the new insight shape back to the legacy {ok, reason}
  // shape so any old callers keep working.
  const i = daily.insight;
  const ok = i.verdict !== 'skip';
  return { ok, reason: i.headline };
}

// ============================================================
// summarizeDay — the new insight engine.
// ============================================================

export type HourlyWeather = {
  time: string[];              // ISO timestamps
  temperature: number[];       // °F
  apparentTemperature: number[]; // °F
  precipitationProbability: number[]; // %
  precipitation: number[];     // mm
  weatherCode: number[];
  windSpeed: number[];         // mph
  windGusts: number[];         // mph
  uvIndex: number[];
};

// Pure helper: convert "2026-07-02T07:00" to local hour 7.
// Open-Meteo's timezone=auto response already includes the
// local-zone timestamp, so we just parse the hour field.
function localHour(iso: string): number {
  const m = iso.match(/T(\d{2})/);
  return m ? Number(m[1]) : 0;
}

// Score an hour for "is this a good time to train outside?".
// Lower is better; we pick the lowest-scoring contiguous window.
function scoreHour(
  h: number,             // 0-23 local hour
  apparentTempF: number,
  precipProb: number,
  windGustMph: number,
  weatherCode: number,
): number {
  // Penalize nighttime hours (people don't run at 3am).
  let s = 0;
  if (h < 5 || h >= 22) s += 50;
  else if (h < 7) s += 10;       // early but doable
  else if (h >= 19) s += 5;      // evening slightly preferred
  // Heat penalty (apparent temp). <70° ideal, 90° gets a 30-pt
  // penalty, >100° gets a 60-pt penalty on top.
  if (apparentTempF > 100) s += 60;
  else if (apparentTempF > 95) s += 40;
  else if (apparentTempF > 90) s += 25;
  else if (apparentTempF > 85) s += 12;
  else if (apparentTempF < 25) s += 30;
  else if (apparentTempF < 32) s += 12;
  // Precip probability — the killer for rings especially.
  s += precipProb * 0.5;          // 0-50 pts for 0-100% precip prob
  // Wind. <15mph fine, 15-25 OK for most things, 25-35 OK for
  // running, >35 starts breaking ring straps.
  if (windGustMph > 35) s += 30;
  else if (windGustMph > 25) s += 15;
  else if (windGustMph > 20) s += 8;
  // Thunderstorms / heavy precip: hard no.
  if (weatherCode >= 95) s += 80;
  // WMO codes 71-77 = steady snow (slight → heavy + snow grains);
  // 85-86 = snow showers. Codes 80-82 are RAIN showers, not snow —
  // the old 71-86 range was eating them. (Atlanta in July returning
  // "Heavy snow" with code 82 was the bug this fix.)
  else if (isSnowCode(weatherCode)) s += 40;
  else if (weatherCode >= 61 && weatherCode <= 67) s += 25; // rain
  return s;
}

/**
 * WMO weather codes for snow (not sleet/rain). Snow falls in
 * 71-77 (steady snow at varying intensity + snow grains) and
 * 85-86 (snow showers). Codes 78-79 are unspecified, 80-82 are
 * rain showers, 83-84 are unknown/rain showers per the WMO
 * spec — none of which should be labeled as snow.
 */
export function isSnowCode(code: number): boolean {
  return (code >= 71 && code <= 77) || code === 85 || code === 86;
}

/**
 * Build a per-day training recommendation from the hourly
 * forecast plus the daily aggregates. Pure function — no I/O —
 * so it's easy to unit-test.
 *
 * Scoring is by-feel (no exercise-science paper is going to tell
 * you "above 95°F apparent temp, running gets a 40-pt penalty")
 * but the buckets line up with common outdoor-training
 * guidelines: heat illness risk climbs steeply above 90°F, ring
 * work in >25mph gusts is sketchy, etc.
 */
export function summarizeDay(
  date: string,
  hourly: HourlyWeather,
  daily: { tempMax: number; tempMin: number; precipSum: number; precipProbabilityMax: number; windMax: number; weatherCode: number },
): DayInsight {
  // Slice hourly to this day's samples.
  const dayHourly = hourly.time
    .map((t, i) => ({ idx: i, hour: localHour(t), date: t.slice(0, 10) }))
    .filter((x) => x.date === date);

  // Find peak heat hour.
  let peakHeat: DayInsight['peakHeat'] = null;
  for (const { idx, hour } of dayHourly) {
    const at = hourly.apparentTemperature[idx];
    if (at == null || !Number.isFinite(at)) continue;
    if (!peakHeat || at > peakHeat.apparentTempF) {
      peakHeat = {
        hour,
        apparentTempF: at,
        label: `peaks ${formatHour(hour)} at ${Math.round(at)}°F`,
      };
    }
  }

  // Find peak UV.
  let uvPeak = -1;
  for (const { idx } of dayHourly) {
    const u = hourly.uvIndex[idx];
    if (u == null || !Number.isFinite(u)) continue;
    if (u > uvPeak) uvPeak = u;
  }

  // Find best 2-hour contiguous window. Slide a 2-wide window
  // across the day and pick the one with the lowest combined
  // hour-score. We only consider 5am-9pm so we're not picking
  // midnight as the "best" 2-hour window just because temps are
  // mild then.
  let bestWindow: DayInsight['bestWindow'] = null;
  if (dayHourly.length >= 2) {
    const scored = dayHourly.map((x) => ({
      hour: x.hour,
      score: scoreHour(
        x.hour,
        hourly.apparentTemperature[x.idx] ?? 999,
        hourly.precipitationProbability[x.idx] ?? 0,
        hourly.windGusts[x.idx] ?? 0,
        hourly.weatherCode[x.idx] ?? 0,
      ),
      apparentTempF: hourly.apparentTemperature[x.idx] ?? 0,
      precipProbability: hourly.precipitationProbability[x.idx] ?? 0,
      windGustMph: hourly.windGusts[x.idx] ?? 0,
    }));
    // For each 2-wide window, sum the scores and pick the min.
    // The window must START between 5am and 9pm (we don't pick
    // 11pm + 12am as "best").
    let bestSum = Infinity;
    let bestStartIdx = -1;
    for (let i = 0; i <= scored.length - 2; i++) {
      const s0 = scored[i];
      const s1 = scored[i + 1];
      // Always in bounds (i + 1 <= length - 1); guard satisfies
      // noUncheckedIndexedAccess.
      if (!s0 || !s1) continue;
      if (s0.hour < 5 || s0.hour >= 22) continue;
      const sum = s0.score + s1.score;
      if (sum < bestSum) {
        bestSum = sum;
        bestStartIdx = i;
      }
    }
    if (bestStartIdx >= 0) {
      const a = scored[bestStartIdx];
      const b = scored[bestStartIdx + 1];
      // bestStartIdx was set inside the in-bounds loop above, so
      // both exist; the guard satisfies noUncheckedIndexedAccess.
      if (a && b) {
        const startHour = a.hour;
        const endHour = (b.hour + 1) % 24;
        const apparentTempF = Math.round((a.apparentTempF + b.apparentTempF) / 2);
        const precipProbability = Math.max(a.precipProbability, b.precipProbability);
        const windGustMph = Math.max(a.windGustMph, b.windGustMph);
        bestWindow = {
          startHour,
          endHour,
          apparentTempF,
          precipProbability,
          windGustMph,
          label: `${formatHour(startHour)}-${formatHour(endHour)} at ${apparentTempF}°F`,
        };
      }
    }
  }

  // Headline: one-liner that names the dominant condition.
  // Order matters — pick the most restrictive thing first.
  let headline: string;
  let verdict: 'go' | 'caution' | 'skip';
  if (daily.weatherCode >= 95) {
    headline = 'Thunderstorms — train inside today.';
    verdict = 'skip';
  } else if (daily.tempMax > 100) {
    headline = `${Math.round(daily.tempMax)}°F is dangerously hot — skip or move to early AM.`;
    verdict = 'skip';
  } else if (daily.tempMax < 20) {
    headline = `${Math.round(daily.tempMax)}°F — dangerously cold, gear up or skip.`;
    verdict = 'skip';
  } else if (daily.windMax > 30) {
    headline = `Sustained winds ${Math.round(daily.windMax)}mph — rings unsafe.`;
    verdict = 'skip';
  } else if (isSnowCode(daily.weatherCode) && daily.precipSum > 2) {
    headline = 'Heavy snow — train inside or ski instead.';
    verdict = 'skip';
  } else if (daily.precipSum > 5) {
    headline = `${daily.precipSum.toFixed(1)}mm rain — wet grip is sketchy.`;
    verdict = 'skip';
  } else if (daily.tempMax > 92) {
    headline = bestWindow
      ? `Hot — ${bestWindow.label} before the heat.`
      : `Hot — hydrate, take it easy.`;
    verdict = 'caution';
  } else if (daily.tempMax > 85) {
    headline = bestWindow
      ? `Warm — ${bestWindow.label} is the sweet spot.`
      : `Warm — hydrate, watch the heat.`;
    verdict = 'caution';
  } else if (daily.tempMin < 35) {
    headline = bestWindow
      ? `Cold start — ${bestWindow.label} is the warmest window.`
      : `Cold — warm up longer than usual.`;
    verdict = 'caution';
  } else if (daily.windMax > 18) {
    headline = `Breezy (${Math.round(daily.windMax)}mph gusts) — fine for runs, skip rings.`;
    verdict = 'caution';
  } else if (daily.precipProbabilityMax > 40) {
    headline = `${Math.round(daily.precipProbabilityMax)}% rain chance — bring a layer.`;
    verdict = 'caution';
  } else if (bestWindow) {
    headline = `Good day for outside — ${bestWindow.label}.`;
    verdict = 'go';
  } else {
    headline = 'Conditions look fine.';
    verdict = 'go';
  }

  // Per-activity ratings.
  // Rings: very sensitive to wind + precip. Heat OK if under 90°F.
  // Running: heat-sensitive (heat illness risk above 90°F apparent).
  // Walking: most forgiving — only extreme conditions matter.
  const rings = rateRings(daily);
  const running = rateRunning(daily);
  const walking = rateWalking(daily);

  return {
    verdict,
    headline,
    bestWindow,
    peakHeat,
    uvPeak,
    activityAdvice: { rings, running, walking },
  };
}

function rateRings(daily: { weatherCode: number; precipSum: number; windMax: number; tempMax: number }): ActivityRating {
  if (daily.weatherCode >= 95) {
    return { verdict: 'skip', reason: 'Thunderstorms' };
  }
  if (isSnowCode(daily.weatherCode)) {
    return { verdict: 'skip', reason: 'Snow' };
  }
  if (daily.precipSum > 2 || (daily.weatherCode >= 61 && daily.weatherCode <= 67)) {
    return { verdict: 'skip', reason: 'Wet rings' };
  }
  if (daily.windMax > 22) {
    return { verdict: 'skip', reason: `${Math.round(daily.windMax)}mph gusts` };
  }
  if (daily.tempMax > 95) {
    return { verdict: 'caution', reason: 'Hot — grip sweat' };
  }
  if (daily.tempMax > 85) {
    return { verdict: 'caution', reason: 'Warm — chalk up' };
  }
  if (daily.tempMax < 28) {
    return { verdict: 'caution', reason: 'Cold hands' };
  }
  return { verdict: 'ok', reason: 'Conditions OK' };
}

function rateRunning(daily: { weatherCode: number; precipSum: number; tempMax: number }): ActivityRating {
  if (daily.weatherCode >= 95) {
    return { verdict: 'skip', reason: 'Thunderstorms' };
  }
  if (daily.tempMax > 100) {
    return { verdict: 'skip', reason: `${Math.round(daily.tempMax)}°F — heat illness risk` };
  }
  if (daily.tempMax > 90) {
    return { verdict: 'caution', reason: 'Hot — go before 9am' };
  }
  if (daily.tempMax > 85) {
    return { verdict: 'caution', reason: 'Warm — hydrate' };
  }
  if (daily.precipSum > 5) {
    return { verdict: 'caution', reason: 'Heavy rain' };
  }
  return { verdict: 'ok', reason: 'Conditions OK' };
}

function rateWalking(daily: { weatherCode: number; tempMax: number; tempMin: number }): ActivityRating {
  if (daily.weatherCode >= 95) {
    return { verdict: 'skip', reason: 'Thunderstorms' };
  }
  if (daily.tempMax > 105) {
    return { verdict: 'skip', reason: `${Math.round(daily.tempMax)}°F — heat illness risk` };
  }
  if (daily.tempMax > 95) {
    return { verdict: 'caution', reason: 'Hot — bring water' };
  }
  if (daily.tempMin < 15) {
    return { verdict: 'caution', reason: 'Very cold' };
  }
  return { verdict: 'ok', reason: 'Conditions OK' };
}

function formatHour(h: number): string {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

async function callOpenMeteoForecast(lat: number, lng: number): Promise<Forecast | null> {
  const params = new URLSearchParams({
    latitude: lat + '',
    longitude: lng + '',
    current: [
      'temperature_2m',
      'apparent_temperature',
      'relative_humidity_2m',
      'wind_speed_10m',
      'wind_gusts_10m',
      'precipitation',
      'weather_code',
      'is_day',
    ].join(','),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'precipitation_probability_max',
      'wind_speed_10m_max',
    ].join(','),
    // Hourly fields power the per-day "best window" insight.
    // We ask for 3 days so each DailyWeather insight has
    // matching hourly samples to score. UV is on the free tier.
    hourly: [
      'temperature_2m',
      'apparent_temperature',
      'precipitation_probability',
      'precipitation',
      'weather_code',
      'wind_speed_10m',
      'wind_gusts_10m',
      'uv_index',
    ].join(','),
    timezone: 'auto',
    forecast_days: '3',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
  });
  const url = `${FORECAST_ENDPOINT}?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'FitQuest/1.0 (+https://github.com/joshbowyer/fitquest)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const raw: any = await res.json();
    const c = raw.current ?? {};
    const daily: any[] = Array.isArray(raw.daily?.time) ? raw.daily.time : [];
    const dWeatherCode: number[] = raw.daily?.weather_code ?? [];
    const dTempMax: number[] = raw.daily?.temperature_2m_max ?? [];
    const dTempMin: number[] = raw.daily?.temperature_2m_min ?? [];
    const dPrecipSum: number[] = raw.daily?.precipitation_sum ?? [];
    const dPrecipProb: number[] = raw.daily?.precipitation_probability_max ?? [];
    const dWindMax: number[] = raw.daily?.wind_speed_10m_max ?? [];
    // Hourly arrays (same length — 72 samples for 3 days at hourly
    // resolution). Indexed by absolute position; daily[i] covers
    // hourly indices [i*24, (i+1)*24).
    const hourly: HourlyWeather = {
      time: Array.isArray(raw.hourly?.time) ? raw.hourly.time : [],
      temperature: raw.hourly?.temperature_2m ?? [],
      apparentTemperature: raw.hourly?.apparent_temperature ?? [],
      precipitationProbability: raw.hourly?.precipitation_probability ?? [],
      precipitation: raw.hourly?.precipitation ?? [],
      weatherCode: raw.hourly?.weather_code ?? [],
      windSpeed: raw.hourly?.wind_speed_10m ?? [],
      windGusts: raw.hourly?.wind_gusts_10m ?? [],
      uvIndex: raw.hourly?.uv_index ?? [],
    };
    if (
      typeof c.temperature_2m !== 'number' ||
      daily.length === 0
    ) {
      return null;
    }
    const days = daily.slice(0, 3).map((d: string, i: number) => {
      const base = {
        date: d,
        weatherCode: dWeatherCode[i] ?? 0,
        tempMax: dTempMax[i] ?? 0,
        tempMin: dTempMin[i] ?? 0,
        precipSum: dPrecipSum[i] ?? 0,
        precipProbabilityMax: dPrecipProb[i] ?? 0,
        windMax: dWindMax[i] ?? 0,
      };
      const insight = summarizeDay(d, hourly, base);
      return { ...base, insight };
    });
    return {
      latitude: raw.latitude ?? lat,
      longitude: raw.longitude ?? lng,
      timezone: raw.timezone ?? 'UTC',
      units: { temperature: 'fahrenheit', windSpeed: 'mph' },
      current: {
        temperature: c.temperature_2m,
        apparentTemperature: c.apparent_temperature ?? c.temperature_2m,
        humidity: c.relative_humidity_2m ?? 0,
        windSpeed: c.wind_speed_10m ?? 0,
        windGusts: c.wind_gusts_10m ?? c.wind_speed_10m ?? 0,
        precipitation: c.precipitation ?? 0,
        weatherCode: c.weather_code ?? 0,
        isDay: !!c.is_day,
        time: c.time ?? new Date().toISOString(),
      },
      daily: days,
      fetchedAt: new Date().toISOString(),
      cached: false,
    };
  } catch {
    return null;
  }
}

async function callOpenMeteoAirQuality(lat: number, lng: number): Promise<AirQuality | null> {
  // Open-Meteo's air-quality endpoint only exposes hourly data
  // (no daily aggregates) — the `daily=..._max` variables I'd
  // ideally request don't exist. So we ask for 3 days of hourly
  // and aggregate daily peaks server-side. The "daily peak" is
  // what matters for outdoor-training decisions anyway: US AQI
  // is computed worst-case across pollutants, so the day's worst
  // hour is the day's headline number.
  //
  // PM2.5, PM10, and US AQI (a composite derived from all
  // pollutants). The `current` block returns the same-nowcast
  // values for the hero number on the card. No API key.
  const params = new URLSearchParams({
    latitude: lat + '',
    longitude: lng + '',
    current: 'us_aqi,pm2_5,pm10',
    hourly: 'us_aqi,pm2_5,pm10',
    timezone: 'auto',
    forecast_days: '3',
  });
  const url = `${AIR_QUALITY_ENDPOINT}?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'FitQuest/1.0 (+https://github.com/joshbowyer/fitquest)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(`[forecast] air-quality upstream ${res.status} for ${lat},${lng}`);
      return null;
    }
    const raw: any = await res.json();
    const c = raw.current ?? {};
    const hourlyTimes: string[] = Array.isArray(raw.hourly?.time) ? raw.hourly.time : [];
    const hourlyAqi: Array<number | null> = raw.hourly?.us_aqi ?? [];
    const hourlyPm25: Array<number | null> = raw.hourly?.pm2_5 ?? [];
    const hourlyPm10: Array<number | null> = raw.hourly?.pm10 ?? [];

    // Aggregate daily peaks. A day boundary in Open-Meteo's
    // timezone=auto response is at the local 00:00, which is
    // already a YYYY-MM-DD prefix. We bucket each hourly sample
    // into its date's max.
    type DailyAcc = { pm25Max: number | null; pm10Max: number | null; usAqiMax: number | null };
    const dayMap = new Map<string, DailyAcc>();
    // `n` also accepts undefined: indexing the hourly arrays under
    // noUncheckedIndexedAccess yields `number | null | undefined`,
    // and the `== null` check already covers undefined.
    const takeMax = (cur: number | null, n: number | null | undefined): number | null => {
      if (n == null || !Number.isFinite(n)) return cur;
      if (cur == null) return n;
      return Math.max(cur, n);
    };
    for (let i = 0; i < hourlyTimes.length; i++) {
      const d = String(hourlyTimes[i]).slice(0, 10); // YYYY-MM-DD
      const acc = dayMap.get(d) ?? { pm25Max: null, pm10Max: null, usAqiMax: null };
      acc.pm25Max = takeMax(acc.pm25Max, hourlyPm25[i]);
      acc.pm10Max = takeMax(acc.pm10Max, hourlyPm10[i]);
      acc.usAqiMax = takeMax(acc.usAqiMax, hourlyAqi[i]);
      dayMap.set(d, acc);
    }
    // Open-Meteo returns hourly in chronological order; take
    // the first 3 distinct days for our 3-day forecast.
    const daily = Array.from(dayMap.entries()).slice(0, 3).map(([date, acc]) => ({
      date,
      pm25Max: acc.pm25Max,
      pm10Max: acc.pm10Max,
      usAqiMax: acc.usAqiMax,
      band: usAqiBand(acc.usAqiMax),
    }));

    return {
      latitude: raw.latitude ?? lat,
      longitude: raw.longitude ?? lng,
      timezone: raw.timezone ?? 'UTC',
      current: {
        usAqi: typeof c.us_aqi === 'number' ? c.us_aqi : null,
        pm25: typeof c.pm2_5 === 'number' ? c.pm2_5 : null,
        pm10: typeof c.pm10 === 'number' ? c.pm10 : null,
        band: usAqiBand(typeof c.us_aqi === 'number' ? c.us_aqi : null),
        time: c.time ?? new Date().toISOString(),
      },
      daily,
      fetchedAt: new Date().toISOString(),
      cached: false,
    };
  } catch {
    return null;
  }
}

export type CombinedWeatherPayload = {
  forecast: Forecast;
  airQuality: AirQuality | null; // null = upstream unavailable
  fetchedAt: string;              // wall-clock when this combined payload was assembled
};

/**
 * Look up the forecast + air-quality bundle for a (lat, lng).
 * Cache hits skip the upstream entirely. Returns null if both
 * the cache lookup AND the upstream call fail — the caller
 * should render an "unavailable" state.
 *
 * The cache key uses 3-decimal rounding (≈110m grid) which is
 * fine-grained enough that two users a few blocks apart get the
 * same data and benefit from the cache. Forecast + AQ share the
 * same key because they serve the same coordinate and we always
 * want both at once.
 */
export async function getWeatherBundle(lat: number, lng: number): Promise<CombinedWeatherPayload | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const key = keyOf(lat, lng);

  // Cache hit (and fresh)?
  const cached = await prisma.weatherCache.findUnique({ where: { key } });
  if (cached) {
    const ageMs = Date.now() - cached.fetchedAt.getTime();
    if (ageMs < CACHE_TTL_MS) {
      const payload = cached.payload as any;
      // Defensive: older cache rows may lack airQuality — fall
      // through and re-fetch if so. (Future-proofing only; the
      // schema migration was deployed in the same commit.)
      if (payload?.forecast && payload?.airQuality !== undefined) {
        return {
          forecast: { ...payload.forecast, cached: true },
          airQuality: payload.airQuality
            ? { ...payload.airQuality, cached: true }
            : null,
          fetchedAt: payload.fetchedAt ?? cached.fetchedAt.toISOString(),
        };
      }
    }
  }

  // Cache miss or stale — hit upstream in parallel.
  const [freshForecast, freshAQ] = await Promise.all([
    callOpenMeteoForecast(lat, lng),
    callOpenMeteoAirQuality(lat, lng),
  ]);
  // The forecast is the headline — if it failed AND we have no
  // stale cache, give up entirely. The AQ being unavailable
  // (null) is fine; the UI just won't show the AQ card.
  if (!freshForecast) {
    if (cached) {
      const payload = cached.payload as any;
      return {
        forecast: { ...payload.forecast, cached: true },
        airQuality: payload?.airQuality
          ? { ...payload.airQuality, cached: true }
          : null,
        fetchedAt: payload?.fetchedAt ?? cached.fetchedAt.toISOString(),
      };
    }
    return null;
  }

  const combined: CombinedWeatherPayload = {
    forecast: freshForecast,
    airQuality: freshAQ,
    fetchedAt: new Date().toISOString(),
  };
  await prisma.weatherCache.upsert({
    where: { key },
    create: { key, lat, lng, payload: combined as any },
    update: { payload: combined as any, fetchedAt: new Date() },
  });
  return combined;
}