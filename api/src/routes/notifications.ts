/**
 * Notification inbox. Reads the Notification rows written by the
 * various event paths (level-up, skill unlock, penance, shop) and
 * exposes list / unread-count / mark-read / mark-all-read / dismiss.
 *
 * There is no create endpoint — notifications are a side effect of
 * server-side events, emitted via lib/notify.ts::emitNotification.
 *
 * Sort order: newest first (createdAt desc). The unread-count query
 * is a cheap COUNT(*) WHERE readAt IS NULL, backed by the
 * (userId, readAt) index, so the top-bar badge can poll it often.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, NotificationCategory } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';

const listQuerySchema = z.object({
  // Optional category filter for the inbox tabs.
  category: z.nativeEnum(NotificationCategory).optional(),
  // Only unread rows (for the badge dropdown preview).
  unread: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function notificationRoutes(app: FastifyInstance) {
  // GET /notifications — newest-first list, optional category/unread filter.
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const q = listQuerySchema.parse(req.query ?? {});
    const where: any = { userId: me.id };
    if (q.category) where.category = q.category;
    if (q.unread) where.readAt = null;
    const items = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return { items };
  });

  // GET /notifications/unread-count — badge count.
  app.get('/unread-count', async (req) => {
    const me = await requireUser(req);
    const count = await prisma.notification.count({
      where: { userId: me.id, readAt: null },
    });
    return { count };
  });

  // POST /notifications/:id/read — mark a single notification read.
  app.post('/:id/read', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing || existing.userId !== me.id) {
      return reply.code(404).send({ error: 'Notification not found' });
    }
    // Idempotent: only stamp readAt on the first read.
    const updated =
      existing.readAt == null
        ? await prisma.notification.update({
            where: { id },
            data: { readAt: new Date() },
          })
        : existing;
    return { item: updated };
  });

  // POST /notifications/read-all — mark every unread notification read.
  app.post('/read-all', async (req) => {
    const me = await requireUser(req);
    const res = await prisma.notification.updateMany({
      where: { userId: me.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  });

  // DELETE /notifications/:id — dismiss (hard delete) a notification.
  app.delete('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing || existing.userId !== me.id) {
      return reply.code(404).send({ error: 'Notification not found' });
    }
    await prisma.notification.delete({ where: { id } });
    return { ok: true };
  });

  // DELETE /notifications — clear all of the user's notifications.
  app.delete('/', async (req) => {
    const me = await requireUser(req);
    const res = await prisma.notification.deleteMany({
      where: { userId: me.id },
    });
    return { deleted: res.count };
  });
}
