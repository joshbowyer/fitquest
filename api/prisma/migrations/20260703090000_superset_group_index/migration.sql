-- Supersets: allow exercises within a workout / template to be
-- grouped so the live workout logger can interleave them.
--
-- Semantics: two (or more) exercises that share the same groupIndex
-- are paired. The live logger walks them round-robin:
--   pair 1, set 1: ex A · ex B
--   pair 1, set 2: ex A · ex B
--   ...
-- Exercises with groupIndex = null walk linearly (no change vs.
-- pre-superset behavior).
--
-- The column is nullable so existing rows + the bulk-mode logger
-- don't need to be migrated with a value. New pairs opt-in by
-- the user clicking "Pair with next exercise" in the Routines
-- page or by setting the field via the API.
--
-- Same column on both WorkoutTemplateExercise (saved templates) and
-- Exercise (committed workouts) so a paired template can carry
-- the pairing all the way through to the live workout.

ALTER TABLE "WorkoutTemplateExercise"
  ADD COLUMN "groupIndex" INTEGER;

ALTER TABLE "Exercise"
  ADD COLUMN "groupIndex" INTEGER;

-- Indexes for the round-robin walker so it can group + sort
-- exercises in a workout by their groupIndex efficiently.
CREATE INDEX "WorkoutTemplateExercise_templateId_groupIndex_idx"
  ON "WorkoutTemplateExercise"("templateId", "groupIndex");

CREATE INDEX "Exercise_workoutId_groupIndex_idx"
  ON "Exercise"("workoutId", "groupIndex");