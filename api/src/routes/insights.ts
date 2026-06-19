import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/auth.js';
import { computeRecovery } from '../lib/recovery.js';
import { computeCorrelations } from '../lib/correlations.js';
import { generateInsights, getInsightsSummary } from '../lib/insights.js';

export async function insightRoutes(app: FastifyInstance) {
  app.get('/summary', async (req) => {
    const me = await requireUser(req);
    return getInsightsSummary(me.id);
  });

  app.get('/recovery', async (req) => {
    const me = await requireUser(req);
    return computeRecovery(me.id);
  });

  app.get('/correlations', async (req) => {
    const me = await requireUser(req);
    return { items: await computeCorrelations(me.id) };
  });

  app.get('/tips', async (req) => {
    const me = await requireUser(req);
    return { items: await generateInsights(me.id) };
  });
}
