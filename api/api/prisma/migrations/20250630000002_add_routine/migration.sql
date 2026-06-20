-- Routine: per-user weekly training goal + streak tracking.
-- weeklyGoal: 1-14 workouts/week. Default 3.
-- currentStreak: consecutive weeks the user met their goal.
-- lastCompletedWeek: ISO date (YYYY-MM-DD) of Monday of last completed week.

CREATE TABLE "Routine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weeklyGoal" INTEGER NOT NULL DEFAULT 3,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastCompletedWeek" TEXT,
    "streakUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Routine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Routine_userId_key" ON "Routine"("userId");

ALTER TABLE "Routine" ADD CONSTRAINT "Routine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
