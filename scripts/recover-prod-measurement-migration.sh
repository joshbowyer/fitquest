#!/usr/bin/env bash
# Recovery script for the prod measurement_unique migration failure.
# Runs against the docker stack (fitquest-api / fitquest-db / fitquest-web).
#
# What it does (all idempotent + re-runnable):
#   1. Sanity-checks the three containers are up and reachable.
#   2. Inventories duplicates on the Measurement table.
#   3. Deletes duplicates (keeps earliest copy by ctid).
#   4. Marks the failed migration as rolled-back.
#   5. Stops fitquest-api briefly.
#   6. Runs `prisma migrate deploy` inside fitquest-api.
#   7. Starts fitquest-api back up.
#   8. Verifies the api /health endpoint responds.
#
# Run from the project root:
#   bash scripts/recover-prod-measurement-migration.sh
#
# Environment overrides:
#   DB_CONTAINER   — default: fitquest-db
#   API_CONTAINER  — default: fitquest-api
#   DB_USER        — default: fitness
#   DB_NAME        — default: fitquest
#   DB_PASSWORD    — default: fitness  (use a real password in prod;
#                                          override via env or prompt)
#   DRY_RUN=1      — show what would happen without changing anything

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-fitquest-db}"
API_CONTAINER="${API_CONTAINER:-fitquest-api}"
WEB_CONTAINER="${WEB_CONTAINER:-fitquest-web}"
DB_USER="${DB_USER:-fitness}"
DB_NAME="${DB_NAME:-fitquest}"
DB_PASSWORD="${DB_PASSWORD:-fitness}"
DRY_RUN="${DRY_RUN:-0}"

FAILED_MIGRATION='20260701090000_measurement_unique_user_metric_date'

# Pass the password into psql via env so it doesn't prompt.
export PGPASSWORD="$DB_PASSWORD"

# -- helpers ---------------------------------------------------------------

die() { echo "✗ $*" >&2; exit 1; }
ok()  { echo "✓ $*"; }
info(){ echo "→ $*"; }

run_psql() {
  docker exec -e PGPASSWORD="$DB_PASSWORD" -i "$DB_CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -tA -v ON_ERROR_STOP=1 "$@"
}

run_in_api() {
  docker exec -i "$API_CONTAINER" "$@"
}

require_container() {
  local name="$1"
  if ! docker ps --format '{{.Names}}' | grep -qx "$name"; then
    die "Container '$name' is not running. Start the stack and retry."
  fi
  ok "Container $name is up"
}

# -- 0. Preflight -----------------------------------------------------------

echo "=== Preflight ==="
require_container "$DB_CONTAINER"
require_container "$API_CONTAINER"
require_container "$WEB_CONTAINER"

# Verify connectivity to the DB.
if ! docker exec -e PGPASSWORD="$DB_PASSWORD" -i "$DB_CONTAINER" \
     psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT 1;" >/dev/null 2>&1; then
  die "Cannot connect to $DB_CONTAINER as user $DB_USER. Check DB_PASSWORD."
fi
ok "DB connectivity OK"

# Show current migration state.
info "Current migration table state:"
run_psql -c "SELECT migration_name, finished_at IS NOT NULL AS done, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at DESC LIMIT 10;"

# -- 1. Inventory duplicates ------------------------------------------------

