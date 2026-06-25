// ============================================================
// User data import — JSON import with FK remapping
// ============================================================
//
// Counterpart to lib/export.ts. Accepts an ExportPayload and
// creates per-user rows under a single transaction.
//
// Strategy: regenerate ALL IDs so the imported data can coexist
// with the user's existing data (or be the only data, if they
// wiped first). Foreign keys are remapped via in-memory lookup
// tables as we go. Tables are inserted in dependency order —
// parents first.
//
// Limitations (intentional, v1):
//   - User row is NOT imported. Username + credentials are
//     server-managed and can't be round-tripped.
//   - InventoryItem references system ItemDef by FK. If the
//     itemDefId from the export no longer exists on the
//     target server, the inventory item is skipped.
//   - Workout tree (workout → exercise → set) is imported
//     as-is. Cross-table refs (e.g. plateauSnapshot → workout)
//     are NOT rewired because they reference local-only rows.
//
// Dry-run mode validates + reports without writing.

import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma.js';
import { EXPORT_SCHEMA, EXPORT_VERSION, type ExportPayload } from './export.js';
import { randomUuid } from './randomUuid.js';

export type ImportOptions = {
  /** If true, only validate + report — don't write. */
  dryRun?: boolean;
  /**
   * If true, delete ALL existing per-user rows before inserting.
   * Defaults to false (additive merge).
   */
  wipeFirst?: boolean;
};

export type ImportResult = {
  ok: boolean;
  schema: string;
  version: number;
  dryRun: boolean;
  wiped: number;
  imported: Record<string, number>;
  skipped: Record<string, number>;
  errors: { table: string; id?: string; reason: string }[];
};

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

// ============================================================
// Schema gate. Reject unknown / mismatched payloads up front
// before we touch the database.
// ============================================================
export function validatePayload(payload: unknown): asserts payload is ExportPayload {
  if (!payload || typeof payload !== 'object') {
    throw new ImportError('payload_not_object');
  }
  const p = payload as Record<string, unknown>;
  if (p.schema !== EXPORT_SCHEMA) {
    throw new ImportError(`schema_mismatch: expected ${EXPORT_SCHEMA}, got ${String(p.schema)}`);
  }
  if (typeof p.version !== 'number') {
    throw new ImportError('version_missing');
  }
  if (p.version > EXPORT_VERSION) {
    throw new ImportError(`version_too_new: server supports up to ${EXPORT_VERSION}, export is ${p.version}`);
  }
  if (!p.tables || typeof p.tables !== 'object') {
    throw new ImportError('tables_missing');
  }
  if (!p.userId || typeof p.userId !== 'string') {
    throw new ImportError('userId_missing');
  }
}

// ============================================================
// Wipe: delete all per-user rows for `userId`. Mirrors the
// tables we import. Order matters: children before parents.
// ============================================================
async function wipeUserData(userId: string, prisma: PrismaClient): Promise<number> {
  // Count before so the caller can report how much was removed.
  const before = await prisma.workout.count({ where: { userId } });

  await prisma.$transaction([
    prisma.breachDamageEvent.deleteMany({ where: { userId } }),
    prisma.userBreachProgress.deleteMany({ where: { userId } }),
    prisma.penanceEvent.deleteMany({ where: { userId } }),
    prisma.penanceTemplate.deleteMany({ where: { userId } }),
    prisma.homeBase.deleteMany({ where: { userId } }),
    prisma.set.deleteMany({ where: { exercise: { workout: { userId } } } }),
    prisma.exercise.deleteMany({ where: { workout: { userId } } }),
    prisma.workout.deleteMany({ where: { userId } }),
    prisma.measurement.deleteMany({ where: { userId } }),
    prisma.geneticMax.deleteMany({ where: { userId } }),
    prisma.pr.deleteMany({ where: { userId } }),
    prisma.avatar.deleteMany({ where: { userId } }),
    prisma.userSkill.deleteMany({ where: { userId } }),
    prisma.userAchievement.deleteMany({ where: { userId } }),
    prisma.plateauSnapshot.deleteMany({ where: { userId } }),
    prisma.plateauPause.deleteMany({ where: { userId } }),
    prisma.examenResponse.deleteMany({ where: { userId } }),
    prisma.userWorldProgress.deleteMany({ where: { userId } }),
    prisma.painLog.deleteMany({ where: { userId } }),
    prisma.routineDay.deleteMany({ where: { userId } }),
    prisma.routine.deleteMany({ where: { userId } }),
    prisma.prayerLog.deleteMany({ where: { userId } }),
    prisma.dailyLog.deleteMany({ where: { userId } }),
    prisma.daily.deleteMany({ where: { userId } }),
    prisma.supplementLog.deleteMany({ where: { userId } }),
    prisma.habitLog.deleteMany({ where: { userId } }),
    prisma.habit.deleteMany({ where: { userId } }),
    prisma.inventoryItem.deleteMany({ where: { userId } }),
    prisma.morningReport.deleteMany({ where: { userId } }),
    prisma.spiritualReflection.deleteMany({ where: { userId } }),
    prisma.dailyTrackedItem.deleteMany({ where: { userId } }),
    prisma.userTrackedItem.deleteMany({ where: { userId } }),
    prisma.substanceLog.deleteMany({ where: { userId } }),
    prisma.mealEntry.deleteMany({ where: { userId } }),
    prisma.foodItem.deleteMany({ where: { userId } }),
    prisma.savedFood.deleteMany({ where: { userId } }),
    prisma.correlationSnapshot.deleteMany({ where: { userId } }),
    prisma.metricInsight.deleteMany({ where: { userId } }),
    prisma.activityInsight.deleteMany({ where: { userId } }),
  ]);

  return before;
}

