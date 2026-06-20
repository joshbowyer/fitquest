-- CreateTable
CREATE TABLE "SupplementLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "doseMg" INTEGER,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplementLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplementLog_userId_name_takenAt_idx" ON "SupplementLog"("userId", "name", "takenAt");

-- AddForeignKey
ALTER TABLE "SupplementLog" ADD CONSTRAINT "SupplementLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
