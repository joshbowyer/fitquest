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
 * On any fetch error (network, non-2xx, malformed JSON) we return
 * null so the caller can fall back to a "weather unavailable" UI
 * state instead of crashing the page.
 *
 * Endpoint:
 *   https://api.open-meteo.com/v1/forecast
 *     ?latitude=...&longitude=...
 *     &current=temperature_2m,apparent_temperature,relative_humidity_2m,
 *              wind_speed_10m,wind_gusts_10m,precipitation,weather_code,is_day
 *     &daily=weather_code,temperature_2m_max,temperature_2m_min,
 *            precipitation_sum,precipitation_probability_max,wind_speed_10m_max
 *     &timezone=auto
 *     &forecast_days=3
 *     &temperature_unit=fahrenheit
 *     &wind_speed_unit=mph
 */

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
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

function round3(n: number): string {
  return Math.round(n * 1000) / 1000 + '';
}

function keyOf(lat: number, lng: number): string {
  return `${round3(lat)}_${round3(lng)}`;
}

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
 */
export function isOutdoorFriendly(daily: DailyWeather): { ok: boolean; reason: string } {
  if (daily.weatherCode >= 95) {
    return { ok: false, reason: 'Thunderstorms — train inside.' };
  }
  if (daily.weatherCode >= 71 && daily.weatherCode <= 86) {
    return { ok: false, reason: 'Snow — rings may be slick.' };
  }
  if (daily.weatherCode >= 61 && daily.weatherCode <= 67 && daily.precipSum > 5) {
    return { ok: false, reason: 'Heavy rain — grip work outdoors is risky.' };
  }
  if (daily.tempMax > 100) {
    return { ok: false, reason: `${daily.tempMax.toFixed(0)}°F is dangerously hot.` };
  }
  if (daily.tempMax < 20) {
    return { ok: false, reason: `${daily.tempMax.toFixed(0)}°F — cold-weather gear required.` };
  }
  if (daily.windMax > 30) {
    return { ok: false, reason: `Sustained winds ${daily.windMax.toFixed(0)}mph — rings unsafe.` };
  }
  if (daily.tempMax > 90) {
    return { ok: true, reason: `Hot (${daily.tempMax.toFixed(0)}°F) — hydrate, short sets.` };
  }
  if (daily.tempMax < 32) {
    return { ok: true, reason: `Cold (${daily.tempMax.toFixed(0)}°F) — warm up longer.` };
  }
  return { ok: true, reason: 'Conditions look fine.' };
}

async function callOpenMeteo(lat: number, lng: number): Promise<Forecast | null> {
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
    timezone: 'auto',
    forecast_days: '3',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
  });
  const url = `${ENDPOINT}?${params.toString()}`;
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
    if (
      typeof c.temperature_2m !== 'number' ||
      daily.length === 0
    ) {
      return null;
    }
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
      daily: daily.slice(0, 3).map((d: string, i: number) => ({
        date: d,
        weatherCode: dWeatherCode[i] ?? 0,
        tempMax: dTempMax[i] ?? 0,
        tempMin: dTempMin[i] ?? 0,
        precipSum: dPrecipSum[i] ?? 0,
        precipProbabilityMax: dPrecipProb[i] ?? 0,
        windMax: dWindMax[i] ?? 0,
      })),
      fetchedAt: new Date().toISOString(),
      cached: false,
    };
  } catch {
    return null;
  }
}

/**
 * Look up the forecast for a (lat, lng). Cache hits skip the
 * upstream entirely. Returns null if both the cache lookup and
 * the upstream call fail — the caller should render an
 * "unavailable" state.
 *
 * The cache key uses 3-decimal rounding (≈110m grid) which is
 * fine-grained enough that two users a few blocks apart get the
 * same forecast and benefit from the cache.
 */
export async function getForecast(lat: number, lng: number): Promise<Forecast | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const key = keyOf(lat, lng);
  // Cache hit (and fresh)?
  const cached = await prisma.weatherCache.findUnique({ where: { key } });
  if (cached) {
    const ageMs = Date.now() - cached.fetchedAt.getTime();
    if (ageMs < CACHE_TTL_MS) {
      return { ...(cached.payload as any), cached: true };
    }
  }
  // Cache miss or stale — hit upstream.
  const fresh = await callOpenMeteo(lat, lng);
  if (!fresh) {
    // If we have a stale cache, serve it rather than nothing.
    // Stale beats no data for a personal app.
    if (cached) return { ...(cached.payload as any), cached: true };
    return null;
  }
  await prisma.weatherCache.upsert({
    where: { key },
    create: { key, lat, lng, payload: fresh as any },
    update: { payload: fresh as any, fetchedAt: new Date() },
  });
  return fresh;
}