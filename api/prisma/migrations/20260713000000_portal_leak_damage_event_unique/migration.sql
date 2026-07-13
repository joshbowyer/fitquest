-- Per-workout leak-damage dedup safety net.
--
-- Each (leakId, workoutId) pair may produce at most one
-- PortalLeakDamageEvent row. This is the data-layer enforcement
-- for the same constraint applyLeakDamage() checks in-process:
-- the helper used to be the only line of defense, and a concurrent
-- POST /workouts/:id/leak-damage + inline damage-call from
-- POST /workouts could both pass the findFirst check then both
-- insert, leaving the leak's HP floored and the loot drop
-- reachable by replay. With this unique index in place the
-- second insert raises a unique-constraint violation that the
-- helper code (and the route) treat as "already applied".
--
-- workoutId is nullable (a leaked leak can persist after its
-- workout is deleted via onDelete: SetNull); Postgres treats
-- NULLs as distinct in unique indexes by default, so multiple
-- rows with workoutId IS NULL coexist fine. Only pairs with
-- non-null workoutId become unique.
--
-- NOTE: this migration can FAIL on databases that already have
-- duplicate (leakId, workoutId) rows. The dedup query is:
--
--   DELETE FROM "PortalLeakDamageEvent" p
--   USING "PortalLeakDamageEvent" dup
--   WHERE p.ctid > dup.ctid
--     AND p."leakId"  = dup."leakId"
--     AND p."workoutId" IS NOT DISTINCT FROM dup."workoutId";

CREATE UNIQUE INDEX "PortalLeakDamageEvent_leakId_workoutId_key"
  ON "PortalLeakDamageEvent"("leakId", "workoutId");
