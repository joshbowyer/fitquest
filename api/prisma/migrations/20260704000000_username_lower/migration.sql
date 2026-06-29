-- Case-insensitive username login.
--
-- Adds a `usernameLower` column populated from the existing
-- `username` so the login route can do a case-insensitive lookup
-- without changing the display name (which preserves whatever
-- case the user typed at registration).
--
-- The UNIQUE constraint is added AFTER the column is populated
-- so a collision (e.g. "Bob" and "bob" both existing) causes
-- the migration to fail loudly rather than silently merging two
-- accounts. If that happens, the operator can manually merge
-- the duplicates before re-running.

ALTER TABLE "User" ADD COLUMN "usernameLower" TEXT;

UPDATE "User" SET "usernameLower" = LOWER("username");

CREATE UNIQUE INDEX "User_usernameLower_key" ON "User"("usernameLower");
CREATE INDEX "User_usernameLower_idx" ON "User"("usernameLower");