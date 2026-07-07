// ============================================================
// User data export — JSON + CSV serialization
// ============================================================
//
// Per-user data dump for backup + portability. Two formats:
//
//   JSON: full nested object with version + schema marker.
//         Round-trip safe (import accepts the same shape).
//
//   CSV:  one CSV string per table, packaged as a ZIP.
//
// Tables are split into two groups:
//
//   PER_USER: tables with a `userId` foreign key. Always scoped
//             to the requesting user.
//
//   USER_PROFILE: the User row itself, with credentials + auth
//             fields stripped (passwordHash, twoFactorSecret,
//             recoveryCodes, trusted devices, sessions).
//
// Tables that are system-shared (ItemDef, Skill, BreachBoss,
// Achievement, etc.) are NOT exported — they're already on
// every FitQuest install and round-tripping them would risk
// drift. The import side regenerates FK refs by name where
// it can, and skips otherwise.

import { prisma } from './prisma.js';
import { createHash } from 'node:crypto';

export const EXPORT_VERSION = 1;

// Schema marker. Bumped when the export shape changes in a way
// that breaks compatibility with the current importer. The
// import side refuses anything older (and logs a warning for
// anything newer).
export const EXPORT_SCHEMA = 'fitquest.user-export.v1';

export type ExportPayload = {
  schema: string;
  version: number;
  exportedAt: string;
  userId: string;
  user: Record<string, unknown>;
  // Per-table arrays. Order matters: parent rows first so the
  // importer can wire FKs in one pass.
  tables: {
    workouts: unknown[];
    exercises: unknown[];
    sets: unknown[];
    measurements: unknown[];
    geneticMax: unknown[];
    prs: unknown[];
    avatar: unknown | null;
    userSkills: unknown[];
    homeBase: unknown | null;
    penanceTemplates: unknown[];
    penanceEvents: unknown[];
    userBreachProgress: unknown | null;
    breachDamageEvents: unknown[];
    userAchievements: unknown[];
    plateauSnapshots: unknown[];
    plateauPauses: unknown[];
    examenResponses: unknown[];
    userWorldProgress: unknown[];
    painLogs: unknown[];
    routines: unknown[];
    routineDays: unknown[];
    workoutTemplates: unknown[];
    workoutTemplateExercises: unknown[];
    workoutTemplateSets: unknown[];
    prayerLogs: unknown[];
    dailies: unknown[];
    dailyLogs: unknown[];
    supplementLogs: unknown[];
    habits: unknown[];
    habitLogs: unknown[];
    inventoryItems: unknown[];
    morningReports: unknown[];
    spiritualReflections: unknown[];
    userTrackedItems: unknown[];
    dailyTrackedItems: unknown[];
    substanceLogs: unknown[];
    // FoodItem is a shared catalog (no userId), but the export
    // carries the SUBSET of catalog rows referenced by this user's
    // meal entries so a restore onto a fresh instance is
    // self-contained. mealEntries is the user's actual meal log —
    // it was previously missing entirely, so a backup→restore
    // round trip silently lost the whole food diary (while the
    // exportInfo preview still advertised the meal count).
    foodItems: unknown[];
    mealEntries: unknown[];
    savedFoods: unknown[];
    correlationSnapshots: unknown[];
    metricInsights: unknown[];
    activityInsights: unknown[];
  };
  counts: Record<string, number>;
};

// ============================================================
// Sensitive-field allowlist for the User row.
// Everything else is dropped on export so we never serialize
// password hashes, TOTP secrets, or recovery codes.
// ============================================================

