-- Persist per-workout validity flags so the morning report can
-- surface implausible sets from yesterday/today. Without this,
-- flags are computed on POST and returned to the client but lost
-- when the activity scrolls off the dashboard.
ALTER TABLE "Workout" ADD COLUMN "validityFlags" JSONB;
