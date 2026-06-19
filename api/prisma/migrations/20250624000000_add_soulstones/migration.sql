-- Track Soulstones: rare item that lets the user change class outside the
-- normal birthday-based cooldown. Awarded rarely from raid victories.
ALTER TABLE "User" ADD COLUMN "soulstones" INTEGER NOT NULL DEFAULT 0;
