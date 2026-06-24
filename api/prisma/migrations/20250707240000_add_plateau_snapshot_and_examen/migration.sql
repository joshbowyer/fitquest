-- Plateau snapshot cache. The weekly cron in api/src/index.ts
-- writes one row per user per week (Sunday 22:00 local) so the
-- dashboard can show a stale-badge count without forcing a
-- morning report regeneration. Overwrites on conflict.
CREATE TABLE "PlateauSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "plateaus" TEXT NOT NULL,
    "flagCount" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlateauSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlateauSnapshot_userId_weekStart_key" ON "PlateauSnapshot"("userId", "weekStart");
CREATE INDEX "PlateauSnapshot_userId_generatedAt_idx" ON "PlateauSnapshot"("userId", "generatedAt");

ALTER TABLE "PlateauSnapshot" ADD CONSTRAINT "PlateauSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ignatian examen responses — Sunday-evening reflection. 3 open-
-- text fields plus optional notes. One row per user per week
-- (UPSERT on (userId, weekStart)).
CREATE TABLE "ExamenResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "consoled" TEXT NOT NULL,
    "desolated" TEXT NOT NULL,
    "godsPresence" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamenResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExamenResponse_userId_weekStart_key" ON "ExamenResponse"("userId", "weekStart");
CREATE INDEX "ExamenResponse_userId_createdAt_idx" ON "ExamenResponse"("userId", "createdAt");

ALTER TABLE "ExamenResponse" ADD CONSTRAINT "ExamenResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
