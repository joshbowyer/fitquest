import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { sundayOfWeek } from '../lib/plateauSnapshot.js';

/**
 * The weekly Ignatian examen — Sunday-evening reflection. Three
 * open-text fields (consoled / desolated / godsPresence) plus an
 * optional notes overflow. One row per user per week (UPSERT on
 * userId + weekStart). Surfaced in the morning report's spiritual
 * section ("4 of last 5 Sundays logged").
 *
 * Field length caps: 2000 chars each is generous for a paragraph.
 * Anything longer suggests the user is journaling in the wrong
 * field — they can use the notes overflow or split across weeks.
 */
const ExamenSchema = z.object({
  consoled: z.string().trim().min(1).max(2000),
  desolated: z.string().trim().min(1).max(2000),
  godsPresence: z.string().trim().min(1).max(2000),
  notes: z.string().trim().max(4000).optional(),
});

const ExamenQuerySchema = z.object({
  /** How many weeks back to include. Default 8. */
  weeks: z.coerce.number().int().min(1).max(52).optional(),
});

export async function examenRoutes(app: FastifyInstance) {
  /**
   * GET /examen
   * Returns the user's recent examen responses, newest first.
   * Includes the current week (whether submitted or not) so the
   * UI can show "you haven't logged this week's examen yet".
   */
  app.get<{ Querystring: { weeks?: number } }>('/', async (req) => {
    const me = await requireUser(req);
    const { weeks } = ExamenQuerySchema.parse(req.query);
    const window = weeks ?? 8;
    const cutoff = weeksAgoSunday(me.timezone, window);
    const rows = await prisma.examenResponse.findMany({
      where: { userId: me.id, weekStart: { gte: cutoff } },
      orderBy: { weekStart: 'desc' },
      take: window + 1,
    });
    const currentWeek = sundayOfWeek(new Date(), me.timezone);
    return {
      currentWeek,
      items: rows.map((r) => ({
        id: r.id,
        weekStart: r.weekStart,
        consoled: r.consoled,
        desolated: r.desolated,
        godsPresence: r.godsPresence,
        notes: r.notes ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        isCurrentWeek: r.weekStart === currentWeek,
      })),
    };
  });

  /**
   * POST /examen
   * Upsert the user's response for the current week. Used by the
   * Spiritual page's "Fill out this week's examen" modal. Updating
   * an existing row preserves the original createdAt so the
   * morning report can still tell when the user first engaged.
   */
  app.post('/', async (req, reply) => {
    const me = await requireUser(req);
    const body = ExamenSchema.parse(req.body);
    const weekStart = sundayOfWeek(new Date(), me.timezone);
    const row = await prisma.examenResponse.upsert({
      where: { userId_weekStart: { userId: me.id, weekStart } },
      create: {
        userId: me.id,
        weekStart,
        consoled: body.consoled,
        desolated: body.desolated,
        godsPresence: body.godsPresence,
        notes: body.notes ?? null,
      },
      update: {
        consoled: body.consoled,
        desolated: body.desolated,
        godsPresence: body.godsPresence,
        notes: body.notes ?? null,
      },
    });
    reply.code(200);
    return {
      id: row.id,
      weekStart: row.weekStart,
      consoled: row.consoled,
      desolated: row.desolated,
      godsPresence: row.godsPresence,
      notes: row.notes ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      isCurrentWeek: true,
    };
  });

  /**
   * DELETE /examen/:weekStart
   * Hard-delete an examen row (user changed their mind). Only the
   * owner can delete.
   */
  app.delete<{ Params: { weekStart: string } }>('/:weekStart', async (req, reply) => {
    const me = await requireUser(req);
    const row = await prisma.examenResponse.findUnique({
      where: { userId_weekStart: { userId: me.id, weekStart: req.params.weekStart } },
    });
    if (!row) return reply.code(404).send({ error: 'Not found' });
    await prisma.examenResponse.delete({ where: { id: row.id } });
    return { ok: true };
  });
}

/**
 * Sunday N-weeks-ago in YYYY-MM-DD (local tz). Used as the cutoff
 * for /examen windowing so we don't fetch the user's entire
 * history every page load.
 */
function weeksAgoSunday(timezone: string | null, weeks: number): string {
  const now = new Date();
  const thisSunday = sundayOfWeek(now, timezone);
  const parts = thisSunday.split('-').map(Number);
  // Validate the YYYY-MM-DD parts — sundayOfWeek is supposed to
  // produce a well-formed date but defense in depth keeps tsc's
  // noUncheckedIndexedAccess happy AND catches a regression where
  // sundayOfWeek returns something unexpected.
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid sundayOfWeek output: ${thisSunday}`);
  }
  const [y, m, d] = parts as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - weeks * 7);
  return dt.toISOString().slice(0, 10);
}
