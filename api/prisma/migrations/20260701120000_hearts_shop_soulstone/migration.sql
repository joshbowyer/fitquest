-- Hearts + shop + soulstone system (v1).
--
-- Three related changes that ship together:
--
-- 1. Hearts default 5 → 10. The graduated Hardcore penalty curve
--    has more meaningful resolution at the new max. Existing users
--    get bumped to 10 (rather than left at 5, which would be jarring
--    on the new scale).
--
-- 2. User.soulstones Int column DROPPED. The class-lock bypass used
--    a counter on the User row; we're replacing it with a proper
--    Soulstone table that supports per-stone TTL. Any existing
--    soulstones (rare in prod — raids only occasionally drop one)
--    are migrated: a Soulstone row is inserted per held count, all
--    with expiresAt = now + 7d (so existing ones don't immediately
--    disintegrate; they keep their "permanent" feel). Going forward
--    all soulstones are dropped by world bosses with 24h TTL.
--
-- 3. ShopItem + Purchase tables. Shop items are seeded with 4 base
--    entries (Vital Tonic, War Tincture, Continuity Rune, Forge
--    Tonic). Each purchase creates a Purchase row; the effect is
--    applied either immediately (heart refill) or via the unconsumed
--    + not-expired rows for duration-based items (raid buff, pr
--    doubler, streak shield). The 4 items are seeded with their
--    hardcoded gold costs (50/80/30/40).
--
-- 4. Soulstone table. World bosses always drop one of these in
--    addition to their normal drops. TTL is 24h — expired rows are
--    lazy-cleaned by the inventory/use endpoints (filtered out of
--    queries, never hard-deleted except by a future cron if we want
--    a tighter housekeeping SLA). Using a soulstone triggers a class
--    respec.

ALTER TABLE "User" ALTER COLUMN "hearts" SET DEFAULT 10;
UPDATE "User" SET "hearts" = 10 WHERE "hearts" < 10;

-- Migrate existing User.soulstones counter into Soulstone rows.
-- A user with soulstones=3 gets 3 Soulstone rows, each with
-- expiresAt = now + 7 days (legacy grace period). Going forward
-- bosses drop rows with expiresAt = now + 24h.
DO $$
DECLARE
  u RECORD;
  i INT;
BEGIN
  FOR u IN SELECT "id", "soulstones" FROM "User" WHERE "soulstones" > 0 LOOP
    FOR i IN 1..u.soulstones LOOP
      INSERT INTO "Soulstone" ("id", "userId", "bossName", "bossTier", "droppedAt", "expiresAt", "consumed", "consumedAt")
      VALUES (
        'soulstone_legacy_' || u."id" || '_' || i,
        u."id",
        'Legacy (pre-update carry)',
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP + INTERVAL '7 days',
        false,
        NULL
      );
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE "User" DROP COLUMN "soulstones";

CREATE TABLE "ShopItem" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "effectKey" TEXT NOT NULL,
    "effectValue" INTEGER NOT NULL DEFAULT 0,
    "effectDurationSec" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopItem_key_key" ON "ShopItem"("key");
CREATE INDEX "ShopItem_active_idx" ON "ShopItem"("active");

CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Purchase_userId_purchasedAt_idx" ON "Purchase"("userId", "purchasedAt");
CREATE INDEX "Purchase_userId_consumedAt_idx" ON "Purchase"("userId", "consumedAt");

CREATE TABLE "Soulstone" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bossName" TEXT NOT NULL,
    "bossTier" INTEGER NOT NULL DEFAULT 1,
    "droppedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "Soulstone_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Soulstone_userId_droppedAt_idx" ON "Soulstone"("userId", "droppedAt");
CREATE INDEX "Soulstone_userId_expiresAt_idx" ON "Soulstone"("userId", "expiresAt");

ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "ShopItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Soulstone" ADD CONSTRAINT "Soulstone_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the 4 base shop items.
INSERT INTO "ShopItem" ("id", "key", "name", "description", "cost", "effectKey", "effectValue", "effectDurationSec", "active", "createdAt") VALUES
    ('shop_vital_tonic',     'vital_tonic',     'Vital Tonic',     'A small vial of restorative elixir. +1 heart immediately. Hardcore only.', 50,  'heart_refill',  1,  NULL,            true, CURRENT_TIMESTAMP),
    ('shop_war_tincture',    'war_tincture',    'War Tincture',    'Bottled rage. +25% damage on your next raid. Lasts 24 hours from purchase.',     80,  'raid_buff',     25, 86400,           true, CURRENT_TIMESTAMP),
    ('shop_continuity_rune', 'continuity_rune', 'Continuity Rune', 'A glyph of unbroken momentum. Your next missed routine day will not cost a heart nor break your streak.', 30, 'streak_shield',  1, NULL, true, CURRENT_TIMESTAMP),
    ('shop_forge_tonic',     'forge_tonic',     'Forge Tonic',     'Iron and fire in a flask. Your next workout''s PRs count 2x toward XP and gold. Lasts 24 hours from purchase.', 40, 'pr_doubler',     2, 86400, true, CURRENT_TIMESTAMP);
