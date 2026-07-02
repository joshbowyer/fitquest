-- Workout.importSource — track which surface ingested each
-- workout. Lets the /import page distinguish bridge uploads
-- (FitQuestBridge APK auto-uploading new Gadgetbridge FITs) from
-- web drags (user dropping files into the import dropzone).
--
-- We CREATE TYPE here rather than ALTER TYPE ADD VALUE because
-- the enum doesn't exist yet in the DB. Postgres won't let you
-- ADD VALUE to a non-existent type; the enum has to be created
-- first. After this migration runs, Prisma reconciles the
-- enum definition in schema.prisma to match this one.

CREATE TYPE "WorkoutSource" AS ENUM ('WEB', 'BRIDGE', 'BULK_REPROCESS');

-- Add the column with a NOT NULL DEFAULT so every existing
-- row backfills to WEB without a follow-up UPDATE pass.
ALTER TABLE "Workout" ADD COLUMN "importSource" "WorkoutSource" NOT NULL DEFAULT 'WEB';

-- Compound index supports the /import/bridge-summary query
-- (WHERE userId = ? AND importSource = 'BRIDGE' ORDER BY
-- performedAt DESC). Without it, the summary endpoint would
-- full-scan a user's workout history per request.
CREATE INDEX "Workout_userId_importSource_performedAt_idx"
  ON "Workout" ("userId", "importSource", "performedAt" DESC);