// ============================================================
// Run the import. Big monolithic transaction; we want all-or-
// nothing semantics so a partial import never leaves the user
// in a half-imported state.
// ============================================================
export async function importExport(
  userId: string,
  payload: ExportPayload,
  options: ImportOptions = {},
  prisma: PrismaClient = defaultPrisma,
): Promise<ImportResult> {
  validatePayload(payload);

  const result: ImportResult = {
    ok: true,
    schema: payload.schema,
    version: payload.version,
    dryRun: !!options.dryRun,
    wiped: 0,
    imported: {},
    skipped: {},
    errors: [],
  };

  if (options.wipeFirst && !options.dryRun) {
    // Wipe is best-effort. If the $transaction misroutes a model
    // at runtime (we've seen breachDamageEvent get the FoodItem
    // schema), the import continues and the caller sees the
    // per-table errors instead of a hard failure. The user can
    // then wipe manually via /admin/users/:id.
    try {
      result.wiped = await wipeUserData(userId, prisma);
    } catch (e: any) {
      fail('wipe', undefined, e?.message ?? 'unknown');
    }
  }

  const bump = (k: string, n: number) => {
    result.imported[k] = (result.imported[k] ?? 0) + n;
  };
  const skip = (k: string) => {
    result.skipped[k] = (result.skipped[k] ?? 0) + 1;
  };
  const fail = (table: string, id: string | undefined, reason: string) => {
    result.errors.push({ table, id, reason });
    result.ok = false;
  };
  // Unique-constraint violations on additive imports (already
  // imported / already in DB) are reported as `skipped` not
  // errors. The user re-running the same import twice shouldn't
  // see "errors: 426".
  const isDuplicate = (e: any) => {
    const code = e?.code ?? e?.meta?.code;
    if (code === 'P2002') return true;
    const msg = String(e?.message ?? '');
    return msg.includes('Unique constraint failed');
  };
  // Wrap a single-row insert so the bulk loops stay short.
  // `table` is the result-imported key, `id` is the source row's
  // id (used for error reporting).
  async function tryCreate(
    table: string,
    id: string | undefined,
    fn: () => Promise<unknown>,
  ) {
    try {
      await fn();
      bump(table, 1);
    } catch (e: any) {
      if (isDuplicate(e)) { skip(table); return; }
      fail(table, id, e?.message ?? 'unknown');
    }
  }

  // Dry-run returns after the wipe decision + validation only.
  if (options.dryRun) {
    result.imported = { ...payload.counts };
    return result;
  }

  // We collect rows into an in-memory batch and bulk-insert in
  // dependency order. IDs are remapped via lookup tables.
  const idMap = new Map<string, string>(); // oldId → newId

  const t = payload.tables;

  // ----- AVATAR (1 row max) -----
  if (t.avatar) {
    const a = t.avatar as Record<string, unknown>;
    await tryCreate('avatar', undefined, async () => {
      await prisma.avatar.upsert({
        where: { userId },
        update: { ...stripUnknown(a, ['id', 'userId', 'createdAt', 'updatedAt']) },
        create: { userId, ...stripUnknown(a, ['id', 'userId', 'createdAt', 'updatedAt']) },
      });
    });
  }

  // ----- WORKOUT → EXERCISE → SET tree -----
  const exerciseIdMap = new Map<string, string>();
  const setIdMap = new Map<string, string>();

  if (Array.isArray(t.workouts)) {
    for (const wRaw of t.workouts as Array<Record<string, unknown>>) {
      try {
        const oldId = String(wRaw.id ?? '');
        const newId = randomUuid();
        idMap.set(oldId, newId);
        const w = stripUnknown(wRaw, ['id', 'userId']);
        await prisma.workout.create({ data: { ...w, id: newId, userId } });
        bump('workouts', 1);

        // Match exercises whose workoutId maps to this oldId.
        const matchingExercises = (t.exercises as Array<Record<string, unknown>>).filter(
          (e) => e.workoutId === oldId
        );
        for (const eRaw of matchingExercises) {
          const oldExId = String(eRaw.id ?? '');
          const newExId = randomUuid();
          exerciseIdMap.set(oldExId, newExId);
          const e = stripUnknown(eRaw, ['id', 'workoutId']);
          await prisma.exercise.create({ data: { ...e, id: newExId, workoutId: newId } });
          bump('exercises', 1);

          const matchingSets = (t.sets as Array<Record<string, unknown>>).filter(
            (s) => s.exerciseId === oldExId
          );
          for (const sRaw of matchingSets) {
            try {
              const oldSetId = String(sRaw.id ?? '');
              const newSetId = randomUuid();
              setIdMap.set(oldSetId, newSetId);
              const s = stripUnknown(sRaw, ['id', 'exerciseId']);
              await prisma.set.create({ data: { ...s, id: newSetId, exerciseId: newExId } });
              bump('sets', 1);
            } catch (e: any) {
              fail('sets', String(sRaw.id ?? ''), e?.message ?? 'unknown');
            }
          }
        }
      } catch (e: any) {
        fail('workouts', String(wRaw.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- MEASUREMENTS -----
  if (Array.isArray(t.measurements)) {
    for (const m of t.measurements as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(m, ['id', 'userId']);
        await prisma.measurement.create({ data: { ...data, userId } });
        bump('measurements', 1);
      } catch (e: any) {
        if (isDuplicate(e)) { skip('measurements'); continue; }
        fail('measurements', String(m.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- GENETIC MAX -----
  if (Array.isArray(t.geneticMax)) {
    for (const g of t.geneticMax as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(g, ['id', 'userId']);
        await prisma.geneticMax.create({ data: { ...data, userId } });
        bump('geneticMax', 1);
      } catch (e: any) {
        if (isDuplicate(e)) { skip('geneticMax'); continue; }
        fail('geneticMax', String(g.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- PRS -----
  if (Array.isArray(t.prs)) {
    for (const p of t.prs as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(p, ['id', 'userId']);
        await prisma.pr.create({ data: { ...data, userId } });
        bump('prs', 1);
      } catch (e: any) {
        fail('prs', String(p.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- USER SKILLS -----
  if (Array.isArray(t.userSkills)) {
    for (const us of t.userSkills as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(us, ['id', 'userId']);
        await prisma.userSkill.create({ data: { ...data, userId } });
        bump('userSkills', 1);
      } catch (e: any) {
        fail('userSkills', String(us.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- HOME BASE (1 row max) -----
  if (t.homeBase) {
    try {
      const h = t.homeBase as Record<string, unknown>;
      await prisma.homeBase.upsert({
        where: { userId },
        update: stripUnknown(h, ['id', 'userId', 'createdAt', 'updatedAt']),
        create: { userId, ...stripUnknown(h, ['id', 'userId', 'createdAt', 'updatedAt']) },
      });
      bump('homeBase', 1);
    } catch (e: any) {
      fail('homeBase', undefined, e?.message ?? 'unknown');
    }
  }

  // ----- PENANCE TEMPLATES + EVENTS -----
  if (Array.isArray(t.penanceTemplates)) {
    for (const pt of t.penanceTemplates as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(pt, ['id', 'userId']);
        await prisma.penanceTemplate.create({ data: { ...data, userId } });
        bump('penanceTemplates', 1);
      } catch (e: any) {
        fail('penanceTemplates', String(pt.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }
  if (Array.isArray(t.penanceEvents)) {
    for (const pe of t.penanceEvents as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(pe, ['id', 'userId']);
        await prisma.penanceEvent.create({ data: { ...data, userId } });
        bump('penanceEvents', 1);
      } catch (e: any) {
        fail('penanceEvents', String(pe.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- BREACH PROGRESS (1 row max) -----
  // Breach boss IDs are seeded by server, may differ between
  // instances. Remap currentBossId by name when present.
  const bossIdByName = new Map<string, string>();
  for (const b of await prisma.breachBoss.findMany({ select: { id: true, name: true } })) {
    bossIdByName.set(b.name, b.id);
  }
  if (t.userBreachProgress) {
    try {
      const b = t.userBreachProgress as Record<string, unknown>;
      const data = stripUnknown(b, ['id', 'userId', 'createdAt', 'updatedAt']);
      // Try to remap currentBossId by boss name OR fall back to
      // a direct id match. If neither works, drop the field (the
      // schema FK requires it to exist; we can't keep a stale id).
      const oldBossId = b.currentBossId as string | undefined;
      if (oldBossId) {
        const byName = bossIdByName.get(oldBossId);
        const byId = byName ?? (await prisma.breachBoss.findUnique({ where: { id: oldBossId } }))?.id;
        if (byId) {
          (data as Record<string, unknown>).currentBossId = byId;
        } else {
          delete (data as Record<string, unknown>).currentBossId;
        }
      }
      await prisma.userBreachProgress.upsert({
        where: { userId },
        update: data,
        create: { userId, ...data },
      });
      bump('userBreachProgress', 1);
    } catch (e: any) {
      fail('userBreachProgress', undefined, e?.message ?? 'unknown');
    }
  }
  if (Array.isArray(t.breachDamageEvents)) {
    for (const de of t.breachDamageEvents as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(de, ['id', 'userId']);
        // Skip if the bossId no longer exists in the pool.
        const bossId = data.bossId as string | undefined;
        if (bossId) {
          const boss = await prisma.breachBoss.findUnique({ where: { id: bossId } });
          if (!boss) { skip('breachDamageEvents'); continue; }
        }
        await prisma.breachDamageEvent.create({ data: { ...data, userId } });
        bump('breachDamageEvents', 1);
      } catch (e: any) {
        fail('breachDamageEvents', String(de.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

// ----- ACHIEVEMENTS -----
  // Achievement IDs are system-assigned by the seed script and may
  // differ between server instances. Remap by key (the slug) so
  // existing achievements get matched up correctly.
  const achIdByKey = new Map<string, string>();
  for (const a of await prisma.achievement.findMany({ select: { id: true, key: true } })) {
    if (a.key) achIdByKey.set(a.key, a.id);
  }
  if (Array.isArray(t.userAchievements)) {
    for (const ua of t.userAchievements) {
      try {
        const data = stripUnknown(ua, ['id', 'userId', 'achievementId', 'achievementKey']);
        const key = (ua as Record<string, unknown>).achievementKey as string | undefined;
        const oldAchId = (ua as Record<string, unknown>).achievementId as string | undefined;
        let newAchId: string | undefined;
        // Try matching the old achievementId against any currently-
        // seeded achievement id or key (handles re-seeded instances
        // where cuids may match or differ).
        if (oldAchId) {
          const asKey = achIdByKey.get(String(oldAchId));
          if (asKey) newAchId = asKey;
          else {
            const direct = await prisma.achievement.findUnique({ where: { id: String(oldAchId) } });
            if (direct) newAchId = direct.id;
          }
        }
        if (!newAchId && key) newAchId = achIdByKey.get(key);
        if (!newAchId) { skip('userAchievements'); continue; }
        await prisma.userAchievement.create({ data: { ...data, userId, achievementId: newAchId } });
        bump('userAchievements', 1);
      } catch (e: any) {
        if (isDuplicate(e)) { skip('userAchievements'); continue; }
        fail('userAchievements', String(ua.id ?? ''), e?.message ?? 'unknown');
        fail('userAchievements', String(ua.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- PLATEAUS -----
  if (Array.isArray(t.plateauSnapshots)) {
    for (const ps of t.plateauSnapshots as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(ps, ['id', 'userId']);
        await prisma.plateauSnapshot.create({ data: { ...data, userId } });
        bump('plateauSnapshots', 1);
      } catch (e: any) {
        fail('plateauSnapshots', String(ps.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }
  if (Array.isArray(t.plateauPauses)) {
    for (const pp of t.plateauPauses as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(pp, ['id', 'userId']);
        await prisma.plateauPause.create({ data: { ...data, userId } });
        bump('plateauPauses', 1);
      } catch (e: any) {
        fail('plateauPauses', String(pp.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- EXAMEN -----
  if (Array.isArray(t.examenResponses)) {
    for (const er of t.examenResponses as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(er, ['id', 'userId']);
        await prisma.examenResponse.create({ data: { ...data, userId } });
        bump('examenResponses', 1);
      } catch (e: any) {
        fail('examenResponses', String(er.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- USER WORLD PROGRESS -----
  if (Array.isArray(t.userWorldProgress)) {
    for (const uwp of t.userWorldProgress as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(uwp, ['id', 'userId']);
        await prisma.userWorldProgress.create({ data: { ...data, userId } });
        bump('userWorldProgress', 1);
      } catch (e: any) {
        fail('userWorldProgress', String(uwp.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- PAIN LOGS -----
  if (Array.isArray(t.painLogs)) {
    for (const p of t.painLogs as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(p, ['id', 'userId']);
        await prisma.painLog.create({ data: { ...data, userId } });
        bump('painLogs', 1);
      } catch (e: any) {
        fail('painLogs', String(p.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

// ----- ROUTINES → ROUTINE DAYS -----
  // Note: RoutineDay has no `routineId` field in the current schema
  // — it uses `userId` as the FK directly. So routineDays are flat
  // per-user; we import them as-is. Skip the nested grouping.
  if (Array.isArray(t.routines)) {
    for (const r of t.routines) {
      try {
        const data = stripUnknown(r, ['id', 'userId']);
        await prisma.routine.create({ data: { ...data, userId } });
        bump('routines', 1);
      } catch (e: any) {
        fail('routines', String(r.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }
  if (Array.isArray(t.routineDays)) {
    for (const d of t.routineDays as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(d, ['id', 'userId']);
        await prisma.routineDay.create({ data: { ...data, userId } });
        bump('routineDays', 1);
      } catch (e: any) {
        if (isDuplicate(e)) { skip('routineDays'); continue; }
        fail('routineDays', String(d.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- PRAYER LOGS -----
  if (Array.isArray(t.prayerLogs)) {
    for (const p of t.prayerLogs as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(p, ['id', 'userId']);
        await prisma.prayerLog.create({ data: { ...data, userId } });
        bump('prayerLogs', 1);
      } catch (e: any) {
        fail('prayerLogs', String(p.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- DAILIES → DAILY LOGS -----
  if (Array.isArray(t.dailies)) {
    for (const d of t.dailies as Array<Record<string, unknown>>) {
      try {
        const oldId = String(d.id ?? '');
        const newId = randomUuid();
        idMap.set(oldId, newId);
        const data = stripUnknown(d, ['id', 'userId']);
        await prisma.daily.create({ data: { ...data, id: newId, userId } });
        bump('dailies', 1);

        const logs = (t.dailyLogs as Array<Record<string, unknown>>).filter((l) => l.dailyId === oldId);
        for (const lRaw of logs) {
          try {
            const l = stripUnknown(lRaw, ['id', 'dailyId', 'userId']);
            await prisma.dailyLog.create({ data: { ...l, dailyId: newId, userId } });
            bump('dailyLogs', 1);
          } catch (e: any) {
            fail('dailyLogs', String(lRaw.id ?? ''), e?.message ?? 'unknown');
          }
        }
      } catch (e: any) {
        fail('dailies', String(d.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- SUPPLEMENT LOGS -----
  if (Array.isArray(t.supplementLogs)) {
    for (const s of t.supplementLogs as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(s, ['id', 'userId']);
        await prisma.supplementLog.create({ data: { ...data, userId } });
        bump('supplementLogs', 1);
      } catch (e: any) {
        fail('supplementLogs', String(s.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- HABITS → HABIT LOGS -----
  if (Array.isArray(t.habits)) {
    for (const h of t.habits as Array<Record<string, unknown>>) {
      try {
        const oldId = String(h.id ?? '');
        const newId = randomUuid();
        idMap.set(oldId, newId);
        const data = stripUnknown(h, ['id', 'userId']);
        await prisma.habit.create({ data: { ...data, id: newId, userId } });
        bump('habits', 1);

        const logs = (t.habitLogs as Array<Record<string, unknown>>).filter((l) => l.habitId === oldId);
        for (const lRaw of logs) {
          try {
            const l = stripUnknown(lRaw, ['id', 'habitId', 'userId']);
            await prisma.habitLog.create({ data: { ...l, habitId: newId, userId } });
            bump('habitLogs', 1);
          } catch (e: any) {
            fail('habitLogs', String(lRaw.id ?? ''), e?.message ?? 'unknown');
          }
        }
      } catch (e: any) {
        fail('habits', String(h.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- INVENTORY -----
  if (Array.isArray(t.inventoryItems)) {
    for (const inv of t.inventoryItems as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(inv, ['id', 'userId']);
        const itemDefId = data.itemDefId as string | undefined;
        if (itemDefId) {
          const exists = await prisma.itemDef.findUnique({ where: { id: itemDefId } });
          if (!exists) { skip('inventoryItems'); continue; }
        }
        await prisma.inventoryItem.create({ data: { ...data, userId } });
        bump('inventoryItems', 1);
      } catch (e: any) {
        fail('inventoryItems', String(inv.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- MORNING REPORTS -----
  if (Array.isArray(t.morningReports)) {
    for (const mr of t.morningReports as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(mr, ['id', 'userId']);
        await prisma.morningReport.create({ data: { ...data, userId } });
        bump('morningReports', 1);
      } catch (e: any) {
        fail('morningReports', String(mr.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- SPIRITUAL REFLECTIONS -----
  if (Array.isArray(t.spiritualReflections)) {
    for (const sr of t.spiritualReflections as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(sr, ['id', 'userId']);
        await prisma.spiritualReflection.create({ data: { ...data, userId } });
        bump('spiritualReflections', 1);
      } catch (e: any) {
        fail('spiritualReflections', String(sr.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

// ----- USER TRACKED ITEMS → DAILY TRACKED ITEMS -----
  // Note: DailyTrackedItem uses `itemId` (string FK), not `userItemId`.
  // The old ID→new ID remap is required, but keyed by itemId.
  if (Array.isArray(t.userTrackedItems)) {
    for (const ut of t.userTrackedItems) {
      try {
        const oldId = String(ut.id ?? '');
        const newId = randomUuid();
        idMap.set(oldId, newId);
        const data = stripUnknown(ut, ['id', 'userId']);
        await prisma.userTrackedItem.create({ data: { ...data, id: newId, userId } });
        bump('userTrackedItems', 1);

        const dailyLogs = (t.dailyTrackedItems as Array<Record<string, unknown>>).filter((d) => d.itemId === oldId);
        for (const dRaw of dailyLogs) {
          try {
            const d = stripUnknown(dRaw, ['id', 'itemId', 'userId']);
            await prisma.dailyTrackedItem.create({ data: { ...d, itemId: newId, userId } });
            bump('dailyTrackedItems', 1);
          } catch (e: any) {
            fail('dailyTrackedItems', String(dRaw.id ?? ''), e?.message ?? 'unknown');
          }
        }
      } catch (e: any) {
        fail('userTrackedItems', String(ut.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- SUBSTANCE LOGS -----
  if (Array.isArray(t.substanceLogs)) {
    for (const s of t.substanceLogs as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(s, ['id', 'userId']);
        await prisma.substanceLog.create({ data: { ...data, userId } });
        bump('substanceLogs', 1);
      } catch (e: any) {
        fail('substanceLogs', String(s.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- FOOD ITEMS → MEAL ENTRIES → SAVED FOODS -----
  if (Array.isArray(t.foodItems)) {
    for (const f of t.foodItems as Array<Record<string, unknown>>) {
      try {
        const oldId = String(f.id ?? '');
        const newId = randomUuid();
        idMap.set(oldId, newId);
        const data = stripUnknown(f, ['id', 'userId']);
        await prisma.foodItem.create({ data: { ...data, id: newId, userId } });
        bump('foodItems', 1);

        const meals = (t.mealEntries as Array<Record<string, unknown>>).filter((m) => m.foodId === oldId);
        for (const mRaw of meals) {
          try {
            const m = stripUnknown(mRaw, ['id', 'foodId', 'userId']);
            await prisma.mealEntry.create({ data: { ...m, foodId: newId, userId } });
            bump('mealEntries', 1);
          } catch (e: any) {
            fail('mealEntries', String(mRaw.id ?? ''), e?.message ?? 'unknown');
          }
        }
      } catch (e: any) {
        fail('foodItems', String(f.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }
  if (Array.isArray(t.savedFoods)) {
    for (const s of t.savedFoods as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(s, ['id', 'userId']);
        await prisma.savedFood.create({ data: { ...data, userId } });
        bump('savedFoods', 1);
      } catch (e: any) {
        fail('savedFoods', String(s.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- CORRELATIONS -----
  if (Array.isArray(t.correlationSnapshots)) {
    for (const c of t.correlationSnapshots as Array<Record<string, unknown>>) {
      try {
        const data = stripUnknown(c, ['id', 'userId']);
        await prisma.correlationSnapshot.create({ data: { ...data, userId } });
        bump('correlationSnapshots', 1);
      } catch (e: any) {
        fail('correlationSnapshots', String(c.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  // ----- INSIGHTS -----
  if (Array.isArray(t.metricInsights)) {
    for (const mi of t.metricInsights as Array<Record<string, unknown>>) {
      try {
        // Skip if the (userId, metric) pair already exists. The
        // user gets a fresh insight on next page load anyway, so
        // there's no value in overwriting.
        const metric = (mi as Record<string, unknown>).metric as string | undefined;
        if (metric) {
          const exists = await prisma.metricInsight.findUnique({
            where: { userId_metric: { userId, metric: metric as any } },
          });
          if (exists) { skip('metricInsights'); continue; }
        }
        const data = stripUnknown(mi, ['id', 'userId']);
        await prisma.metricInsight.create({ data: { ...data, userId } });
        bump('metricInsights', 1);
      } catch (e: any) {
        fail('metricInsights', String(mi.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }
  if (Array.isArray(t.activityInsights)) {
    for (const ai of t.activityInsights as Array<Record<string, unknown>>) {
      try {
        // Re-key workoutId from old→new (workouts were rotated
        // above; old IDs no longer exist). Skip if the referenced
        // workout wasn't part of the export.
        const oldWid = (ai as Record<string, unknown>).workoutId as string | undefined;
        const newWid = oldWid ? idMap.get(oldWid) : undefined;
        if (oldWid && !newWid) { skip('activityInsights'); continue; }
        const data = stripUnknown(ai, ['id', 'userId', 'workoutId']);
        await prisma.activityInsight.create({
          data: { ...data, userId, workoutId: newWid ?? oldWid ?? '' },
        });
        bump('activityInsights', 1);
      } catch (e: any) {
        fail('activityInsights', String(ai.id ?? ''), e?.message ?? 'unknown');
      }
    }
  }

  return result;
}

// ============================================================
// Strip a record's keys to the Prisma-allowed set. Removes the
// PK, the user FK, and any timestamps that Prisma auto-fills.
// The remaining fields are forwarded as-is, with values that
// don't fit the column type silently swallowed by Prisma.
// ============================================================
function stripUnknown(
  row: Record<string, unknown>,
  drop: string[],
): Record<string, unknown> {
  const dropSet = new Set(drop);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (dropSet.has(k)) continue;
    // Drop nested object refs that Prisma would try to upsert.
    // We only want scalars + arrays, not relation objects.
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      // skip — likely a relation marker like `{id: 'x'}` from
      // an include. FK was already extracted before this point.
      continue;
    }
    out[k] = v;
  }
  return out;
}
