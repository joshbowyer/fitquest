-- Measurement unique constraint was declared in the schema
-- (api/prisma/schema.prisma: `@@unique([userId, metric, recordedAt])`)
-- but never actually created in the live database. The plain
-- index `Measurement_userId_metric_recordedAt_idx` exists but
-- isn't a UNIQUE constraint, so prisma.measurement.upsert fails
-- with "no unique or exclusion constraint matching the ON
-- CONFLICT specification" (Postgres 42P10). The import route
-- assumes the unique constraint for idempotent re-imports of
-- the same FIT file.
--
-- Postgres won't let you ADD CONSTRAINT ... USING INDEX on a
-- non-unique index, so we drop the old plain index and create a
-- unique one with the same name (Prisma's @@unique directive
-- will produce exactly this when generated fresh).
--
-- No duplicates exist in the table (verified pre-migration),
-- so the swap is safe.

DROP INDEX IF EXISTS "Measurement_userId_metric_recordedAt_idx";
CREATE UNIQUE INDEX "Measurement_userId_metric_recordedAt_idx"
    ON "Measurement" ("userId", metric, "recordedAt");