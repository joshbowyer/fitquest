CREATE TYPE "SpiritualSubclass" AS ENUM ('CATECHUMEN', 'CRUSADER', 'TEMPLAR');
CREATE TYPE "PrayerType" AS ENUM ('ROSARY', 'MASS', 'SCRIPTURE', 'CONTEMPLATION', 'LITURGY_HOURS', 'CONFESSION', 'OTHER');

CREATE TABLE "PrayerLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PrayerType" NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 15,
    "notes" TEXT,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrayerLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrayerLog_userId_loggedAt_idx" ON "PrayerLog"("userId", "loggedAt");

ALTER TABLE "PrayerLog" ADD CONSTRAINT "PrayerLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "spiritualSubclass" "SpiritualSubclass";
ALTER TABLE "User" ADD COLUMN "spiritualXp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "ordained" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "ordainedAt" TIMESTAMP(3);