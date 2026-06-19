-- Class system v2: replace BODYBUILDER/POWERLIFTER/CALISTHENIST/ENDURANCE/HYBRID
-- with JUGGERNAUT/PHANTOM/FORGE/BERSERKER/ORACLE.
-- Postgres can't drop enum values, so we add the new ones, then NULL the user
-- class column. The user picks a fresh class on next profile visit (the
-- class selector is gated by their 9-class frame archetype, so they can't
-- pick something that doesn't fit their build).

-- Add new enum values
ALTER TYPE "ClassName" ADD VALUE IF NOT EXISTS 'JUGGERNAUT';
ALTER TYPE "ClassName" ADD VALUE IF NOT EXISTS 'PHANTOM';
ALTER TYPE "ClassName" ADD VALUE IF NOT EXISTS 'FORGE';
ALTER TYPE "ClassName" ADD VALUE IF NOT EXISTS 'BERSERKER';
ALTER TYPE "ClassName" ADD VALUE IF NOT EXISTS 'ORACLE';

-- Null out user classes so the new class selector is the next step.
-- (Old enum values are kept around for now in case there's any data we
--  want to migrate later. They're ignored by the web UI.)
UPDATE "User" SET "class" = NULL;
