/**
 * Check-in routes. Surfaces what measurements are due based on the
 * user's cadence preferences and last-logged history.
 *
 *   GET /check-ins/due   → { items: DueMetric[] }
 *     Returns all metrics currently due across all cadences.
 *     Dashboard uses this for the check-in cards.
 *
 *   GET /check-ins/all   → { items: CadenceInfo[] }
 *     Returns the full schedule (all metrics + their cadences,
 *     overdue or not) for the /check-ins page.
 *
 * The "due" logic lives in `lib/checkIns.ts` so it can be unit-tested
 * with a mocked clock + a map of last-logged timestamps.
 */
import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import {
  computeDueMetrics,
  groupByCadence,
  CADENCES,
  CADENCE_LABEL,
  CADENCE_GLYPH,
  DEFAULT_CADENCE,
  isCheckInMetric,
  type Cadence,
} from '../lib/checkIns.js';
import type { MetricType } from '@prisma/client';

type DueMetricDto = {
  metric: MetricType;
  cadence: Cadence;
  lastLoggedAt: string | null;
  overdueByDays: number;
  inWindow: boolean;
  isNeverLogged: boolean;
};

type CadenceInfoDto = {
  cadence: Cadence;
  label: string;
  glyph: string;
  dueCount: number;
  totalCount: number;
  metrics: Array<{
    metric: MetricType;
    lastLoggedAt: string | null;
    overdueByDays: number;
    inWindow: boolean;
  }>;
};

export async function checkInRoutes(app: FastifyInstance) {
  /// Look up the most-recent measurement per metric for this user.
  /// DISTINCT ON (metric) keeps it to one row per metric, ordered
  /// by recordedAt DESC. Bound by the index on
  /// (userId, metric, recordedAt) so it stays fast as the table grows.
  async function fetchLastLoggedByMetric(userId: string): Promise<Map<MetricType, Date>> {
    const rows = await prisma.$queryRaw<Array<{ metric: MetricType; recordedAt: Date }>>`
      SELECT DISTINCT ON (m.metric) m.metric, m."recordedAt"
      FROM "Measurement" m
      WHERE m."userId" = ${userId}
      ORDER BY m.metric, m."recordedAt" DESC
    `;
    const map = new Map<MetricType, Date>();
    for (const r of rows) map.set(r.metric, r.recordedAt);
    return map;
  }

  function toDto(d: {
    metric: MetricType;
    cadence: Cadence;
    lastLoggedAt: Date | null;
    overdueByDays: number;
    inWindow: boolean;
  }): DueMetricDto {
    return {
      metric: d.metric,
      cadence: d.cadence,
      lastLoggedAt: d.lastLoggedAt ? d.lastLoggedAt.toISOString() : null,
      overdueByDays: d.overdueByDays === 9999 ? -1 : d.overdueByDays,
      inWindow: d.inWindow,
      isNeverLogged: d.lastLoggedAt === null,
    };
  }

  app.get('/check-ins/due', async (req, reply) => {
    const user = await requireUser(req);
    const last = await fetchLastLoggedByMetric(user.id);
    const due = computeDueMetrics({
      lastLoggedByMetric: last,
      now: new Date(),
      timezone: user.timezone ?? null,
    });
    const grouped = groupByCadence(due);
    return {
      items: due.map(toDto),
      byCadence: {
        AM:     grouped.AM.map(toDto),
        PM:     grouped.PM.map(toDto),
        WEEKLY: grouped.WEEKLY.map(toDto),
      },
    };
  });

  app.get('/check-ins/all', async (req, reply) => {
    const user = await requireUser(req);
    const last = await fetchLastLoggedByMetric(user.id);
    const due = computeDueMetrics({
      lastLoggedByMetric: last,
      now: new Date(),
      timezone: user.timezone ?? null,
    });
    const dueByKey = new Map<string, ReturnType<typeof toDto>>();
    for (const d of due) dueByKey.set(d.metric, toDto(d));

    const result: CadenceInfoDto[] = CADENCES.map((cadence) => {
      const metrics = (Object.entries(DEFAULT_CADENCE) as [MetricType, Cadence][])
        .filter(([, c]) => c === cadence)
        .filter(([m]) => isCheckInMetric(m))
        .map(([m]) => {
          const d = dueByKey.get(m);
          return {
            metric: m,
            lastLoggedAt: last.get(m)?.toISOString() ?? null,
            overdueByDays: d?.overdueByDays ?? 0,
            inWindow: d?.inWindow ?? (cadence === 'WEEKLY'),
          };
        });
      return {
        cadence,
        label: CADENCE_LABEL[cadence],
        glyph: CADENCE_GLYPH[cadence],
        dueCount: metrics.filter((m) => dueByKey.has(m.metric)).length,
        totalCount: metrics.length,
        metrics,
      };
    });
    return { items: result };
  });
}