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
    const takeMax = (cur: number | null, n: number | null): number | null => {
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