-- One-shot data migration: convert Workout.duration from "seconds" to
-- "minutes" for rows that were created by the FIT importer before
-- the unit-fix landed. Symptom of the bug: a 92-minute walking
-- session displayed as 5571 minutes in the activity insight.
--
-- Detection: rows imported from FIT carry a "[FIT]" prefix in their
-- notes column. Manual entries don't. We scope the UPDATE so we
-- don't accidentally touch a manual row whose duration happens to
-- exceed 1440 (unlikely but possible — the manual schema caps at
-- 60*24 = 1440 minutes so >1440 can only come from a mis-stored
-- FIT row).
--
-- The divide-by-60 floors to integer minutes; we round to keep the
-- UI reading "93m" instead of "92m" for a 92.8-minute walk (which
-- is what totalTimerTime 5570.788s would land at).

UPDATE "Workout"
SET duration = GREATEST(1, ROUND(duration::numeric / 60)::int)
WHERE notes LIKE '[FIT]%'
  AND duration IS NOT NULL
  AND duration > 1440;
