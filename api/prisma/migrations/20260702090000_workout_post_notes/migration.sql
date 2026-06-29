-- Post-workout notes. The existing Workout.notes field doubles as
-- both preflight-conditions (set in the setup phase) and post-session
-- reflection (logged in the Finish screen). They're different in
-- intent — preflight is "felt strong, elbow a bit tweaky", post is
-- "left shoulder pain got sharper on set 3, will back off next time".
-- Splitting them into two columns makes the post-workout prompt a
-- first-class affordance (rendered only on the Finish screen) and
-- lets future analytics segment by phase.

ALTER TABLE "Workout"
  ADD COLUMN "postNotes" TEXT;