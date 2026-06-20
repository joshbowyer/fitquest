-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT');

-- CreateEnum
CREATE TYPE "DailyCategory" AS ENUM ('USER', 'WORKOUT', 'SPIRITUAL', 'SLEEP');

-- CreateTable
CREATE TABLE "RoutineDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" "DayOfWeek" NOT NULL,
    "workout" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutineDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Daily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "DailyCategory" NOT NULL DEFAULT 'USER',
    "days" "DayOfWeek"[] DEFAULT ARRAY[]::"DayOfWeek"[],
    "notes" TEXT,
    "goldReward" INTEGER NOT NULL DEFAULT 5,
    "xpReward" INTEGER NOT NULL DEFAULT 2,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyId" TEXT NOT NULL,
    "dailyKey" TEXT NOT NULL,
    "goldDelta" INTEGER NOT NULL DEFAULT 0,
    "xpDelta" INTEGER NOT NULL DEFAULT 0,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoutineDay_userId_day_key" ON "RoutineDay"("userId", "day");

-- CreateIndex
CREATE INDEX "RoutineDay_userId_idx" ON "RoutineDay"("userId");

-- CreateIndex
CREATE INDEX "Daily_userId_archived_idx" ON "Daily"("userId", "archived");

-- CreateIndex
CREATE INDEX "DailyLog_userId_loggedAt_idx" ON "DailyLog"("userId", "loggedAt");

-- CreateIndex
CREATE INDEX "DailyLog_dailyId_loggedAt_idx" ON "DailyLog"("dailyId", "loggedAt");

-- AddForeignKey
ALTER TABLE "RoutineDay" ADD CONSTRAINT "RoutineDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Daily" ADD CONSTRAINT "Daily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_dailyId_fkey" FOREIGN KEY ("dailyId") REFERENCES "Daily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: add spiritualDailyPrayers to User
ALTER TABLE "User" ADD COLUMN "spiritualDailyPrayers" "PrayerType"[] DEFAULT ARRAY['ROSARY', 'SCRIPTURE']::"PrayerType"[];
