-- Persistent notification feed. Adds the Notification model + the
-- NotificationCategory enum. Rows are created by the existing event
-- paths (level-up, skill unlock, penance, shop) and read by the
-- /notifications inbox + the unread-count badge.

DO $$ BEGIN
    CREATE TYPE "NotificationCategory" AS ENUM (
        'SKILL', 'PENANCE', 'SHOP', 'SYSTEM', 'ACHIEVEMENT', 'LEVEL'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Notification" (
    "id"        TEXT PRIMARY KEY,
    "userId"    TEXT NOT NULL,
    "category"  "NotificationCategory" NOT NULL,
    "kind"      TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "body"      TEXT,
    "link"      TEXT,
    "payload"   JSONB,
    "readAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_idx"
    ON "Notification" ("userId", "readAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx"
    ON "Notification" ("userId", "createdAt");
