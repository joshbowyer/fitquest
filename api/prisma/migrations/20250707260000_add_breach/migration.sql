-- CreateEnum
CREATE TYPE "BreachTier" AS ENUM ('MINOR', 'ELITE', 'LEGENDARY', 'APEX');

-- CreateEnum
CREATE TYPE "BreachDifficulty" AS ENUM ('ONE', 'TWO', 'THREE', 'FOUR', 'FIVE');

-- CreateEnum
CREATE TYPE "BreachClassAffinity" AS ENUM ('JUGGERNAUT', 'BERSERKER', 'PHANTOM', 'SCOUT', 'TRACER', 'ORACLE', 'ANY');

-- CreateEnum
CREATE TYPE "BreachProgressStatus" AS ENUM ('LOCKED', 'ACTIVE', 'VICTORY', 'COOLDOWN');

-- CreateTable: BreachBoss
CREATE TABLE "BreachBoss" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lore" TEXT,
    "difficulty" "BreachDifficulty" NOT NULL,
    "tier" "BreachTier" NOT NULL,
    "maxHp" INTEGER NOT NULL,
    "hp" INTEGER NOT NULL,
    "classAffinity" "BreachClassAffinity" NOT NULL DEFAULT 'ANY',
    "preferredTags" JSONB NOT NULL,
    "bonusTags" JSONB NOT NULL DEFAULT '[]',
    "intro" TEXT,
    "spriteEmoji" TEXT NOT NULL DEFAULT '◉',
    "spriteColor" TEXT NOT NULL DEFAULT '#dc2626',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreachBoss_pkey" PRIMARY KEY ("id")
);

-- CreateTable: UserBreachProgress
CREATE TABLE "UserBreachProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentBossId" TEXT,
    "bossHp" INTEGER NOT NULL DEFAULT 0,
    "status" "BreachProgressStatus" NOT NULL DEFAULT 'LOCKED',
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "lastDeathAt" TIMESTAMP(3),
    "soulstones" INTEGER NOT NULL DEFAULT 0,
    "damageToday" INTEGER NOT NULL DEFAULT 0,
    "damageDayKey" TEXT,
    "unlockedAt" TIMESTAMP(3),
    "recentBossIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBreachProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BreachDamageEvent
CREATE TABLE "BreachDamageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bossId" TEXT NOT NULL,
    "workoutId" TEXT,
    "damage" INTEGER NOT NULL,
    "bossHpAfter" INTEGER NOT NULL,
    "matchType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreachDamageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BreachBoss_tier_difficulty_idx" ON "BreachBoss"("tier", "difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "UserBreachProgress_userId_key" ON "UserBreachProgress"("userId");

-- CreateIndex
CREATE INDEX "UserBreachProgress_status_idx" ON "UserBreachProgress"("status");

-- CreateIndex
CREATE INDEX "BreachDamageEvent_userId_createdAt_idx" ON "BreachDamageEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BreachDamageEvent_bossId_createdAt_idx" ON "BreachDamageEvent"("bossId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserBreachProgress" ADD CONSTRAINT "UserBreachProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBreachProgress" ADD CONSTRAINT "UserBreachProgress_currentBossId_fkey" FOREIGN KEY ("currentBossId") REFERENCES "BreachBoss"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreachDamageEvent" ADD CONSTRAINT "BreachDamageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreachDamageEvent" ADD CONSTRAINT "BreachDamageEvent_bossId_fkey" FOREIGN KEY ("bossId") REFERENCES "BreachBoss"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreachDamageEvent" ADD CONSTRAINT "BreachDamageEvent_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
