-- Home-base shield tier enum + table. One row per user;
-- shield 0-100; tier derived from shield (90-100=FORTIFIED,
-- 60-89=STABLE, 30-59=COMPROMISED, 0-29=BREECHED). The Breach
-- (level-10 unlock) will multiply boss damage by tier.
CREATE TYPE "ShieldTier" AS ENUM ('FORTIFIED', 'STABLE', 'COMPROMISED', 'BREECHED');

CREATE TABLE "HomeBase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shield" INTEGER NOT NULL DEFAULT 100,
    "tier" "ShieldTier" NOT NULL DEFAULT 'FORTIFIED',
    "shieldLastDecay" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeBase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomeBase_userId_key" ON "HomeBase"("userId");

ALTER TABLE "HomeBase" ADD CONSTRAINT "HomeBase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PenanceTemplate — system defaults (userId NULL) + user-custom
-- (userId set). Unique (userId, key) so a user template with
-- the same key shadows the default.
CREATE TABLE "PenanceTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "flavor" TEXT,
    "shieldDelta" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PenanceTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PenanceTemplate_userId_key_key" ON "PenanceTemplate"("userId", "key");
CREATE INDEX "PenanceTemplate_userId_enabled_idx" ON "PenanceTemplate"("userId", "enabled");

ALTER TABLE "PenanceTemplate" ADD CONSTRAINT "PenanceTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PenanceEvent — one row per fire. Audit trail for the home-base
-- feed; lets us reconstruct shield value at any past date and
-- render the "Shield 80 → 65 (-15)" animation rows.
CREATE TABLE "PenanceEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "penanceKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "shieldDelta" INTEGER NOT NULL,
    "shieldAfter" INTEGER NOT NULL,
    "tierAfter" "ShieldTier" NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PenanceEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PenanceEvent_userId_createdAt_idx" ON "PenanceEvent"("userId", "createdAt");
CREATE INDEX "PenanceEvent_userId_source_idx" ON "PenanceEvent"("userId", "source");

ALTER TABLE "PenanceEvent" ADD CONSTRAINT "PenanceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
