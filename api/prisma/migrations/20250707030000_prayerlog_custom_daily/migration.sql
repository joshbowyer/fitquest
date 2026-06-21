-- PrayerLog gains an optional link to a user-defined Daily (custom
-- spiritual practice). type is now nullable; the old enum values
-- still work for built-in prayers.
ALTER TABLE "PrayerLog" ALTER COLUMN "type" DROP NOT NULL;
ALTER TABLE "PrayerLog" ADD COLUMN "dailyId" TEXT;
ALTER TABLE "PrayerLog" ADD COLUMN "goldAwarded" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PrayerLog" ADD CONSTRAINT "PrayerLog_dailyId_fkey"
  FOREIGN KEY ("dailyId") REFERENCES "Daily"("id") ON DELETE SET NULL;
CREATE INDEX "PrayerLog_dailyId_idx" ON "PrayerLog"("dailyId");