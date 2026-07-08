-- Persistent "morning popup dismissed" state, keyed on (user, local
-- date in user's tz). Replaces the per-device localStorage flag the
-- MorningPopup component used to use — the localStorage version was
-- scoped to one browser's storage area, so dismissing on the
-- Android (Capacitor) app did NOT carry over to the desktop web
-- browser, and vice-versa. The popup would then re-open on the
-- other device the first time the user touched it that day. With
-- this row, the dismissal is server-side and the next /today (or
-- first interaction on any page) on any device reads the same
-- state.
--
-- date is a YYYY-MM-DD string (NOT a timestamptz) for the same
-- reason HeartLossEvent.sourceDate is a @db.Date: the unique
-- constraint is per local calendar day in the user's tz, and the
-- server computes the date in the request handler from me.timezone.
--
-- The row's only purpose is existence-as-flag. We don't actually
-- need the dismissedAt column to drive UI — `findUnique` on the
-- composite (userId, date) is the check. The timestamp is kept
-- anyway so we can debug "when did the user dismiss" and so a
-- future retention metric (e.g. average time-to-dismiss) has the
-- data without another migration.

CREATE TABLE IF NOT EXISTS "MorningPopupDismissal" (
    "id"          TEXT PRIMARY KEY,
    "userId"      TEXT NOT NULL,
    "date"        TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MorningPopupDismissal_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE
);

-- The unique constraint IS the API: POST /dailies/morning-popup/dismiss
-- is an upsert on (userId, date), GET /dailies/morning-popup returns
-- `dismissed: true` iff a row with today's date exists.
CREATE UNIQUE INDEX IF NOT EXISTS "MorningPopupDismissal_userId_date_key"
    ON "MorningPopupDismissal" ("userId", "date");
