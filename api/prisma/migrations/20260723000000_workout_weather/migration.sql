-- Per-activity historical weather snapshot. The application resolves the
-- first valid workout GPS point, then falls back to User latitude/longitude.
-- Null means no location was available or the upstream fetch failed.
-- `locationSource` records whether the persisted coordinates came from
-- `gps` or the approximate `user` Profile location.

ALTER TABLE "Workout" ADD COLUMN "weather" JSONB;
