-- Pet system (added 2026-07-04).
--
-- Adds three new tables: PetBreed (catalog), PetInstance (one
-- per user), PetFeedLog (audit trail for gold-spent feed
-- events). All combat-derived state is computed from these
-- rows + workout XP (10% auto-routed to the pet during the
-- workout commit hook).
--
-- A pet never dies; fainting just sets `faintedAt` and the
-- user pays the vet (10 + 5*level gold) to clear it. See
-- HANDOFF.md in the fitquest-sprites repo for the full design.

CREATE TABLE "PetBreed" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "costGold" INTEGER NOT NULL,
    "isStarter" BOOLEAN NOT NULL DEFAULT false,
    "colorVariants" TEXT NOT NULL,
    "availableFrom" TIMESTAMP(3),
    "availableTo" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "baseHp" INTEGER NOT NULL DEFAULT 50,
    "baseAttack" INTEGER NOT NULL DEFAULT 2,
    "spriteBasePath" TEXT NOT NULL,
    "spriteStages" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PetBreed_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PetBreed_slug_key" ON "PetBreed"("slug");

CREATE TABLE "PetInstance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "breedId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colorVariant" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "hpAfterCombat" INTEGER NOT NULL DEFAULT -1,
    "faintedAt" TIMESTAMP(3),
    "evolvedAt" TIMESTAMP(3),
    "armoredAt" TIMESTAMP(3),
    "injuredAt" TIMESTAMP(3),
    "lastFedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PetInstance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PetInstance_userId_key" ON "PetInstance"("userId");
CREATE INDEX "PetInstance_breedId_idx" ON "PetInstance"("breedId");

CREATE TABLE "PetFeedLog" (
    "id" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "fedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "foodGoldCost" INTEGER NOT NULL,
    "xpGained" INTEGER NOT NULL,

    CONSTRAINT "PetFeedLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PetFeedLog_petId_idx" ON "PetFeedLog"("petId");

-- Foreign keys for the new tables. These match the schema.prisma
-- relations declared in the diff. Cascade deletes match the
-- relation behaviors on User (Cascade) and PetBreed (default).
ALTER TABLE "PetInstance" ADD CONSTRAINT "PetInstance_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PetInstance" ADD CONSTRAINT "PetInstance_breedId_fkey"
    FOREIGN KEY ("breedId") REFERENCES "PetBreed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PetFeedLog" ADD CONSTRAINT "PetFeedLog_petId_fkey"
    FOREIGN KEY ("petId") REFERENCES "PetInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