const SAFE_USER_FIELDS = [
  'id',
  'username',
  'displayName',
  'level',
  'xp',
  'gold',
  'soulstones',
  'class',
  'classChangedAt',
  'mode',
  'hearts',
  'heartsLastRegenAt',
  'heightCm',
  'weightKg',
  'bodyFatPct',
  'wristCm',
  'ankleCm',
  'neckCm',
  'shoulderCm',
  'bicepCm',
  'chestCm',
  'waistCm',
  'hipCm',
  'thighCm',
  'calfCm',
  'forearmCm',
  'goal',
  'calorieBaseline',
  'calorieSource',
  'unitSystem',
  'isAdmin',
  'sex',
  'birthYear',
  'morningReportEnabled',
  'lastDamageDayKey',
  'createdAt',
  'updatedAt',
  // Intentionally NOT exported:
  //   passwordHash, twoFactorSecret, twoFactorEnabled, recoveryCodes,
  //   trusted devices, sessions, etc.
] as const;

// ============================================================
// Serialize User row with sensitive fields stripped.
// ============================================================
function safeUser<T extends Record<string, unknown>>(user: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SAFE_USER_FIELDS) {
    if (key in user) out[key] = user[key];
  }
  return out;
}

// ============================================================
// Build the full export payload for a user. Pulls everything
// in one userId-scoped pass. For users with massive data
// (10k+ workouts) this could be optimized with streaming;
// today it's a single in-memory snapshot.
// ============================================================
export async function buildExport(
  userId: string,
  options?: { tables?: string[] | null },
): Promise<ExportPayload> {
  const [
    user,
    workouts,
    exercises,
    sets,
    measurements,
    geneticMax,
    prs,
    avatar,
    userSkills,
    homeBase,
    penanceTemplates,
    penanceEvents,
    userBreachProgress,
    breachDamageEvents,
    userAchievements,
    plateauSnapshots,
    plateauPauses,
    examenResponses,
    userWorldProgress,
    painLogs,
    routines,
    routineDays,
    workoutTemplates,
    workoutTemplateExercises,
    workoutTemplateSets,
    prayerLogs,
    dailies,
    dailyLogs,
    supplementLogs,
    habits,
    habitLogs,
    inventoryItems,
    morningReports,
    spiritualReflections,
    userTrackedItems,
    dailyTrackedItems,
    substanceLogs,
    foodItems,
    mealEntries,
    savedFoods,
    correlationSnapshots,
    metricInsights,
    activityInsights,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.workout.findMany({ where: { userId }, orderBy: { performedAt: 'asc' } }),
    prisma.exercise.findMany({ where: { workout: { userId } }, orderBy: { order: 'asc' } }),
    prisma.set.findMany({ where: { exercise: { workout: { userId } } }, orderBy: { order: 'asc' } }),
    prisma.measurement.findMany({ where: { userId }, orderBy: { recordedAt: 'asc' } }),
    prisma.geneticMax.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.pr.findMany({ where: { userId }, orderBy: { achievedAt: 'asc' } }),
    prisma.avatar.findUnique({ where: { userId } }),
    prisma.userSkill.findMany({ where: { userId } }),
    prisma.homeBase.findUnique({ where: { userId } }),
    prisma.penanceTemplate.findMany({ where: { userId } }),
    prisma.penanceEvent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.userBreachProgress.findUnique({ where: { userId } }),
    prisma.breachDamageEvent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.userAchievement.findMany({ where: { userId } }),
    prisma.plateauSnapshot.findMany({ where: { userId }, orderBy: { weekStart: 'asc' } }),
    prisma.plateauPause.findMany({ where: { userId } }),
    prisma.examenResponse.findMany({ where: { userId }, orderBy: { weekStart: 'asc' } }),
    prisma.userWorldProgress.findMany({ where: { userId } }),
    prisma.painLog.findMany({ where: { userId }, orderBy: { loggedAt: 'asc' } }),
    prisma.routine.findMany({ where: { userId } }),
    prisma.routineDay.findMany({ where: { userId }, orderBy: { day: 'asc' } }),
    // Workout templates — fetched as three flat lists (matching the
    // pattern used for Workout/Exercise/Set). The import.ts module
    // rebuilds the parent/child tree from these via FK remapping.
    prisma.workoutTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.workoutTemplateExercise.findMany({
      where: { template: { userId } },
      orderBy: { order: 'asc' },
    }),
    prisma.workoutTemplateSet.findMany({
      where: { exercise: { template: { userId } } },
      orderBy: { order: 'asc' },
    }),
    prisma.prayerLog.findMany({ where: { userId }, orderBy: { loggedAt: 'asc' } }),
    prisma.daily.findMany({ where: { userId } }),
    prisma.dailyLog.findMany({ where: { userId }, orderBy: { loggedAt: 'asc' } }),
    prisma.supplementLog.findMany({ where: { userId }, orderBy: { takenAt: 'asc' } }),
    prisma.habit.findMany({ where: { userId } }),
    prisma.habitLog.findMany({ where: { userId }, orderBy: { loggedAt: 'asc' } }),
    prisma.inventoryItem.findMany({ where: { userId }, orderBy: { acquiredAt: 'asc' } }),
    prisma.morningReport.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
    prisma.spiritualReflection.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.userTrackedItem.findMany({ where: { userId } }),
    prisma.dailyTrackedItem.findMany({ where: { userId } }),
    prisma.substanceLog.findMany({ where: { userId }, orderBy: { loggedAt: 'asc' } }),
    // FoodItem is a shared catalog (USDA/OFF cached entries), so we
    // export only the rows this user's meals reference — enough to
    // make the meal log restorable on a fresh instance without
    // dumping the whole shared cache.
    prisma.foodItem.findMany({ where: { mealEntries: { some: { userId } } } }),
    prisma.mealEntry.findMany({ where: { userId }, orderBy: { loggedAt: 'asc' } }),
    prisma.savedFood.findMany({ where: { userId } }),
    prisma.correlationSnapshot.findMany({ where: { userId }, orderBy: { snapshotDate: 'asc' } }),
    prisma.metricInsight.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
    prisma.activityInsight.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
  ]);

  if (!user) throw new Error('user_not_found');

  const tables = {
    workouts,
    exercises,
    sets,
    measurements,
    geneticMax,
    prs,
    avatar,
    userSkills,
    homeBase,
    penanceTemplates,
    penanceEvents,
    userBreachProgress,
    breachDamageEvents,
    userAchievements,
    plateauSnapshots,
    plateauPauses,
    examenResponses,
    userWorldProgress,
    painLogs,
    routines,
    routineDays,
    workoutTemplates,
    workoutTemplateExercises,
    workoutTemplateSets,
    prayerLogs,
    dailies,
    dailyLogs,
    supplementLogs,
    habits,
    habitLogs,
    inventoryItems,
    morningReports,
    spiritualReflections,
    userTrackedItems,
    dailyTrackedItems,
    substanceLogs,
    foodItems,
    mealEntries,
    savedFoods,
    correlationSnapshots,
    metricInsights,
    activityInsights,
  };

  // Counts for the `info` endpoint + a quick sanity check at
  // import time ("I expected N workouts but only got M").
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(tables)) {
    counts[k] = Array.isArray(v) ? v.length : v == null ? 0 : 1;
  }

  // Optional table filter — when the caller passes `tables: [...]`,
  // strip everything else from the payload. Useful for partial
  // exports (e.g. just the workout templates) without dragging along
  // years of measurements and workouts. If `tables` is omitted, the
  // full payload is returned (existing behavior, used by
  // Settings → Export / Import and the import round-trip).
  let filteredTables: typeof tables = tables;
  let filteredCounts = counts;
  if (options?.tables && options.tables.length > 0) {
    const allowed = new Set(options.tables);
    filteredTables = Object.fromEntries(
      Object.entries(tables).filter(([k]) => allowed.has(k)),
    ) as typeof tables;
    filteredCounts = Object.fromEntries(
      Object.entries(counts).filter(([k]) => allowed.has(k)),
    );
  }

  return {
    schema: EXPORT_SCHEMA,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    userId,
    user: safeUser(user as unknown as Record<string, unknown>),
    tables: filteredTables,
    counts: filteredCounts,
  };
}

