import { prisma } from './prisma.js';

/**
 * Reverse-geocode a lat/lng pair to a short place name using
 * Nominatim (OpenStreetMap). Results are cached in the
 * GeoCache table keyed by a rounded ~110m grid so a bulk FIT
 * import (often 20+ files from the same metro area) only hits
 * the upstream endpoint once or twice.
 *
 * Usage policy for nominatim.openstreetmap.org:
 *   - max 1 request / second
 *   - must include a descriptive User-Agent
 *   - no heavy use (cache aggressively)
 *
 * We honor all three: in-memory rate limiter + DB cache +
 * FitQuest/1.0 User-Agent. If Nominatim is unreachable we
 * return null and let the caller fall back to a sport-only
 * title; we never throw.
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const ZOOM = 10; // city/town level
const RATE_LIMIT_MS = 1100; // 1 req/sec + 100ms grace

/// In-process rate limiter. The GeoCache hits the DB on every
/// lookup; the Nominatim call only happens on a cache miss.
/// Single-flight: while one request is in flight we queue
/// others and resolve them from the same response so a 26-file
/// bulk import can't fan out 26 concurrent calls.
let inflight: Promise<{ shortName: string; displayName: string } | null> | null = null;
let lastCallAt = 0;

function round3(n: number): string {
  // 3 decimal places ≈ 110m at the equator. Nominatim returns
  // the same place for any grid point inside it, so a coarser
  // bucket would hurt accuracy for narrow features (trails
  // along a ridge, etc.). 3 decimals is the sweet spot.
  return Math.round(n * 1000) / 1000 + '';
}

function keyOf(lat: number, lng: number): string {
  return `${round3(lat)}_${round3(lng)}`;
}

/// Pick the most useful short name from a Nominatim response.
/// Prefers city/town/village, falls back to county, then state.
/// We never use `display_name` for the activity title because
/// it's too verbose ("Kennesaw, Cobb County, Georgia, US").
function pickShort(addr: any): string | null {
  if (!addr) return null;
  return (
    addr.city ??
    addr.town ??
    addr.village ??
    addr.hamlet ??
    addr.suburb ??
    addr.municipality ??
    addr.county ??
    addr.state ??
    addr.region ??
    null
  );
}

async function callNominatim(lat: number, lng: number): Promise<{ shortName: string; displayName: string } | null> {
  // Coalesce concurrent callers onto a single inflight request.
  if (inflight) return inflight;
  // Respect the 1 req/sec policy.
  const now = Date.now();
  const wait = Math.max(0, lastCallAt + RATE_LIMIT_MS - now);
  inflight = (async () => {
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      const url = `${ENDPOINT}?lat=${lat}&lon=${lng}&format=json&zoom=${ZOOM}&addressdetails=1`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'FitQuest/1.0 (+https://github.com/joshbowyer/fitquest)',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      lastCallAt = Date.now();
      if (!res.ok) return null;
      const data = await res.json();
      const short = pickShort(data.address);
      if (!short) return null;
      return { shortName: short, displayName: data.display_name ?? short };
    } catch {
      lastCallAt = Date.now();
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Look up the place name for a (lat, lng). Always returns a
 * string — falls back to null on miss/error so the caller can
 * decide how to label the activity. Never throws.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const key = keyOf(lat, lng);
  // Cache hit: fast path.
  const cached = await prisma.geoCache.findUnique({ where: { key } });
  if (cached) return cached.shortName;
  // Cache miss: hit Nominatim with rate-limit + coalescing.
  const result = await callNominatim(lat, lng);
  if (!result) return null;
  await prisma.geoCache.upsert({
    where: { key },
    create: { key, lat, lng, shortName: result.shortName, displayName: result.displayName, zoom: ZOOM },
    update: { shortName: result.shortName, displayName: result.displayName, fetchedAt: new Date() },
  });
  return result.shortName;
}

/**
 * Find the centroid of a workout's track (trackpoints with
 * lat/lng). Returns null if no usable points — caller falls
 * back to a sport-only title.
 *
 * Note: FIT trackpoints are stored with the field name `lon`
 * (the JSON came from `@garmin/fitsdk` which uses GeoJSON
 * conventions). Some internal callsites use `lng`; we accept
 * both so the lib doesn't break if the field name drifts.
 */
export function centroidOfTrack(trackpoints: Array<{ lat?: number | null; lng?: number | null; lon?: number | null } | null | undefined>): { lat: number; lng: number } | null {
  let latSum = 0;
  let lngSum = 0;
  let n = 0;
  for (const tp of trackpoints ?? []) {
    if (!tp) continue;
    const lat = tp.lat;
    const lng = (tp as any).lng ?? (tp as any).lon;
    if (typeof lat === 'number' && typeof lng === 'number' &&
        Number.isFinite(lat) && Number.isFinite(lng)) {
      latSum += lat;
      lngSum += lng;
      n += 1;
    }
  }
  if (n === 0) return null;
  return { lat: latSum / n, lng: lngSum / n };
}

/**
 * Capitalize a sport/type for the fallback title:
 *   "running" → "Running"
 *   "yoga" → "Yoga"
 * Leaves already-capitalized strings alone.
 */
export function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Build an activity title from sport + optional location.
 * Returns "<City> <Sport>" when we have a place name, just
 * "<Sport>" otherwise.
 */
export async function activityTitle(
  sport: string,
  trackpoints: Array<{ lat?: number | null; lng?: number | null; lon?: number | null } | null | undefined> | null | undefined
): Promise<string> {
  const centroid = centroidOfTrack(trackpoints ?? []);
  if (!centroid) return titleCase(sport);
  const place = await reverseGeocode(centroid.lat, centroid.lng);
  if (!place) return titleCase(sport);
  return `${place} ${titleCase(sport)}`;
}