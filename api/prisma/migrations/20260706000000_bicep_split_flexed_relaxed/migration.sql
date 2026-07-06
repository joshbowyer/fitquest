-- 20260706000000_bicep_split_flexed_relaxed
--
-- Splits BICEP into BICEP_FLEXED + BICEP_RELAXED. Convention is to
-- measure flexed, so existing Measurement + GeneticMax rows that used
-- the bare BICEP enum value get migrated to BICEP_FLEXED. Postgres
-- doesn't allow dropping enum values without recreating the type, so
-- BICEP stays in the enum as a legacy alias — no client emits it
-- after the corresponding web type-table change.
--
-- (BACKWARD COMPAT) The api-side zod validator on POST /measurements
-- accepts the enum natively, so any legacy client still sending
-- BICEP would land in Measurement with metric=BICEP and never get
-- migrated. Mitigation: the web client has been updated to send
-- BICEP_FLEXED/BICEP_RELAXED exclusively; the bridge APK's import
-- pipeline is BICEP-unaware.

-- Step 1: extend the enum with the two new variants.
ALTER TYPE "MetricType" ADD VALUE IF NOT EXISTS 'BICEP_FLEXED';
ALTER TYPE "MetricType" ADD VALUE IF NOT EXISTS 'BICEP_RELAXED';

-- Step 2: backfill existing rows. We migrate Measurement first
-- (the larger table) then GeneticMax (small, ~7 rows per user).
UPDATE "Measurement"
   SET "metric" = 'BICEP_FLEXED'
 WHERE "metric" = 'BICEP';

UPDATE "GeneticMax"
   SET "metric" = 'BICEP_FLEXED'
 WHERE "metric" = 'BICEP';