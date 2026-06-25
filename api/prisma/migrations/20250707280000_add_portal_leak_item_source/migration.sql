-- Add PORTAL_LEAK as a valid ItemSource value so portal leak drops
-- can be persisted to InventoryItem without enum-validation errors.
ALTER TYPE "ItemSource" ADD VALUE 'PORTAL_LEAK' BEFORE 'QUEST_REWARD';
