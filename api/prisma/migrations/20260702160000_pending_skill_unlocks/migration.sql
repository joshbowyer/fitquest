-- PendingSkillUnlock — created when a workout's exercises +
-- sets satisfy a locked skill's test threshold. The SkillTree
-- page shows the user's PENDING rows one at a time on mount;
-- each modal has "Unlock" (POSTs /skills/unlock with the
-- pendingUnlockId, which then marks the row UNLOCKED) and
-- "Not yet" (marks DISMISSED). Idempotent on
-- (userId, skillId, workoutId, matchedSetId) so re-running the
-- matching pass doesn't create duplicate rows.
--
-- The set data is snapshotted (setReps / setWeight / setDuration)
-- at insert time so the modal can render the matched set even
-- after the workout is later edited or deleted. Cascading
-- deletes (on user / workout / skill) still clean up.

CREATE TABLE "PendingSkillUnlock" (
    "id" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "skillId" TEXT NOT NULL REFERENCES "Skill"("id") ON DELETE CASCADE,
    "workoutId" TEXT NOT NULL REFERENCES "Workout"("id") ON DELETE CASCADE,
    "matchedSetId" TEXT NOT NULL,
    "setReps" INTEGER,
    "setWeight" DOUBLE PRECISION,
    "setDuration" INTEGER,
    "exerciseName" TEXT NOT NULL,
    "workoutDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3)
);

CREATE UNIQUE INDEX "PendingSkillUnlock_userId_skillId_workoutId_matchedSet_key"
  ON "PendingSkillUnlock" ("userId", "skillId", "workoutId", "matchedSetId");

CREATE INDEX "PendingSkillUnlock_userId_status_createdAt_idx"
  ON "PendingSkillUnlock" ("userId", "status", "createdAt");