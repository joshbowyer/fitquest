-- Avatar customization for the pixel sprite system. One row per user.
CREATE TYPE "HairStyle" AS ENUM ('SHORT', 'LONG', 'MOHAWK', 'BUZZ', 'PONYTAIL', 'PIXIE');
CREATE TABLE "Avatar" (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL UNIQUE,
  "hairStyle"   "HairStyle" NOT NULL DEFAULT 'SHORT',
  "hairColor"   TEXT NOT NULL DEFAULT '#56e88e',
  "skinTone"    TEXT NOT NULL DEFAULT '#d0a878',
  "shirtColor"  TEXT NOT NULL DEFAULT '#14d6e8',
  "pantsColor"  TEXT NOT NULL DEFAULT '#424553',
  "accentColor" TEXT NOT NULL DEFAULT '#f55cc4',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Avatar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
