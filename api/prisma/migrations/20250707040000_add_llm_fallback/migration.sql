-- AlterTable
ALTER TABLE "LlmConfig"
  ADD COLUMN "fallbackEnabled"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fallbackProvider" TEXT,
  ADD COLUMN "fallbackApiKey"   TEXT,
  ADD COLUMN "fallbackBaseUrl"  TEXT,
  ADD COLUMN "fallbackModel"    TEXT;
