-- Add trackJson column to Workout for FIT trackpoint streams.
ALTER TABLE "Workout" ADD COLUMN "trackJson" JSONB NOT NULL DEFAULT '[]';