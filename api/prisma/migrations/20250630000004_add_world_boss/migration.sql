CREATE TYPE "WorldBossStatus" AS ENUM ('LOCKED', 'ACTIVE', 'DEFEATED');

CREATE TABLE "WorldBoss" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "bossName" TEXT NOT NULL,
    "bossGlyph" TEXT NOT NULL,
    "bossHp" INTEGER NOT NULL,
    "bossMaxHp" INTEGER NOT NULL,
    "status" "WorldBossStatus" NOT NULL DEFAULT 'LOCKED',
    "unlockedAt" TIMESTAMP(3),
    "defeatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorldBoss_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorldBoss_userId_worldId_key" ON "WorldBoss"("userId", "worldId");
CREATE INDEX "WorldBoss_userId_idx" ON "WorldBoss"("userId");

ALTER TABLE "WorldBoss" ADD CONSTRAINT "WorldBoss_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;