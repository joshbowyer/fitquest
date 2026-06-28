-- Add `cycle` to WorldBoss + UserWorldProgress.
-- The Breach world resets when the user kills The Maw, so we need
-- a way to track per-cycle progress (the boss + level completions
-- for that cycle) and to surface the cycle number in the UI.
--
-- For other worlds, cycle stays at 1 (default) and the existing
-- (userId, levelId) uniqueness still holds because cycle defaults
-- to 1. We drop and recreate the UserWorldProgress unique
-- constraint to include cycle.

ALTER TABLE "WorldBoss"
  ADD COLUMN "cycle" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "UserWorldProgress"
  ADD COLUMN "cycle" INTEGER NOT NULL DEFAULT 1;

-- Drop the old unique constraint that didn't account for cycle.
ALTER TABLE "UserWorldProgress" DROP CONSTRAINT IF EXISTS "UserWorldProgress_userId_levelId_key";

-- Add the new composite unique constraint (userId, levelId, cycle).
ALTER TABLE "UserWorldProgress"
  ADD CONSTRAINT "UserWorldProgress_userId_levelId_cycle_key"
  UNIQUE ("userId", "levelId", "cycle");
