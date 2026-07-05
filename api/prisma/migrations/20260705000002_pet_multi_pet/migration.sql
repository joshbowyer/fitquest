-- Multi-pet support: drop the unique constraint on PetInstance.userId
-- so a user can own multiple pets (up to MAX_PETS_PER_USER=6 enforced
-- at the API level). The schema's old implicit unique index
-- "PetInstance_userId_key" needs to become a regular non-unique
-- index so /pet queries (filter by userId, order by createdAt asc)
-- remain fast.

DROP INDEX IF EXISTS "PetInstance_userId_key";
CREATE INDEX IF NOT EXISTS "PetInstance_userId_idx" ON "PetInstance"("userId");