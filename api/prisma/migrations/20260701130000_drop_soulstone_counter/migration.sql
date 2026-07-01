-- Drop BreachProgress.soulstones (the old counter). Soulstones
-- are now a separate Soulstone table with per-stone TTL, and any
-- world boss / raid drop creates a row there. The Breach progress
-- doesn't need its own counter — the count of unconsumed +
-- non-expired Soulstone rows is the source of truth everywhere.
--
-- Wrapped in a DO block because the table is lazy-created on the
-- user's first /breach GET; on databases that have never had a
-- Breach user, the table doesn't exist yet. ALTER TABLE itself
-- locks the relation even with IF EXISTS, so we need to check the
-- table's existence in a separate dynamic-SQL block first.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'BreachProgress' AND column_name = 'soulstones'
  ) THEN
    ALTER TABLE "BreachProgress" DROP COLUMN "soulstones";
  END IF;
END $$;
