-- Skill branch: column for grouping skills into tree columns.
--
-- The SkillTree page renders one column per branch per class
-- (e.g. JUGGERNAUT's Squat, PHANTOM's Pull, BERSERKER's
-- Kettlebell). The previous version of the page tried to infer
-- the branch from the skill's name prefix, which broke because
-- skill names like "Half-Squat Initiate" or "Bench 1×BW" don't
-- start with the canonical branch label.
--
-- This column stores the branch label directly on each row,
-- so the page can group without any string matching. Nullable
-- so pre-v1 skills (the 29 in-DB leftovers) continue to work;
-- the page falls those into the "Other" column. New v1 skills
-- get their branch populated by api/src/lib/seedSkills.ts.
--
-- Stored as a plain TEXT (not an enum) so future class / branch
-- additions don't need a schema migration.

ALTER TABLE "Skill" ADD COLUMN "branch" TEXT;