-- Add SCOUT to the ClassName enum.
-- v2 migration added JUGGERNAUT/PHANTOM/FORGE/BERSERKER/ORACLE but not SCOUT
-- (we settled on SCOUT after that migration shipped). Postgres can't drop
-- FORGE, so it stays as an orphan enum value; nothing in the schema or code
-- references it. We only need the ADD VALUE here.

ALTER TYPE "ClassName" ADD VALUE IF NOT EXISTS 'SCOUT';
