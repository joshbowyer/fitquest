-- Breach ↔ Raid integration: PortalLeak.worldSource distinguishes
-- ambient leaks (default) from Breach-world leaks. The Breach
-- cycle is its own world cycle, so leaks spawned from the Breach
-- world get tagged with this field for the UI to highlight.

CREATE TYPE "PortalLeakSource" AS ENUM ('AMBIENT', 'BREACH');

ALTER TABLE "PortalLeak"
  ADD COLUMN "worldSource" "PortalLeakSource" NOT NULL DEFAULT 'AMBIENT';

CREATE INDEX "PortalLeak_userId_worldSource_idx" ON "PortalLeak"("userId", "worldSource");
