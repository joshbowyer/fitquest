import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/auth.js';
import { getOrGenerateToday, type MorningReportResult } from '../lib/morningReport.js';

export async function morningReportRoutes(app: FastifyInstance) {
  /**
   * GET /morning-report
   * Returns today's morning report (cached or freshly generated).
   * Returns 204 if no data has been logged yet (so the dashboard
   * can distinguish "no report" from "empty report").
   */
  app.get('/', async (req, reply) => {
    const me = await requireUser(req);
    const result = await getOrGenerateToday(me.id);
    if (!result) {
      return reply.code(204).send();
    }
    return result;
  });

  /**
   * POST /morning-report/regenerate
   * Force-regenerate today's report. Bypasses the 7-day cache. Used
   * by the "Regenerate" button on the dashboard card.
   */
  app.post('/regenerate', async (req, reply) => {
    const me = await requireUser(req);
    const result: MorningReportResult | null = await getOrGenerateToday(me.id, { force: true });
    if (!result) return reply.code(204).send();
    return result;
  });
}
