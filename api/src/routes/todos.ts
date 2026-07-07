/**
 * One-shot TODO list. Distinct from Habit (recurring tick-able)
 * and Daily (scheduled check-in). The route handles the four
 * basic CRUD operations plus a "complete" transition that
 * awards XP.
 *
 * XP reward: awarded via the centralized awardXpGold() so the
 * Hardcore heart multiplier applies (matches the rest of the
 * app's reward surface). The reward is granted on transition
 * OPEN → DONE only; re-saving an already-DONE todo does NOT
 * re-award (caller sends { status: 'DONE' } with no change →
 * server treats it as a no-op).
 *
 * Sort order for the list endpoint: dueDate asc nulls last, then
 * priority desc, then createdAt desc. The client can override by
 * passing ?sort=... but for v1 we always sort this way so the
 * "most relevant to do now" surfaces first.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, TodoPriority, TodoStatus } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { awardXpGold } from '../lib/award.js';

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueDate: z.string().datetime().optional(), // ISO; route converts to Date
  priority: z.nativeEnum(TodoPriority).optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  priority: z.nativeEnum(TodoPriority).optional(),
  status: z.nativeEnum(TodoStatus).optional(),
});

const listQuerySchema = z.object({
  status: z.nativeEnum(TodoStatus).optional(),
});

/// XP scaled by priority on completion. Centralized here (not in
/// award.ts) because the values are Todo-domain-specific.
const XP_REWARD: Record<TodoPriority, number> = {
  LOW: 10,
  MEDIUM: 20,
  HIGH: 30,
};

export async function todoRoutes(app: FastifyInstance) {
  // GET /todos — list the user's todos
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const q = listQuerySchema.parse(req.query ?? {});
    const where: any = { userId: me.id };
    if (q.status) where.status = q.status;
    // Prisma's orderBy doesn't support NULLS LAST, so we sort
    // in JS after fetching. For v1 the list is bounded (<=200
    // items realistically) so this is fine.
    const todos = await prisma.todoItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    todos.sort((a, b) => {
      // OPEN first, then DONE (status order: OPEN asc since enum
      // is 'OPEN'|'DONE' alphabetically)
      if (a.status !== b.status) {
        return a.status === 'OPEN' ? -1 : 1;
      }
      // Due date asc (nulls last)
      const aDue = a.dueDate ? a.dueDate.getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.dueDate ? b.dueDate.getTime() : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      // Priority desc (HIGH > MEDIUM > LOW)
      const pOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
      const ap = pOrder[a.priority as keyof typeof pOrder] ?? 0;
      const bp = pOrder[b.priority as keyof typeof pOrder] ?? 0;
      if (ap !== bp) return bp - ap;
      // Newest first
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    return todos.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      dueDate: t.dueDate?.toISOString() ?? null,
      priority: t.priority,
      status: t.status,
      completedAt: t.completedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));
  });

  // POST /todos — create
  app.post('/', async (req) => {
    const me = await requireUser(req);
    const body = createSchema.parse(req.body);
    const todo = await prisma.todoItem.create({
      data: {
        userId: me.id,
        title: body.title,
        description: body.description ?? null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        priority: body.priority ?? TodoPriority.MEDIUM,
      },
    });
    return todo;
  });

  // PATCH /todos/:id — edit or mark complete
  // Returns the updated row PLUS the XP award info if a transition
  // to DONE happened on this call (so the client can show "+20 XP!"
  // feedback).
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = req.params;
    const body = updateSchema.parse(req.body);

    const existing = await prisma.todoItem.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    if (existing.userId !== me.id) return reply.code(403).send({ error: 'Forbidden' });

    // Build the update object. Treat explicit undefined = no change.
    // Treat null = clear (used for dueDate / description).
    const data: any = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.dueDate !== undefined) data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.status !== undefined) data.status = body.status;

    // Detect the OPEN → DONE transition for XP award. Re-saving a
    // DONE todo (or uncompleting back to OPEN) doesn't re-award.
    const isCompletingNow =
      body.status === TodoStatus.DONE && existing.status !== TodoStatus.DONE;
    if (isCompletingNow) {
      data.completedAt = new Date();
    }

    const updated = await prisma.todoItem.update({ where: { id }, data });

    if (isCompletingNow) {
      const xp = XP_REWARD[existing.priority as TodoPriority] ?? XP_REWARD.MEDIUM;
      const award = await awardXpGold(me.id, { xp });
      return {
        todo: updated,
        award: {
          xp: award.xp,
          gold: award.gold,
          leveledUp: award.leveledUp,
          newLevel: award.level,
        },
      };
    }
    return { todo: updated, award: null };
  });

  // DELETE /todos/:id — remove
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = req.params;
    const existing = await prisma.todoItem.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    if (existing.userId !== me.id) return reply.code(403).send({ error: 'Forbidden' });
    await prisma.todoItem.delete({ where: { id } });
    return { ok: true };
  });
}