-- Add sourceFilename to Measurement + DailyLog. The bridge
-- panel needs to surface sleep/HRV/monitor bridge uploads,
-- not just workouts. Workout already has it (migration
-- 20260703130000_workout_source_filename).
--
-- Nullable so existing rows + in-app manual logs don't break.
-- Backfill optional — leaving NULL is fine, the bridge panel
-- groups by filename and NULL groups as '(unknown)'.

ALTER TABLE "Measurement" ADD COLUMN "sourceFilename" TEXT;
ALTER TABLE "DailyLog"   ADD COLUMN "sourceFilename" TEXT;

-- Indexes for the bridge-history endpoint's per-filename
-- grouping query.
CREATE INDEX "Measurement_userId_sourceFilename_idx"
  ON "Measurement" ("userId", "sourceFilename");
CREATE INDEX "DailyLog_userId_sourceFilename_idx"
  ON "DailyLog" ("userId", "sourceFilename");
