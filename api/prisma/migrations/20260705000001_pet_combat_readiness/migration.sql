-- Pet combat readiness migration.
--
-- 1) Add `deployed` (Boolean, default false) and `lastFaintProgress`
--    (Float?, nullable) to PetInstance. The deploy toggle is how
--    the user opts into pet XP from combat. lastFaintProgress
--    captures boss HP fraction at the moment of faint so we can
--    grant posthumous XP on the eventual boss kill.
--
-- 2) Reprice the existing pet food ShopItem rows from cost=10 to
--    cost=50 and effectValue=1 to effectValue=5. The fresh-DB
--    migration (20260705000000_add_pet_food_items) already inserts
--    at cost=50 / effectValue=5, so this UPDATE is a no-op there
--    and brings existing DBs (dev + prod) into line.
--
-- 3) Reprice PetBreed rows to costGold=1000 (~20 days of typical
--    work). Fresh-DB seed-pets.ts also inserts at 1000; this
--    UPDATE normalizes existing rows.
--
-- 4) Drop the workout auto-train: that effectKey was never
--    added to the schema (the route file still references it),
--    but we keep this migration focused on the columns and the
--    price updates; the route-level change is a separate edit.

-- 1) Add columns to PetInstance.
ALTER TABLE "PetInstance" ADD COLUMN "deployed"           BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PetInstance" ADD COLUMN "lastFaintProgress" DOUBLE PRECISION;

-- 2) Reprice pet food ShopItem rows (cost 10→50, effectValue 1→5).
UPDATE "ShopItem"
   SET "cost" = 50, "effectValue" = 5
 WHERE "key" IN ('kibble', 'rainbow_worms');

-- 3) Reprice PetBreed rows (costGold 200→1000).
UPDATE "PetBreed" SET "costGold" = 1000;