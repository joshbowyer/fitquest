// =============================================================================
// Workout templates — saved workout patterns the user can reuse.
// =============================================================================
//
// Endpoints (all under /workout-templates):
//
//   GET    /            — list the user's templates (no nested exercises,
//                         for the Activities quick-start card)
//   GET    /:id         — single template with full nested exercises+sets
//                         (for the /routines edit page)
//   POST   /            — create
//   PATCH  /:id         — update name/notes/type/exercises (full replace
//                         of the exercises+sets subtree — simpler than
//                         diffing)
//   DELETE /:id         — delete
//   POST   /:id/duplicate — copy with "(copy)" suffix, returns the new row
//
// All requests are scoped to me.id; the server never trusts a client-
// supplied userId.
//
// FK cascade on the schema handles cleanup of nested exercises+sets
// when a template is deleted, so DELETE /:id is just one round-trip.
// =============================================================================

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { randomUuid } from '../lib/randomUuid.js';

// Wire-shape returned to the client. Mirrors the prisma include so the
// frontend can render without further hydration.
const includeShape = {
  exercises: {
    include: { sets: { orderBy: { order: 'asc' as const } } },
    orderBy: { order: 'asc' as const },
  },
} as const;

const SetInput = z.object({
  // No id in input — server generates. We always re-create sets on
  // update so the client doesn't need to track which ones are new vs
  // existing (avoids the diff/merge problem entirely).
  order: z.number().int().min(0),
  targetReps: z.number().int().min(0).max(1000),
  targetDuration: z.number().int().min(0).max(60 * 60 * 6).optional().nullable(),
});

const ExerciseInput = z.object({
  name: z.string().min(1).max(100),
  order: z.number().int().min(0),
  sets: z.array(SetInput).min(1),
});

const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['STRENGTH', 'HYPERTROPHY', 'CALISTHENICS', 'CARDIO', 'MOBILITY', 'OTHER']),
  notes: z.string().max(2000).optional().nullable(),
  exercises: z.array(ExerciseInput).min(1),
});

const UpdateTemplateSchema = CreateTemplateSchema; // same shape

export async function workoutTemplateRoutes(app: FastifyInstance) {
  // ----- LIST -----
  // Returns the user's templates WITHOUT nested exercises. Used by the
  // Activities quick-start card and the /routines page list. Each row
  // also carries an `exerciseCount` so the client can render "8 exercises"
  // without a second round-trip.
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const rows = await prisma.workoutTemplate.findMany({
      where: { userId: me.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { exercises: true } },
      },
    });
    return {
      items: rows.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        notes: t.notes,
        exerciseCount: t._count.exercises,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    };
  });

  // ----- GET ONE -----
  // Full nested shape for the edit form.
  app.get('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const t = await prisma.workoutTemplate.findFirst({
      where: { id, userId: me.id },
      include: includeShape,
    });
    if (!t) return reply.code(404).send({ error: 'Template not found' });
    return t;
  });

  // ----- CREATE -----
  app.post('/', async (req, reply) => {
    const me = await requireUser(req);
    const body = CreateTemplateSchema.parse(req.body);
    const created = await prisma.workoutTemplate.create({
      data: {
        userId: me.id,
        name: body.name,
        type: body.type,
        notes: body.notes ?? null,
        exercises: {
          create: body.exercises.map((ex) => ({
            name: ex.name,
            order: ex.order,
            sets: {
              create: ex.sets.map((s) => ({
                order: s.order,
                targetReps: s.targetReps,
                targetDuration: s.targetDuration ?? null,
              })),
            },
          })),
        },
      },
      include: includeShape,
    });
    return reply.code(201).send(created);
  });

  // ----- UPDATE -----
  // Full replace of exercises+sets. Simpler than diffing and the
  // expected edit volume is low enough that the rewrite cost is
  // negligible (a template has <30 sets total).
  app.patch('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const body = UpdateTemplateSchema.parse(req.body);

    // Verify ownership first. findFirst with userId+id prevents
    // cross-user updates even if the client guesses an id.
    const existing = await prisma.workoutTemplate.findFirst({
      where: { id, userId: me.id },
      select: { id: true },
    });
    if (!existing) return reply.code(404).send({ error: 'Template not found' });

    // Two-step: delete nested rows (cascade handles this if we
    // delete the template, but we want to preserve the template id).
    // Easier: delete the exercises explicitly — that cascades to sets.
    await prisma.$transaction([
      prisma.workoutTemplateExercise.deleteMany({ where: { templateId: id } }),
      prisma.workoutTemplate.update({
        where: { id },
        data: {
          name: body.name,
          type: body.type,
          notes: body.notes ?? null,
          exercises: {
            create: body.exercises.map((ex) => ({
              name: ex.name,
              order: ex.order,
              sets: {
                create: ex.sets.map((s) => ({
                  order: s.order,
                  targetReps: s.targetReps,
                  targetDuration: s.targetDuration ?? null,
                })),
              },
            })),
          },
        },
      }),
    ]);

    const updated = await prisma.workoutTemplate.findUnique({
      where: { id },
      include: includeShape,
    });
    return reply.send(updated);
  });

  // ----- DELETE -----
  app.delete('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const existing = await prisma.workoutTemplate.findFirst({
      where: { id, userId: me.id },
      select: { id: true },
    });
    if (!existing) return reply.code(404).send({ error: 'Template not found' });
    // Cascade on the schema (WorkoutTemplateExercise → WorkoutTemplateSet)
    // takes care of nested rows.
    await prisma.workoutTemplate.delete({ where: { id } });
    return reply.send({ ok: true });
  });

  // ----- DUPLICATE -----
  // Copies the template with "(copy)" appended to the name. Useful
  // when iterating on a routine (e.g. "Push Day 5x5" → "Push Day 5x5 (heavy)").
  app.post('/:id/duplicate', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const source = await prisma.workoutTemplate.findFirst({
      where: { id, userId: me.id },
      include: includeShape,
    });
    if (!source) return reply.code(404).send({ error: 'Template not found' });

    const copy = await prisma.workoutTemplate.create({
      data: {
        userId: me.id,
        // "(copy)" is a common convention; if the source already ends
        // with "(copy)" or "(copy N)" we still just append "(copy)"
        // — the user can rename. Don't try to be clever about numbering.
        name: `${source.name} (copy)`,
        type: source.type,
        notes: source.notes,
        exercises: {
          create: source.exercises.map((ex) => ({
            name: ex.name,
            order: ex.order,
            sets: {
              create: ex.sets.map((s) => ({
                order: s.order,
                targetReps: s.targetReps,
                targetDuration: s.targetDuration,
              })),
            },
          })),
        },
      },
      include: includeShape,
    });
    return reply.code(201).send(copy);
  });
}

// Re-export the schema so callers (e.g. import.ts) can construct
// ExportPayload-shaped dumps without re-importing zod.
export { CreateTemplateSchema };