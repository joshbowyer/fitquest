/**
 * Per-metric AI insight routes.
 *
 *   GET  /insights/metric/:metric       — returns the cached row, or
 *                                         404 if none yet. The deep-dive
 *                                         page only calls GET.
 *   POST /insights/metric/:metric       — generate (or return cache
 *                                         within TTL). ?force=1 to
 *                                         invalidate.
 *   GET  /insights/metric/:metric/baselines
 *                                       — windowed averages only,
 *                                         no LLM call. Used to hydrate
 *                                         the deep-dive cards before
 *                                         the user clicks "Generate".
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MetricType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import {
  generateMetricInsight,
  gatherMetricInsightData,
  CURRENT_PROMPT_VERSION,
} from '../lib/metricInsight.js';

export async function metricInsightRoutes(app: FastifyInstance) {
  app.get('/insights/metric/:metric/baselines', async (req, reply) => {
    const me = await requireUser(req);
    const metric = (req.params as any).metric as string;
    // Validate against the Prisma enum; otherwise bad input would
    // pass and cause a ZodError deep inside gatherMetricInsightData.
    if (!Object.values(MetricType).includes(metric as MetricType)) {
      return reply.code(400).send({ error: 'Unknown metric' });
    }
    const data = await gatherMetricInsightData({ userId: me.id, metric });
    return { data, promptVersion: CURRENT_PROMPT_VERSION };
  });

  app.get('/insights/metric/:metric', async (req, reply) => {
    const me = await requireUser(req);
    const metric = (req.params as any).metric as string;
    if (!Object.values(MetricType).includes(metric as MetricType)) {
      return reply.code(400).send({ error: 'Unknown metric' });
    }
    const row = await prisma.metricInsight.findUnique({
      where: { userId_metric: { userId: me.id, metric: metric as any } },
    });
    if (!row) return reply.code(404).send({ error: 'No insight yet' });
    return {
      insight: {
        ...row,
        factors: safeFactors(row.factors),
      },
      promptVersion: CURRENT_PROMPT_VERSION,
    };
  });

  app.post('/insights/metric/:metric', async (req, reply) => {
    const me = await requireUser(req);
    const metric = (req.params as any).metric as string;
    if (!Object.values(MetricType).includes(metric as MetricType)) {
      return reply.code(400).send({ error: 'Unknown metric' });
    }
    const q = z.object({ force: z.coerce.boolean().optional() }).parse(req.query ?? {});
    try {
      const { summary, factors, cached, generatedAt } = await generateMetricInsight({
        userId: me.id,
        metric,
        force: !!q.force,
      });
      return {
        insight: { metric, summary, factors, generatedAt },
        cached,
        promptVersion: CURRENT_PROMPT_VERSION,
      };
    } catch (err) {
      req.log.error({ err }, 'metric insight generation failed');
      const msg = err instanceof Error ? err.message : 'Generation failed';
      return reply.code(500).send({ error: msg });
    }
  });
}

function safeFactors(s: string | null): Array<{ label: string; signal: string; weight: number; note: string }> {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}