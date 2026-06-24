-- CreateEnum
CREATE TYPE "MeasurementSource" AS ENUM ('DEXA', 'BOD_POD', 'NAVY_TAPE', 'CALIPERS', 'BIA', 'VISUAL', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Measurement" ADD COLUMN "source" "MeasurementSource" NOT NULL DEFAULT 'UNKNOWN';

-- CreateIndex speeds up "last N body-fat readings" queries
CREATE INDEX "Measurement_userId_metric_source_recordedAt_idx" ON "Measurement"("userId", "metric", "source", "recordedAt");
