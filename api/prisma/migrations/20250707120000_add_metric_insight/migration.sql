-- CreateTable
CREATE TABLE "MetricInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metric" "MetricType" NOT NULL,
    "summary" TEXT NOT NULL,
    "factors" TEXT NOT NULL,
    "model" TEXT,
    "latencyMs" INTEGER,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetricInsight_userId_metric_key" ON "MetricInsight"("userId", "metric");

-- CreateIndex
CREATE INDEX "MetricInsight_userId_idx" ON "MetricInsight"("userId");

-- AddForeignKey
ALTER TABLE "MetricInsight" ADD CONSTRAINT "MetricInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;