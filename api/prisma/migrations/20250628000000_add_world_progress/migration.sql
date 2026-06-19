-- UserWorldProgress table for the Quest tab --

CREATE TABLE "UserWorldProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "bestScore" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserWorldProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserWorldProgress_userId_levelId_key" ON "UserWorldProgress"("userId", "levelId");
CREATE INDEX "UserWorldProgress_userId_idx" ON "UserWorldProgress"("userId");

ALTER TABLE "UserWorldProgress" ADD CONSTRAINT "UserWorldProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

