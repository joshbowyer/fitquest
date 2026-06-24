-- Per-workout set values that the per-exercise plausibility detector
-- flagged (Bench 500kg, Squat 1000 reps, etc.). Aggregated into the
-- morning report so the user can fix typos that would otherwise
-- pollute the LLM narrative (e.g. "your bench went up to 500kg"
-- when really it was 150kg with a missing digit).
--
-- Shape: JSON array of
-- {workoutId, workoutName, exercise, setIndex, value, unit,
--  reason, severity, occurredAt}.
ALTER TABLE "MorningReport" ADD COLUMN "impossibleValueFlags" TEXT;
