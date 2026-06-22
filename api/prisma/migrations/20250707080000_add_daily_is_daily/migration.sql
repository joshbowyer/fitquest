-- Add isDaily column to Daily. Defaults true so existing custom
-- practices (e.g. Gratitude Journal, Litany of Trust) continue
-- to appear on /today's checklist without any data backfill.
ALTER TABLE "Daily" ADD COLUMN "isDaily" BOOLEAN NOT NULL DEFAULT true;