echo
echo "=== Inventory ==="
DUP_COUNT=$(run_psql -c "
  SELECT COUNT(*) FROM (
    SELECT 1 FROM \"Measurement\"
    GROUP BY \"userId\", metric, \"recordedAt\"
    HAVING COUNT(*) > 1
  ) s;
")
ROWS_TO_DELETE=$(run_psql -c "
  SELECT COALESCE(SUM(c-1), 0) FROM (
    SELECT COUNT(*) c FROM \"Measurement\"
    GROUP BY \"userId\", metric, \"recordedAt\"
    HAVING COUNT(*) > 1
  ) s;
")
echo "Duplicate triples:      $DUP_COUNT"
echo "Rows that will be deleted: $ROWS_TO_DELETE"

if [[ "$DUP_COUNT" == "0" ]]; then
  ok "No duplicates — the migration should already work. Skipping dedup."
else
  info "Top 10 duplicate triples:"
  run_psql -c "
    SELECT
      LEFT(\"userId\", 12) || '..' AS user,
      metric,
      \"recordedAt\",
      COUNT(*) AS cnt
    FROM \"Measurement\"
    GROUP BY \"userId\", metric, \"recordedAt\"
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 10;
  "
fi

# -- 2. Dedupe --------------------------------------------------------------

if [[ "$DRY_RUN" == "1" ]]; then
  info "DRY_RUN=1 — skipping dedup DELETE."
else
  if [[ "$DUP_COUNT" != "0" ]]; then
    info "Deleting duplicates (keeping earliest copy by ctid)..."
    DELETED=$(run_psql -c "
      DELETE FROM \"Measurement\" m
      USING \"Measurement\" dup
      WHERE m.ctid > dup.ctid
        AND m.\"userId\"     = dup.\"userId\"
        AND m.metric       = dup.metric
        AND m.\"recordedAt\" = dup.\"recordedAt\";
    " | grep -E '^DELETE [0-9]+$' | awk '{print $2}')
    ok "Deleted $DELETED duplicate rows."

    # Re-verify
    REMAINING=$(run_psql -c "
      SELECT COUNT(*) FROM (
        SELECT 1 FROM \"Measurement\"
        GROUP BY \"userId\", metric, \"recordedAt\"
        HAVING COUNT(*) > 1
      ) s;
    ")
    ok "Remaining duplicates: $REMAINING (expected 0)"
  fi
fi

# -- 3. Mark the failed migration as rolled-back ---------------------------

echo
echo "=== Marking migration rolled-back ==="
if [[ "$DRY_RUN" == "1" ]]; then
  info "DRY_RUN=1 — skipping UPDATE."
else
  MARKED=$(run_psql -c "
    UPDATE _prisma_migrations
    SET finished_at = NULL, rolled_back_at = NOW()
    WHERE migration_name = '$FAILED_MIGRATION'
      AND finished_at IS NULL
      AND rolled_back_at IS NULL;
  " | grep -E '^UPDATE [0-9]+$' | awk '{print $2}')
  ok "Marked $FAILED_MIGRATION rolled-back (rows: ${MARKED:-0})"
fi

# -- 4. Run prisma migrate deploy inside the api container ----------------
# docker exec requires the container to be RUNNING, so we start it
# (in case it's stopped), exec the migrate, then leave it running.
# Previously this script stopped the container first — that was a
# bug because docker exec fails on a stopped container.

echo
echo "=== Running prisma migrate deploy ==="
if [[ "$DRY_RUN" == "1" ]]; then
  info "DRY_RUN=1 — skipping restart + migrate."
else
  # Make sure the api container is running (idempotent — `docker start`
  # is a no-op if already running).
  if ! docker ps --format '{{.Names}}' | grep -qx "$API_CONTAINER"; then
    info "Starting $API_CONTAINER (was stopped)..."
    docker start "$API_CONTAINER" >/dev/null
    sleep 2
  fi
  ok "$API_CONTAINER is running"

  info "Running prisma migrate deploy inside $API_CONTAINER..."
  if run_in_api npx prisma migrate deploy 2>&1 | tee /tmp/prisma-migrate.log; then
    ok "migrate deploy succeeded"
  else
    die "prisma migrate deploy returned non-zero. Check /tmp/prisma-migrate.log"
  fi
fi

# -- 5. Verify --------------------------------------------------------------

echo
echo "=== Verify ==="
sleep 2
# Hit /health from inside the api container so we don't have to fish
# the docker network IP out of `docker inspect`. curl is in the
# node:20-slim image so it's always available.
HEALTH_CODE=$(docker exec "$API_CONTAINER" \
  sh -c 'curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/health' 2>/dev/null || echo "000")
ok "Health check returned: $HEALTH_CODE"

info "Final migration state:"
run_psql -c "SELECT migration_name, finished_at IS NOT NULL AS done, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at DESC LIMIT 12;"

echo
echo "=== Cleanup (optional, visual only) ==="
echo "29 pre-v1 Skill rows are still in the DB. They'll render under an"
echo "'Other' column on SkillTree. To clean them up:"
echo
echo "  docker exec -e PGPASSWORD=$DB_PASSWORD -i $DB_CONTAINER \\"
echo "    psql -U $DB_USER -d $DB_NAME -c 'DELETE FROM \"Skill\" WHERE branch IS NULL;'"
echo
ok "Done."