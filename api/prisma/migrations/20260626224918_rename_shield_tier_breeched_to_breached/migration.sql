-- Rename ShieldTier enum value BREECHED -> BREACHED.
--
-- Postgres DOES support DROP VALUE for enums as of v16, but the
-- Debian 13 build of Postgres 17.10 ships with the parse-time hook
-- disabled ("dropping an enum value is not implemented"). The
-- workaround: don't drop. The old BREECHED label stays in the enum
-- but is never written by the app (Prisma client only knows the
-- 4 current values). The Prisma schema regenerates the type without
-- the old value on the next migrate reset / fresh-DB path; the
-- extra label is a no-op.
--
-- Net effect on existing DBs:
--   1. Add new value BREACHED
--   2. Migrate any rows that still have BREECHED
-- That's it. The legacy value hangs around in the enum but is
-- unreferenced. Cheap, reversible, and forward-compatible.

-- Step 1: add the new enum value.
ALTER TYPE "ShieldTier" ADD VALUE IF NOT EXISTS 'BREACHED';

-- Step 2: migrate any existing data from the typo'd value.
UPDATE "HomeBase" SET tier = 'BREACHED' WHERE tier = 'BREECHED';
UPDATE "PenanceEvent" SET "tierAfter" = 'BREACHED' WHERE "tierAfter" = 'BREECHED';
