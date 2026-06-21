-- Add inventory enums + ItemDef catalog + InventoryItem ownership.

-- Enum types
CREATE TYPE "EquipSlot" AS ENUM ('HEAD', 'BODY', 'HANDS', 'FEET', 'MAIN', 'OFF', 'NECK', 'RING');
CREATE TYPE "ItemRarity" AS ENUM ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC');
CREATE TYPE "ItemSource" AS ENUM ('MONSTER_DROP', 'BOSS_DROP', 'QUEST_REWARD', 'SHOP', 'CRAFTED', 'ACHIEVEMENT', 'STARTER_KIT');

-- Static item catalog. Seeded at migration time so equip/unequip and
-- drops can reference valid itemDefIds.
CREATE TABLE "ItemDef" (
  "id"                TEXT PRIMARY KEY,
  "name"              TEXT NOT NULL,
  "description"       TEXT,
  "slot"              "EquipSlot" NOT NULL,
  "sprite"            TEXT NOT NULL,
  "color"             TEXT NOT NULL DEFAULT '#a8a8b8',
  "rarity"            "ItemRarity" NOT NULL DEFAULT 'COMMON',
  "stats"             JSONB NOT NULL DEFAULT '{}',
  "classRestriction"  "ClassName",
  "setId"             TEXT,
  "createdAt"         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "ItemDef_slot_idx" ON "ItemDef"("slot");
CREATE INDEX "ItemDef_rarity_idx" ON "ItemDef"("rarity");
CREATE INDEX "ItemDef_classRestriction_idx" ON "ItemDef"("classRestriction");

-- Per-user ownership. Multiple copies of the same item possible
-- (e.g. multiple monster drops); equipping picks one per slot.
CREATE TABLE "InventoryItem" (
  "id"           TEXT PRIMARY KEY,
  "userId"       TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "itemDefId"    TEXT NOT NULL REFERENCES "ItemDef"("id"),
  "equippedSlot" "EquipSlot",
  "acquiredAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "source"       "ItemSource" NOT NULL DEFAULT 'MONSTER_DROP',
  "notes"        TEXT
);

CREATE UNIQUE INDEX "InventoryItem_userId_itemDefId_acquiredAt_key"
  ON "InventoryItem"("userId", "itemDefId", "acquiredAt");
CREATE INDEX "InventoryItem_userId_idx" ON "InventoryItem"("userId");
CREATE INDEX "InventoryItem_userId_equippedSlot_idx" ON "InventoryItem"("userId", "equippedSlot");