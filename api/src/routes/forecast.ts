import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { getForecast, weatherCodeMeta, isOutdoorFriendly } from '../lib/forecast.js';
import { computeRecovery } from '../lib/recovery.js';
import { recommendMuscle, partRecovery } from '../lib/recommendMuscle.js';
import { centroidOfTrack } from '../lib/geo.js';

/**
 * GET /forecast — bundles the three things the user needs to
 * decide whether to go outside today:
 *
 *   1. Weather — current conditions + 3-day forecast for the
 *      user's home location (or their most-recent workout's
 *      track centroid if they haven't set one yet).
 *
 *   2. Readiness — the same composite score the /recovery page
 *      shows (HRV + sleep + RHR + soreness + stress + energy +
 *      mood). Drives the "should I push or take it easy" call.
 *
 *   3. Recommendation — the body part best suited for today
 *      (highest recovery score, hasn't been worked in 12+ h).
 *
 * Location resolution priority:
 *   a) User.latitude / User.longitude (explicit, set on Profile)
 *   b) Most-recent workout's trackJson centroid (auto-detected)
 *   c) 422 with a `needsLocation: true` flag → frontend shows
 *      the "Set your home location in Profile" empty state
 *
 * Outdoor-friendliness verdict per day is computed server-side so
 * the client doesn't need the WMO code mapping.
 */

export async function forecastRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const me = await requireUser(req);

    // 1. Resolve location.
    let lat = me.latitude;
    let lng = me.longitude;
    let source: 'user' | 'workout' | null = null;
    if (lat != null && lng != null) {
      source = 'user';
    } else {
      const recent = await prisma.workout.findFirst({
        where: { userId: me.id, trackJson: { not: '[]' } },
        orderBy: { performedAt: 'desc' },
        select: { trackJson: true },
      });
      const centroid = centroidOfTrack(Array.isArray(recent?.trackJson) ? (recent?.trackJson as any) : []);
      if (centroid) {
        lat = centroid.lat;
        lng = centroid.lng;
        source = 'workout';
      }
    }

    // 2. Compute readiness + recommendation in parallel with the
    // weather fetch. They're independent.
    const [recovery, recommendation, recoveryByPart] = await Promise.all([
      computeRecovery(me.id),
      recommendMuscle(me.id),
      partRecovery(me.id),
    ]);

    if (lat == null || lng == null) {
      return reply.code(422).send({
        needsLocation: true,
        message: 'Set your home location on Profile or log an outdoor workout to enable the forecast.',
        readiness: {
          score: recovery.score,
          trend: recovery.trend,
          components: recovery.components,
          dataPoints: recovery.dataPoints,
          totalMetrics: recovery.totalMetrics,
          date: recovery.date,
        },
        recommendation: recommendation ?? null,
        recoveryByPart,
      });
    }

    const weather = await getForecast(lat, lng);

    // 3. Compose outdoor-friendly verdict per day so the client
    // doesn't have to re-derive from raw WMO codes.
    const daily = (weather?.daily ?? []).map((d) => {
      const verdict = isOutdoorFriendly(d);
      const meta = weatherCodeMeta(d.weatherCode);
      return { ...d, ...verdict, label: meta.label, icon: meta.icon };
    });

    return {
      location: {
        latitude: lat,
        longitude: lng,
        source,
      },
      weather: weather
        ? {
            ...weather,
            current: { ...weather.current, ...weatherCodeMeta(weather.current.weatherCode) },
            daily,
          }
        : null,
      weatherStatus: weather ? (weather.cached ? 'cached' : 'fresh') : 'unavailable',
      readiness: {
        score: recovery.score,
        trend: recovery.trend,
        components: recovery.components,
        dataPoints: recovery.dataPoints,
        totalMetrics: recovery.totalMetrics,
        date: recovery.date,
      },
      recommendation: recommendation ?? null,
      recoveryByPart,
    };
  });
}