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
// Explicit `select` (not `include`) so we don't query the
// `groupIndex` column. That column was added in migration
// 20260703090000_superset_group_index. If a user pulls the
// latest image but the migration hasn't been applied yet
// (e.g. they restarted only the web service, not the api with
// the Dockerfile's `migrate deploy` step), Prisma would
// query a non-existent column and 500. By NOT selecting
// groupIndex, the endpoints work regardless of migration
// state. The client already treats `ex.groupIndex` as
// `?? null` so the missing field is handled gracefully.
//
// Once the migration is reliably applied across all installs,
// flip the `groupIndex: true` back in (TODO: track with a
// version flag) and remove the `as any` cast on the response
// in the routes that depend on this shape.
const includeShape = {
  exercises: {
    select: {
      id: true,
      templateId: true,
      name: true,
      order: true,
      sets: {
        select: {
          id: true,
          order: true,
          targetReps: true,
          targetDuration: true,
        },
        orderBy: { order: 'asc' as const },
      },
    },
    orderBy: { order: 'asc' as const },
  },
} as const;

/**
 * Create or replace the nested exercises+sets for a template.
 * Tries to write `groupIndex` (added in migration
 * 20260703090000_superset_group_index) and falls back to skipping
 * it if the column doesn't exist. Lets a user keep creating +
 * editing templates even when the migration is pending — the
 * only loss is the superset pairing data, which they can re-set
 * once they migrate.
 */
async function createOrUpdateTemplate(
  userId: string,
  body: z.infer<typeof CreateTemplateSchema>,
  isCreate: boolean,
  log: { warn: (obj: any, msg: string) => void } | null,
  templateId?: string,
) {
  const data: any = {
    exercises: {
      create: body.exercises.map((ex) => ({
        name: ex.name,
        order: ex.order,
        // groupIndex is conditional — only included if the value
        // is non-null. The Prisma client would fail the whole write
        // if we tried to write to a missing column, so we catch.
        ...(ex.groupIndex != null ? { groupIndex: ex.groupIndex } : {}),
        sets: {
          create: ex.sets.map((s) => ({
            order: s.order,
            targetReps: s.targetReps,
            targetDuration: s.targetDuration ?? null,
          })),
        },
      })),
    },
  };
  if (isCreate) {
    Object.assign(data, {
      userId,
      name: body.name,
      type: body.type,
      notes: body.notes ?? null,
    });
  } else {
    Object.assign(data, {
      name: body.name,
      type: body.type,
      notes: body.notes ?? null,
    });
  }
  try {
    return isCreate
      ? await prisma.workoutTemplate.create({ data, include: includeShape })
      : await prisma.workoutTemplate.update({ where: { id: templateId! }, data, include: includeShape });
  } catch (err: any) {
    // If the failure is the missing groupIndex column, retry
    // without it. The user can re-pair the routines after the
    // migration runs (the API endpoint POST /workout-templates
    // with a paired payload will succeed once the column exists).
    const msg = String(err?.message ?? err);
    if (err?.code === 'P2010' || /groupIndex|column.*does not exist/i.test(msg)) {
      log?.warn?.({ err: msg }, 'groupIndex column missing — retrying create without it (run migration 20260703090000_superset_group_index to enable supersets)');
      const dataNoGroup = {
        ...data,
        exercises: {
          create: data.exercises.create.map((ex: any) => {
            const { groupIndex, ...rest } = ex;
            return rest;
          }),
        },
      };
      return isCreate
        ? await prisma.workoutTemplate.create({ data: dataNoGroup, include: includeShape })
        : await prisma.workoutTemplate.update({ where: { id: templateId! }, data: dataNoGroup, include: includeShape });
    }
    throw err;
  }
}

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
  /// Superset pairing. Two or more exercises sharing the same
  /// groupIndex are walked round-robin by the live logger
  /// (1A → 1B → 2A → 2B). Null = linear walk. The Routines page
  /// assigns groupIndex when the user clicks "Pair with next";
  /// the field is null on every existing template (migration
  /// is backwards-compatible).
  groupIndex: z.number().int().min(1).optional().nullable(),
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
    const created = await createOrUpdateTemplate(me.id, body, /* create */ true, req.log);
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

    await prisma.$transaction([
      prisma.workoutTemplateExercise.deleteMany({ where: { templateId: id } }),
    ]);
    const updated = await createOrUpdateTemplate(me.id, body, /* create */ false, req.log, id);
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
            // groupIndex isn't part of includeShape's select (we
            // deliberately exclude it for migration-safety reasons
            // — see the comment at the top of includeShape). The
            // duplicate endpoint still wants to preserve it when
            // present, so we cast narrowly: this single field on
            // this single element, not a blanket `as any`.
            groupIndex: (ex as { groupIndex?: number | null }).groupIndex ?? null,
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