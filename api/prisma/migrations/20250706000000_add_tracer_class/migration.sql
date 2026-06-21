-- Add TRACER to ClassName enum.
-- Postgres can't DROP enum values cheaply, so orphan values from
-- prior renames (FORGE, MARATHONER) remain — the web UI ignores them.
ALTER TYPE "ClassName" ADD VALUE 'TRACER';