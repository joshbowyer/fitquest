/**
 * Per-activity AI insight routes.
 *
 *   GET  /workouts/:id/insight       — returns the cached row, or 404
 *                                       if none has been generated yet.
 *   POST /workouts/:id/insight       — generate (or return cache if
 *                                       promptVersion matches).
 *                                       ?force=1 to invalidate cache.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import {
  generateActivityInsight,
  CURRENT_PROMPT_VERSION,
} from '../lib/activityInsight.js';

export async function activityInsightRoutes(app: FastifyInstance) {
  app.get('/workouts/:id/insight', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const workout = await prisma.workout.findFirst({
      where: { id, userId: me.id },
      select: { id: true },
    });
    if (!workout) return reply.code(404).send({ error: 'Workout not found' });
    const row = await prisma.activityInsight.findUnique({ where: { workoutId: id } });
    if (!row) return reply.code(404).send({ error: 'No insight yet' });
    // Parse the factors JSON column into a typed array so the
    // frontend can render structured chips without an extra step.
    let factors: any[] = [];
    try {
      const parsed = JSON.parse(row.factors);
      if (Array.isArray(parsed)) factors = parsed;
    } catch { /* corrupt row — leave empty */ }
    return {
      insight: { ...row, factors },
      promptVersion: CURRENT_PROMPT_VERSION,
    };
  });

  app.post('/workouts/:id/insight', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const q = z.object({ force: z.coerce.boolean().optional() }).parse(req.query ?? {});

    const workout = await prisma.workout.findFirst({
      where: { id, userId: me.id },
      select: { id: true },
    });
    if (!workout) return reply.code(404).send({ error: 'Workout not found' });

    try {
      const { insight, cached } = await generateActivityInsight({
        userId: me.id,
        workoutId: id,
        force: !!q.force,
      });
      return { insight, cached, promptVersion: CURRENT_PROMPT_VERSION };
    } catch (err) {
      req.log.error({ err }, 'activity insight generation failed');
      const msg = err instanceof Error ? err.message : 'Generation failed';
      return reply.code(500).send({ error: msg });
    }
  });
}