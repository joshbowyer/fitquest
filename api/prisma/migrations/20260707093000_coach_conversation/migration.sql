-- Persist AI Coach conversations + messages. v1.1 of the /coach
-- feature (ROADMAP P2 item): the previous release persisted the
-- latest user message in memory only; every page refresh started
-- a fresh conversation. This migration adds the storage shape
-- for one rolling conversation per user + an append-only message
-- log, so the user can close the browser, come back tomorrow, and
-- continue where they left off.

CREATE TABLE IF NOT EXISTS "CoachConversation" (
    "id"           TEXT PRIMARY KEY,
    "userId"       TEXT NOT NULL UNIQUE,
    "summary"      TEXT,
    "summaryUpTo"   TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoachConversation_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "CoachConversation_userId_lastMessageAt_idx"
    ON "CoachConversation"("userId", "lastMessageAt");

CREATE TABLE IF NOT EXISTS "CoachMessage" (
    "id"             TEXT PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role"           TEXT NOT NULL,
    "content"        TEXT NOT NULL,
    "model"          TEXT,
    "latencyMs"      INTEGER,
    "tokensIn"       INTEGER,
    "tokensOut"      INTEGER,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoachMessage_conversationId_fkey" FOREIGN KEY ("conversationId")
        REFERENCES "CoachConversation"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "CoachMessage_conversationId_createdAt_idx"
    ON "CoachMessage"("conversationId", "createdAt");