// ============================================================
// Cheap summary for the "before you download" preview.
// ============================================================
export async function exportInfo(userId: string) {
  const [
    workouts,
    measurements,
    savedFoods,
    dailies,
    dailyLogs,
    substanceLogs,
    morningReports,
    inventoryItems,
    achievements,
    breachKills,
    painLogs,
    prayers,
    meals,
  ] = await Promise.all([
    prisma.workout.count({ where: { userId } }),
    prisma.measurement.count({ where: { userId } }),
    prisma.savedFood.count({ where: { userId } }),
    prisma.daily.count({ where: { userId } }),
    prisma.dailyLog.count({ where: { userId } }),
    prisma.substanceLog.count({ where: { userId } }),
    prisma.morningReport.count({ where: { userId } }),
    prisma.inventoryItem.count({ where: { userId } }),
    prisma.userAchievement.count({ where: { userId } }),
    prisma.userBreachProgress.findUnique({ where: { userId }, select: { kills: true } }),
    prisma.painLog.count({ where: { userId } }),
    prisma.prayerLog.count({ where: { userId } }),
    prisma.mealEntry.count({ where: { userId } }),
  ]);

  return {
    workouts,
    measurements,
    savedFoods,
    dailies,
    dailyLogs,
    substanceLogs,
    morningReports,
    inventoryItems,
    achievements,
    breachKills: breachKills?.kills ?? 0,
    painLogs,
    prayers,
    meals,
    schema: EXPORT_SCHEMA,
    version: EXPORT_VERSION,
  };
}

