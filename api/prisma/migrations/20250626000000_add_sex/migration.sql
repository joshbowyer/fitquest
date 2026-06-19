-- Add Sex enum to User (used for body fat interpretation + genetic max
-- inputs that are sex-aware, e.g. VO2 max ceilings, strength norms).
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE', 'OTHER');
ALTER TABLE "User" ADD COLUMN "sex" "Sex";
