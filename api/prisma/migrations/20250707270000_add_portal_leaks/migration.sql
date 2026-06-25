-- CreateEnum
CREATE TYPE "PortalLeakStatus" AS ENUM ('ACTIVE', 'DEFEATED', 'OVERWHELMED', 'EXPIRED');

-- CreateTable
CREATE TABLE "PortalLeak" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monsterName" TEXT NOT NULL,
    "monsterEmoji" TEXT NOT NULL,
    "monsterColor" TEXT NOT NULL,
    "intro" TEXT NOT NULL,
    "preferredTags" JSONB NOT NULL,
    "bonusTags" JSONB NOT NULL DEFAULT '[]',
    "hp" INTEGER NOT NULL DEFAULT 100,
    "maxHp" INTEGER NOT NULL DEFAULT 100,
    "status" "PortalLeakStatus" NOT NULL DEFAULT 'ACTIVE',
    "spawnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "itemDrop" TEXT,
    "resolvedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalLeak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalLeakDamageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leakId" TEXT NOT NULL,
    "workoutId" TEXT,
    "damage" INTEGER NOT NULL,
    "leakHpAfter" INTEGER NOT NULL,
    "matchType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalLeakDamageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortalLeak_userId_status_idx" ON "PortalLeak"("userId", "status");

-- CreateIndex
CREATE INDEX "PortalLeak_userId_spawnedAt_idx" ON "PortalLeak"("userId", "spawnedAt");

-- CreateIndex
CREATE INDEX "PortalLeakDamageEvent_userId_createdAt_idx" ON "PortalLeakDamageEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PortalLeakDamageEvent_leakId_createdAt_idx" ON "PortalLeakDamageEvent"("leakId", "createdAt");

-- AddForeignKey
ALTER TABLE "PortalLeak" ADD CONSTRAINT "PortalLeak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalLeakDamageEvent" ADD CONSTRAINT "PortalLeakDamageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalLeakDamageEvent" ADD CONSTRAINT "PortalLeakDamageEvent_leakId_fkey" FOREIGN KEY ("leakId") REFERENCES "PortalLeak"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalLeakDamageEvent" ADD CONSTRAINT "PortalLeakDamageEvent_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
