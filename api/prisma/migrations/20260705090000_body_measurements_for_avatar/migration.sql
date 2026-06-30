-- Body measurements for the Tron identity disk avatar.
--
-- Adds shoulderCm + waistCm to User. The existing heightCm + wristCm
-- + ankleCm + forearmLengthCm + neckCircCm columns already cover the
-- height + frame inputs; the new columns cover the visual mapping
-- the roadmap asked for:
--   shoulder width -> outer ring radius (broader shoulders = bigger disc)
--   waist          -> inner ring radius (tighter waist  = bigger inner)
--   height         -> figure y-position + silhouette vertical scale
--
-- Both new columns are nullable so the migration is a no-op for
-- existing users. The /settings page will offer to enter them.

ALTER TABLE "User" ADD COLUMN "shoulderCm" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN "waistCm" DOUBLE PRECISION;