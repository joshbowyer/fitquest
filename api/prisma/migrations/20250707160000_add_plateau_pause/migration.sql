-- CreateEnum
CREATE TYPE "PlateauKind" AS ENUM ('NO_PR_RECENT', 'ONE_RM_REGRESSION', 'VOLUME_REGRESSION', 'WEIGHT_FLATLINE', 'METRIC_FLATLINE', 'ALL');

-- CreateTable
CREATE TABLE "PlateauPause" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PlateauKind" NOT NULL,
    "pausedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resumeAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlateauPause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlateauPause_userId_resumeAt_idx" ON "PlateauPause"("userId", "resumeAt");

-- AddForeignKey
ALTER TABLE "PlateauPause" ADD CONSTRAINT "PlateauPause_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
