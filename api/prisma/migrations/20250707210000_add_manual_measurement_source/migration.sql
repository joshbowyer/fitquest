-- Add MANUAL to the MeasurementSource enum. Lets the user mark
-- manually-typed entries (e.g. weigh-in via the /today checklist)
-- distinctly from device-imported rows (UNKNOWN) and from
-- methodologically-known readings (DEXA, CALIPERS, etc.).
ALTER TYPE "MeasurementSource" ADD VALUE 'MANUAL';
