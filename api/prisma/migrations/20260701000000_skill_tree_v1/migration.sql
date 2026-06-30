-- Skill tree v1: blurb + test details.
--
-- Adds two new columns to the Skill model:
--   blurb: short conceptual blurb (e.g. "Build a strong base
--     of cardio endurance"). Rendered on the SkillTree page
--     under each skill's name.
--   test: JSON column holding the unlock-test details:
--     { description, safety, metric, threshold }. The unlock
--     endpoint validates the user's submitted result against
--     this threshold. See api/src/lib/skillTest.ts for the
--     metric-to-validator mapping.
--
-- Both columns are nullable so existing skills (pre-v1) keep
-- working with no test data. New skills (the v1 skill tree
-- seed) populate both. The migration is additive — no rows
-- are touched, no data is lost.

ALTER TABLE "Skill" ADD COLUMN "blurb" TEXT;
ALTER TABLE "Skill" ADD COLUMN "test" JSONB;