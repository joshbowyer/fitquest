-- Add unique constraint on Workout(userId, performedAt).
--
-- Earlier, this was only a non-unique index. Now that the
-- FitQuestBridge re-uploads files (or after a restart with
-- the persisted dedup set), we want re-uploads of the same
-- workout to be idempotent. The persist function in routes/
-- workouts.ts now uses prisma.workout.upsert with this
-- composite key.
--
-- Drop the old non-unique index first (it's superseded by
-- the unique constraint -- unique constraints implicitly
-- back the same lookup).
DROP INDEX IF EXISTS "Workout_userId_performedAt_idx";

-- Idempotent: skip the unique-constraint creation if it
-- already exists (the recover-prod-workout-dedup.sh script
-- creates the same unique index via raw SQL; this migration
-- also adds the formal unique constraint for new installs).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Workout_userId_performedAt_key'
  ) THEN
    ALTER TABLE "Workout"
      ADD CONSTRAINT "Workout_userId_performedAt_key"
      UNIQUE ("userId", "performedAt");
  END IF;
END $$;
