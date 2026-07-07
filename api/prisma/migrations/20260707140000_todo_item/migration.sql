-- One-shot TODO items — separate from Habit (recurring tick) and
-- Daily (scheduled check-in). Adds the TodoItem model + the
-- TodoPriority + TodoStatus enums. Completion grants XP scaled by
-- priority (LOW=10, MEDIUM=20, HIGH=30).

DO $$ BEGIN
    CREATE TYPE "TodoPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "TodoStatus" AS ENUM ('OPEN', 'DONE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TodoItem" (
    "id"          TEXT PRIMARY KEY,
    "userId"      TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "description" TEXT,
    "dueDate"     TIMESTAMP(3),
    "priority"    "TodoPriority" NOT NULL DEFAULT 'MEDIUM',
    "status"      "TodoStatus"   NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TodoItem_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "TodoItem_userId_status_idx"
    ON "TodoItem" ("userId", "status");
CREATE INDEX IF NOT EXISTS "TodoItem_userId_dueDate_idx"
    ON "TodoItem" ("userId", "dueDate");
CREATE INDEX IF NOT EXISTS "TodoItem_userId_createdAt_idx"
    ON "TodoItem" ("userId", "createdAt");