-- Migrate existing rows from BREECHED to BREACHED.
-- Runs as its own transaction AFTER the new enum value has
-- committed (see 20260626224918_rename_shield_tier_breeched_to_breached).
UPDATE "HomeBase" SET tier = 'BREACHED' WHERE tier = 'BREECHED';
UPDATE "PenanceEvent" SET "tierAfter" = 'BREACHED' WHERE "tierAfter" = 'BREECHED';
