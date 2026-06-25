-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Set" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "restSeconds" INTEGER,
ADD COLUMN     "startedAt" TIMESTAMP(3);

