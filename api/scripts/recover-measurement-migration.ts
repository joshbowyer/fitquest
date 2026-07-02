// Recovery script for the prod measurement_unique migration failure.
//
// What happened:
//   20260701090000_measurement_unique_user_metric_date tried to
//   CREATE UNIQUE INDEX on (userId, metric, recordedAt). It failed
//   because some users have duplicate Measurement rows from
//   re-importing the same FIT backup multiple times. Prisma marked
//   the migration as failed and is now blocking all 3 subsequent
//   migrations (username_lower, body_measurements, skill_branch,
//   dead_hang_metric).
//
// What this script does:
//   1. Inventory duplicates — show how many (user, metric, recordedAt)
//      triples collide, how many rows total would be deleted.
//   2. Delete duplicates — keep the earliest copy by ctid.
//   3. Mark the failed migration as rolled-back.
//   4. Re-run `prisma migrate deploy` (the migration will succeed now
//      that the duplicates are gone).
//
// Usage:
//   cd api
//   PROD_DATABASE_URL=postgresql://... npx tsx scripts/recover-measurement-migration.ts
//
// Or with the regular DATABASE_URL pointing at prod:
//   DATABASE_URL=postgresql://... npx tsx scripts/recover-measurement-migration.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// 1. Inventory: count duplicate (userId, metric, recordedAt) triples
// ---------------------------------------------------------------------------
const dups = await prisma.$queryRawUnsafe<Array<{
  userId: string;
  metric: string;
  recordedAt: Date;
  dup_count: bigint;
  would_delete: bigint;
}>>(`
  SELECT
    "userId",
    metric,
    "recordedAt",
    COUNT(*)::bigint AS dup_count,
    (COUNT(*) - 1)::bigint AS would_delete
  FROM "Measurement"
  GROUP BY "userId", metric, "recordedAt"
  HAVING COUNT(*) > 1
  ORDER BY dup_count DESC
  LIMIT 50
`);
console.log(`Found ${dups.length} duplicate (userId, metric, recordedAt) triples (showing top 50):`);
let totalWillDelete = 0n;
for (const d of dups) {
  totalWillDelete += d.would_delete;
  console.log(
    `  userId=${d.userId.slice(0, 12)}.. metric=${d.metric.padEnd(20)} ` +
    `recordedAt=${d.recordedAt.toISOString()}  count=${d.dup_count}  would_delete=${d.would_delete}`,
  );
}
const totalDupsAll = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(`
  SELECT COALESCE(SUM(c-1), 0)::bigint AS total FROM (
    SELECT COUNT(*) c FROM "Measurement"
    GROUP BY "userId", metric, "recordedAt"
    HAVING COUNT(*) > 1
  ) s
`);
console.log(`Total rows that would be deleted: ${totalDupsAll[0]?.total ?? 0n}`);

// ---------------------------------------------------------------------------
// 2. Delete duplicates (keep the earliest copy by ctid)
//    Same query shape as the migration doc but parameterized so we
//    don't accidentally delete across users.
// ---------------------------------------------------------------------------
console.log('\nDeleting duplicates...');
const delResult = await prisma.$executeRawUnsafe(`
  DELETE FROM "Measurement" m
  USING "Measurement" dup
  WHERE m.ctid > dup.ctid
    AND m."userId"  = dup."userId"
    AND m.metric    = dup.metric
    AND m."recordedAt" = dup."recordedAt"
`);
console.log(`Deleted ${delResult} duplicate Measurement rows.`);

// ---------------------------------------------------------------------------
// 3. Mark the failed migration as rolled-back
// ---------------------------------------------------------------------------
const failedName = '20260701090000_measurement_unique_user_metric_date';
const r = await prisma.$executeRawUnsafe(
  `UPDATE "_prisma_migrations"
   SET "finished_at" = NULL,
       "rolled_back_at" = NOW()
   WHERE migration_name = $1
     AND finished_at IS NULL
     AND rolled_back_at IS NULL`,
  failedName,
);
console.log(`Marked ${failedName} as rolled-back (rows updated: ${r}).`);

// ---------------------------------------------------------------------------
// Done — re-run `npx prisma migrate deploy` from the api dir.
// ---------------------------------------------------------------------------
console.log('\nNEXT: run `npx prisma migrate deploy` from the api dir.');
console.log('       then restart the api so it picks up the new schema.');

await prisma.$disconnect();