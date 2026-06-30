-- Dead Hang as a loggable metric.
--
-- Adds DEAD_HANG to the MetricType enum. Mirrors PLANK_HOLD /
-- L_SIT_HOLD (also time-based calisthenics holds). Like those,
-- it's a manual measurement — users go do a hang and log the
-- best set in seconds, not a workout set.
--
-- The web app reads the enum client-side via web/src/lib/types.ts;
-- no schema-data changes beyond the enum value itself.
--
-- Note: ALTER TYPE ... ADD VALUE must be the only statement in its
-- own transaction (Postgres won't let it share with anything else).
-- Run before any DDL that references the new value.

ALTER TYPE "MetricType" ADD VALUE 'DEAD_HANG';
