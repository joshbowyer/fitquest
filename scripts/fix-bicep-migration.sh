#!/usr/bin/env bash
#
# fix-bicep-migration.sh — manual recovery for the
# 20260706000000_bicep_split_flexed_relaxed migration that
# Prisma migrate deploy started but failed on prod.
#
# What happened:
#   - The migration row in _prisma_migrations is in the
#     "started, never finished" state (finished_at NULL,
#     applied_steps_count 0).
#   - The enum was never extended and the 2 legacy BICEP
#     Measurement rows were never migrated to BICEP_FLEXED.
#   - Every subsequent migrate deploy errors out because
#     Prisma sees the stuck row.
#
# What this does (each step in its own psql -c so each is
# its own implicit transaction — ALTER TYPE ADD VALUE can't
# share a tx with the UPDATEs that use the new values):
#   1. Add BICEP_FLEXED + BICEP_RELAXED to the MetricType enum
#   2. Migrate legacy BICEP rows in Measurement + GeneticMax
#   3. Mark the stuck _prisma_migrations row as finished
#   4. Restart fitquest-api so migrate deploy re-runs cleanly
#
# Idempotent. Safe to re-run if it fails partway through —
# the ALTERs use IF NOT EXISTS, the UPDATEs are no-ops once
# legacy rows are gone, and the migration-tracking UPDATE
# only touches rows where finished_at IS NULL.
#
# Usage:
#   chmod +x fix-bicep-migration.sh
#   ./fix-bicep-migration.sh

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-fitquest-db}"
API_CONTAINER="${API_CONTAINER:-fitquest-api}"
MIGRATION_NAME="20260706000000_bicep_split_flexed_relaxed"

run_sql() {
  docker exec "$DB_CONTAINER" psql -U fitness -d fitquest -c "$1"
}

echo "=== Step 1: extend MetricType enum ==="
run_sql "ALTER TYPE \"MetricType\" ADD VALUE IF NOT EXISTS 'BICEP_FLEXED';"
run_sql "ALTER TYPE \"MetricType\" ADD VALUE IF NOT EXISTS 'BICEP_RELAXED';"

echo "=== Step 2: migrate legacy BICEP rows ==="
run_sql "UPDATE \"Measurement\" SET \"metric\" = 'BICEP_FLEXED' WHERE \"metric\" = 'BICEP';"
run_sql "UPDATE \"GeneticMax\"  SET \"metric\" = 'BICEP_FLEXED' WHERE \"metric\" = 'BICEP';"

echo "=== Step 3: mark migration row finished ==="
run_sql "UPDATE \"_prisma_migrations\" SET \"finished_at\" = NOW(), \"applied_steps_count\" = 1 WHERE \"migration_name\" = '$MIGRATION_NAME' AND \"finished_at\" IS NULL;"

echo "=== Step 4: restart fitquest-api ==="
docker restart "$API_CONTAINER"

echo "=== Verify ==="
run_sql "
SELECT
  'BICEP_FLEXED' = ANY(enum_range(NULL::\"MetricType\"))                              AS enum_ok,
  (SELECT COUNT(*) FROM \"Measurement\" WHERE \"metric\" = 'BICEP')                   AS legacy_meas,
  (SELECT COUNT(*) FROM \"Measurement\" WHERE \"metric\" = 'BICEP_FLEXED\")            AS flexed_meas,
  (SELECT finished_at IS NOT NULL FROM \"_prisma_migrations\"
   WHERE migration_name = '$MIGRATION_NAME')                                         AS migration_done;
"

echo "Expected: enum_ok=t, legacy_meas=0, flexed_meas=2, migration_done=t"
echo "Done."