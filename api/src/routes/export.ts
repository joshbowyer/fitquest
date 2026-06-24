// ============================================================
// User data export routes
// ============================================================
//
// GET  /export/info    — table counts preview before download
// GET  /export/json    — full JSON dump (one big object)
// GET  /export/csv     — ZIP with one .csv per table
//
// All routes require auth and scope to req.user.id.

import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/auth.js';
import { buildExport, exportInfo, toCsv, zipStore } from '../lib/export.js';

export async function exportRoutes(app: FastifyInstance) {
  app.get('/export/info', async (req) => {
    const me = await requireUser(req);
    return exportInfo(me.id);
  });

  app.get('/export/json', async (req, reply) => {
    const me = await requireUser(req);
    const payload = await buildExport(me.id);
    const filename = `fitquest-export-${me.username}-${new Date().toISOString().slice(0, 10)}.json`;
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(JSON.stringify(payload, null, 2));
  });

  app.get('/export/csv', async (req, reply) => {
    const me = await requireUser(req);
    const payload = await buildExport(me.id);

    // One CSV per table. Skip empty arrays (no point including
    // an empty header-only CSV in the ZIP). Skip the parent
    // `tables`/`counts` envelope — each table stands alone.
    const files: { name: string; content: string }[] = [];
    for (const [tableName, rows] of Object.entries(payload.tables)) {
      if (rows == null) continue;
      if (Array.isArray(rows) && rows.length === 0) continue;
      if (!Array.isArray(rows) && (rows as object | null) == null) continue;
      const csv = toCsv(Array.isArray(rows) ? rows : [rows]);
      if (csv) files.push({ name: `${tableName}.csv`, content: csv });
    }
    // Also include a tiny manifest so a curious spreadsheet
    // user knows what schema/version they're looking at.
    files.push({
      name: '_manifest.csv',
      content: toCsv(
        Object.entries(payload.counts).map(([table, count]) => ({ table, count })),
      ),
    });
    // Plus the user profile as a single-row CSV for the curious.
    files.push({
      name: 'profile.csv',
      content: toCsv([payload.user]),
    });

    const zip = zipStore(files);
    const filename = `fitquest-export-${me.username}-${new Date().toISOString().slice(0, 10)}.zip`;
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(zip);
  });
}
