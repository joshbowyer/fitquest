-- Add optional frame-defining measurements so genetic-max formulas can
-- refine their Casey Butt estimates (forearm length + neck circumference
-- are both Casey Butt inputs in his original papers).
ALTER TABLE "User" ADD COLUMN "forearmLengthCm" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN "neckCircCm" DOUBLE PRECISION;
