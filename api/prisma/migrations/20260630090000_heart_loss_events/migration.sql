-- Wire up the Hardcore heart-loss system. The loseHeart() function
-- has existed since mode.ts was first written but had no callers —
-- this migration creates the audit table the morning-report sweep
-- writes to, and the unique index that makes the same-day check
-- idempotent (re-fetching /morning-report within the same local day
-- is a no-op for hearts).
--
-- One row per (user, local-date, trigger-kind) where trigger-kind is
-- one of:
--   MISSED_WORKOUT    — yesterday was a planned workout day, no workout logged
--   MISSED_ALL_DAILIES — all expected dailies (incl. spiritual) were skipped
--   SUBSTANCE_CAFFEINE  — caffeine log count exceeded cap
--   SUBSTANCE_ALCOHOL   — rolling 7-day alcohol count exceeded cap
--   SUBSTANCE_NICOTINE  — rolling 7-day nicotine count exceeded cap
--   ZERO_SPIRITUAL    — no spiritual activity logged yesterday
--
-- The unique index makes the check naturally idempotent — duplicate
-- fires (from re-running the morning report) get a constraint
-- violation that we swallow and treat as "already fired today".

CREATE TYPE "HeartLossTrigger" AS ENUM (
  'MISSED_WORKOUT',
  'MISSED_ALL_DAILIES',
  'SUBSTANCE_CAFFEINE',
  'SUBSTANCE_ALCOHOL',
  'SUBSTANCE_NICOTINE',
  'ZERO_SPIRITUAL'
);

CREATE TABLE "HeartLossEvent" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "kind"        "HeartLossTrigger" NOT NULL,
  "sourceDate"  DATE NOT NULL,
  "details"     TEXT,
  "firedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HeartLossEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HeartLossEvent_userId_kind_sourceDate_key"
    UNIQUE ("userId", "kind", "sourceDate")
);

CREATE INDEX "HeartLossEvent_userId_firedAt_idx"
  ON "HeartLossEvent"("userId", "firedAt");

ALTER TABLE "HeartLossEvent"
  ADD CONSTRAINT "HeartLossEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;