// ============================================================
// CSV serialization. Naive but correct — escapes commas,
// quotes, and newlines per RFC 4180. Splits by table so the
// ZIP has one .csv per logical table.
// ============================================================
export function toCsv(rows: unknown[]): string {
  if (rows.length === 0) return '';
  // Use the union of keys across all rows so missing fields
  // surface as empty cells rather than being skipped.
  const keys = new Set<string>();
  for (const r of rows) {
    if (r && typeof r === 'object') {
      for (const k of Object.keys(r as Record<string, unknown>)) keys.add(k);
    }
  }
  const header = Array.from(keys);
  const out: string[] = [header.map(csvEscape).join(',')];
  for (const row of rows) {
    const obj = (row ?? {}) as Record<string, unknown>;
    out.push(header.map((k) => csvEscape(obj[k])).join(','));
  }
  return out.join('\n');
}

function csvEscape(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return csvEscape(JSON.stringify(value));
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ============================================================
// ZIP serializer. Tiny STORE-only zip writer — no compression
// because the data is already JSON/CSV (text compresses poorly
// for short strings) and STORE has zero per-file overhead.
// Reference: PKWARE APPNOTE.TXT format.
//
// Returns a Buffer ready to send with Content-Type: application/zip.
// ============================================================
export function zipStore(files: { name: string; content: string | Buffer }[]): Buffer {
  const buffers: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const contentBuf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');
    const crc = crc32(contentBuf);

    // Local file header
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method = STORE
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(contentBuf.length, 18); // compressed size
    local.writeUInt32LE(contentBuf.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len

    buffers.push(local, nameBuf, contentBuf);

    // Central directory entry
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(contentBuf.length, 20);
    cd.writeUInt32LE(contentBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // local header offset

    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + contentBuf.length;
  }

  const centralStart = offset;
  const centralSize = central.reduce((s, b) => s + b.length, 0);

  // End of central directory record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...buffers, ...central, eocd]);
}

// CRC-32 for the ZIP store format. Polynomial 0xEDB88320 (reversed).
const CRC_TABLE: number[] = (() => {
  const t = new Array<number>(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ============================================================
// Deterministic checksum for the JSON export. Lets the importer
// detect duplicate imports (same checksum = already imported)
// without storing a separate manifest.
// ============================================================
export function exportChecksum(payload: ExportPayload): string {
  // Hash the canonical JSON form (sorted keys, no exportedAt
  // jitter) so re-exporting the same data always produces the
  // same digest.
  const { exportedAt: _drop, ...stable } = payload;
  const canonical = JSON.stringify(stable, Object.keys(stable).sort());
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}
