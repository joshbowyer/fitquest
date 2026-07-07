-- Migration: expand SkillTier enum to support per-branch god-tier
-- tiers beyond T3. Required because some branches (e.g. PHANTOM
-- Holds, JUGGERNAUT Strongman, ORACLE Mobility, BERSERKER
-- Sandbag god-tier) have multiple skills that are clearly
-- harder than "the rest of T3" — V-Sit > L-Sit, Back Lever >
-- Front Lever, full-body weighted carry > bodyweight mile, etc.
-- We don't WANT to flatten them all to one tier; the right move
-- is to allow the per-branch maxTier to climb as high as the
-- branch's hardest skill warrants.
--
-- Postgres ALTER TYPE ... ADD VALUE must be run outside a
-- transaction block; each ADD VALUE needs its own statement and
-- can't be combined. IF NOT EXISTS makes the migration idempotent
-- (safe to re-run on a partially-migrated DB).

ALTER TYPE "SkillTier" ADD VALUE IF NOT EXISTS 'TIER_4';
ALTER TYPE "SkillTier" ADD VALUE IF NOT EXISTS 'TIER_5';
ALTER TYPE "SkillTier" ADD VALUE IF NOT EXISTS 'TIER_6';
