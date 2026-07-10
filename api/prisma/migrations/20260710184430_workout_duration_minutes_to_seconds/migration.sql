-- Rename first so any straggler code using the old column name fails
-- loudly instead of reading mis-scaled values.
ALTER TABLE "Workout" RENAME COLUMN "duration" TO "durationSec";
-- Backfill: old rows stored whole minutes; x60 is the only recoverable
-- value (sub-minute precision for old rows is already gone - expected).
UPDATE "Workout" SET "durationSec" = "durationSec" * 60 WHERE "durationSec" IS NOT NULL;