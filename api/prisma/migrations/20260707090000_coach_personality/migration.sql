-- Per-user AI Coach personality preset. Drives the SYSTEM_PROMPT
-- chosen for /coach/* requests; the actual prompts live in
-- api/src/lib/coach.ts (code, not DB) so they can be tuned without
-- a migration. Roadmap: P2 AI Coach personalities — see ROADMAP.md.
DO $$ BEGIN
    CREATE TYPE "CoachPersonality" AS ENUM (
        'PRIEST_BODYBUILDER',
        'BOB_ROSS',
        'DRILL_SERGEANT',
        'ZOOMER',
        'GENERIC'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "coachPersonality" "CoachPersonality";