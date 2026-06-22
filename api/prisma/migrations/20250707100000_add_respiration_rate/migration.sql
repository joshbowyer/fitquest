-- Add RESPIRATION_RATE to MetricType. The FIT parser already
-- emits this for MONITOR files (RespirationRateMesg → average
-- breaths per minute), but it was missing from the enum so any
-- MONITOR file with respiration data 500'd on import. 19
-- MONITOR files had no respiration data and slipped through.
ALTER TYPE "MetricType" ADD VALUE 'RESPIRATION_RATE';