-- Measurement dedup: prevent the same (userId, metric, recordedAt)
-- triple from being written twice. The FIT import path used to create
-- duplicates on every re-import because the persist() helper did a
-- plain create() with no uniqueness check — running the same .fit
-- backup twice would pile up duplicate rows for every sleep / HRV /
-- weight entry. Now upsert() can target this constraint.
--
-- NOTE: this migration can FAIL on databases that already have
-- duplicates (the unique index can't be built if non-unique rows
-- exist). Run a cleanup pass first if you see "key (userId, metric,
-- recordedAt) is duplicated" errors. The dedup query is:
--
--   DELETE FROM "Measurement" m
--   USING "Measurement" dup
--   WHERE m.ctid > dup.ctid
--     AND m."userId" = dup."userId"
--     AND m.metric   = dup.metric
--     AND m."recordedAt" = dup."recordedAt";
--
-- (Kept the earliest copy, drops the rest.)

CREATE UNIQUE INDEX "Measurement_userId_metric_recordedAt_key"
  ON "Measurement"("userId", "metric", "recordedAt");