-- Add UnitSystem enum and User.units column
CREATE TYPE "UnitSystem" AS ENUM ('METRIC', 'IMPERIAL');

ALTER TABLE "User" ADD COLUMN "units" "UnitSystem" NOT NULL DEFAULT 'METRIC';
