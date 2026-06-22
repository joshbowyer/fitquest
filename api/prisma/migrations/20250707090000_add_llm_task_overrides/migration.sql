-- Add per-task model overrides to LlmConfig. Each task (food /
-- foodSaved / morningReport / spiritualDirector) can route to a
-- different model. Missing entries fall back to the default
-- primary + fallback chain. Default '{}' = no overrides.
ALTER TABLE "LlmConfig" ADD COLUMN "taskOverrides" JSONB;
