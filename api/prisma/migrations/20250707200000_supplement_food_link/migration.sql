-- AlterTable
ALTER TABLE "UserTrackedItem" ADD COLUMN "suppliedBySavedFoodId" TEXT;

-- AddForeignKey
ALTER TABLE "UserTrackedItem" ADD CONSTRAINT "UserTrackedItem_suppliedBySavedFoodId_fkey" FOREIGN KEY ("suppliedBySavedFoodId") REFERENCES "SavedFood"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for fast "what supplements come from this food?" lookups
CREATE INDEX "UserTrackedItem_suppliedBySavedFoodId_idx" ON "UserTrackedItem"("suppliedBySavedFoodId");
