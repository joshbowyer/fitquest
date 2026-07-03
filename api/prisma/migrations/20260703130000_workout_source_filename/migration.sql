-- Persist the source filename on Workout rows. The FitQuestBridge
-- APK sends `filename` in the /import/batch payload; the server
-- used to drop it on the floor (only the sport was persisted as
-- the workout name). Needed for the /import page's "bridge
-- uploads history" panel to show the user which specific .fit
-- file made it.
--
-- Nullable so existing web-import rows don't break. All future
-- bridge uploads will set this.
ALTER TABLE "Workout" ADD COLUMN "sourceFilename" TEXT;

-- Index for the "find all bridge uploads of this filename" query
-- the /import/bridge-history endpoint uses for grouping.
CREATE INDEX "Workout_userId_importSource_sourceFilename_idx"
  ON "Workout" ("userId", "importSource", "sourceFilename");
