import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { PLATEAU_KINDS, type PlateauKind } from '../lib/plateau.js';
import { refreshPlateauSnapshot, sundayOfWeek } from '../lib/plateauSnapshot.js';

const PlateauKindSchema = z.enum([
  'NO_PR_RECENT',
  'ONE_RM_REGRESSION',
  'VOLUME_REGRESSION',
  'WEIGHT_FLATLINE',
  'METRIC_FLATLINE',
  'ALL',
]);

const CreateSchema = z.object({
  kind: PlateauKindSchema,
  /** How many days from now to mute. 1..365. */
  days: z.number().int().min(1).max(365),
  /** Optional free-text note ("summer cut", "post-injury deload"). */
  reason: z.string().max(140).optional(),
});

export async function plateauRoutes(app: FastifyInstance) {
  /**
   * GET /plateaus/pauses
   * List the caller's currently-active plateau pauses (resumeAt > now).
   * Past-expiry rows are filtered out at the SQL level so the UI
   * doesn't have to.
   */
  app.get('/pauses', async (req) => {
    const me = await requireUser(req);
    const now = new Date();
    const rows = await prisma.plateauPause.findMany({
      where: { userId: me.id, resumeAt: { gt: now } },
      orderBy: { resumeAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      pausedAt: r.pausedAt.toISOString(),
      resumeAt: r.resumeAt.toISOString(),
      reason: r.reason,
    }));
  });

  /**
   * POST /plateaus/pauses
   * Create a new pause. If a pause already exists for the same
   * kind, replace it (resumeAt updated; same id). Prevents stacking
   * redundant pauses on the same kind which would just spam the
   * settings list.
   */
  app.post('/pauses', async (req) => {
    const me = await requireUser(req);
    const body = CreateSchema.parse(req.body);
    const now = new Date();
    const resumeAt = new Date(now.getTime() + body.days * 24 * 60 * 60 * 1000);

    // Upsert by (userId, kind). The unique constraint we want
    // doesn't exist in the schema (deliberately — pauses can be
    // re-created after expiry), so we emulate it: delete any active
    // pause of the same kind first, then create a fresh one.
    await prisma.plateauPause.deleteMany({
      where: { userId: me.id, kind: body.kind as any, resumeAt: { gt: now } },
    });
    const row = await prisma.plateauPause.create({
      data: {
        userId: me.id,
        kind: body.kind as any,
        resumeAt,
        reason: body.reason ?? null,
      },
    });
    return {
      id: row.id,
      kind: row.kind,
      pausedAt: row.pausedAt.toISOString(),
      resumeAt: row.resumeAt.toISOString(),
      reason: row.reason,
    };
  });

  /**
   * DELETE /plateaus/pauses/:id
   * End a pause early. Only the owner can delete; non-owned or
   * already-expired ids return 404.
   */
  app.delete<{ Params: { id: string } }>('/pauses/:id', async (req, reply) => {
    const me = await requireUser(req);
    const row = await prisma.plateauPause.findUnique({ where: { id: req.params.id } });
    if (!row || row.userId !== me.id) return reply.code(404).send({ error: 'Not found' });
    await prisma.plateauPause.delete({ where: { id: row.id } });
    return { ok: true };
  });

  /**
   * GET /plateaus
   * Run the detector on demand and return the current array. Useful
   * for the settings "preview" panel — the user can see what would
   * fire if no pauses were active.
   */
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const { detectPlateaus } = await import('../lib/plateau.js');
    const plateaus = await detectPlateaus(me.id);
    return { plateaus };
  });

  /**
   * GET /plateaus/snapshot
   * Return the most recent cached PlateauSnapshot (or null when no
   * snapshot exists yet — the weekly cron hasn't run, or the user
   * signed up in the last 24h). The dashboard badge reads from
   * here so we don't run the full detector on every page load.
   *
   * Query param `?force=1` triggers a refresh on the way out and
   * returns the freshly-cached snapshot — used by the dashboard
   * "Re-check" button.
   */
  app.get<{ Querystring: { force?: string } }>('/snapshot', async (req) => {
    const me = await requireUser(req);
    if (req.query.force === '1') {
      const r = await refreshPlateauSnapshot(me.id, me.timezone);
      const row = await prisma.plateauSnapshot.findUnique({
        where: { userId_weekStart: { userId: me.id, weekStart: r.weekStart } },
      });
      return parseSnapshotRow(row);
    }
    const row = await prisma.plateauSnapshot.findFirst({
      where: { userId: me.id },
      orderBy: { generatedAt: 'desc' },
    });
    return parseSnapshotRow(row);
  });

  /**
   * GET /plateaus/snapshot/badges
   * Lightweight count for the sidebar / topbar badge. Returns
   * { count: number, weekStart: string|null, stale: boolean } so
   * the UI can decide whether to highlight. `stale` is true when
   * the snapshot is older than 8 days (i.e. the cron missed a
   * week — schedule drift, server down, etc.) so the badge can
   * pulse red instead of amber.
   */
  app.get('/snapshot/badges', async (req) => {
    const me = await requireUser(req);
    const row = await prisma.plateauSnapshot.findFirst({
      where: { userId: me.id },
      orderBy: { generatedAt: 'desc' },
    });
    if (!row) return { count: 0, weekStart: null, stale: false };
    const ageMs = Date.now() - row.generatedAt.getTime();
    const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
    return {
      count: row.flagCount,
      weekStart: row.weekStart,
      stale: ageMs > eightDaysMs,
    };
  });
}

// Re-export for tests / other callers.
export { PLATEAU_KINDS };

function parseSnapshotRow(row: {
  weekStart: string;
  plateaus: string;
  flagCount: number;
  generatedAt: Date;
} | null) {
  if (!row) return { weekStart: null, flagCount: 0, plateaus: [], generatedAt: null };
  let plateaus: any[] = [];
  try {
    const parsed = JSON.parse(row.plateaus);
    if (Array.isArray(parsed)) plateaus = parsed;
  } catch {}
  return {
    weekStart: row.weekStart,
    flagCount: row.flagCount,
    plateaus,
    generatedAt: row.generatedAt.toISOString(),
  };
}
