-- Add isPrimary Boolean @default(false) to PetInstance.
-- User can mark a pet as the "primary" via POST /pet/set-primary.
-- If no pet is marked primary, the GET /pet endpoint falls back
-- to the oldest (createdAt asc) so existing data still has a
-- sensible default.
ALTER TABLE "PetInstance" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "PetInstance_userId_isPrimary_idx" ON "PetInstance"("userId", "isPrimary");