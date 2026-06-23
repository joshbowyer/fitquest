-- CreateTable
CREATE TABLE "ActivityInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "qualityScore" INTEGER NOT NULL,
    "recoveryLoad" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "factors" TEXT NOT NULL,
    "model" TEXT,
    "latencyMs" INTEGER,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActivityInsight_workoutId_key" ON "ActivityInsight"("workoutId");

-- CreateIndex
CREATE INDEX "ActivityInsight_userId_idx" ON "ActivityInsight"("userId");

-- AddForeignKey
ALTER TABLE "ActivityInsight" ADD CONSTRAINT "ActivityInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;