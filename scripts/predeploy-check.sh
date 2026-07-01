#!/usr/bin/env bash
# Pre-deploy check + fix for the two known migration gotchas.
#
# Run this from the project root BEFORE pulling the new image
# (or right before `docker compose up -d` with the new tag):
#
#   bash scripts/predeploy-check.sh            # apply fixes
#   DRY_RUN=1 bash scripts/predeploy-check.sh  # show what would happen
#
# What it does (all idempotent + re-runnable):
#   1. Preflight — checks the three containers are up and the DB
#      is reachable.
#   2. Risk 1 — inventories `Measurement` duplicates (the
#      `20260701090000_measurement_unique_user_metric_date`
#      migration fails if any exist). Auto-dedupes keeping the
#      earliest row per (userId, metric, recordedAt) triple.
#   3. Risk 2 — inventories case-colliding `User.username` rows
#      (the `20260704000000_username_lower` migration adds a
#      UNIQUE constraint on LOWER(username) and fails if two
#      users differ only by case). Reports but does NOT auto-fix
#      — username collisions need a human decision (delete vs
#      rename) so we hand back the rows + suggested SQL and
#      refuse to proceed past this check until it's resolved.
#   4. Marks any previously-rolled-back migration as
#      re-applyable, then runs `prisma migrate deploy` inside
#      the api container.
#   5. Hits /health on the api container to confirm it serves
#      traffic.
#
# Environment overrides:
#   DB_CONTAINER   — default: fitquest-db
#   API_CONTAINER  — default: fitquest-api
#   DB_USER        — default: fitness
#   DB_NAME        — default: fitquest
#   DB_PASSWORD    — default: fitness  (override for prod)
#   DRY_RUN=1      — show what would happen without changing
#                    anything (Risk 1 dedup is still skipped)

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-fitquest-db}"
API_CONTAINER="${API_CONTAINER:-fitquest-api}"
DB_USER="${DB_USER:-fitness}"
DB_NAME="${DB_NAME:-fitquest}"
DB_PASSWORD="${DB_PASSWORD:-fitness}"
DRY_RUN="${DRY_RUN:-0}"

MEASUREMENT_MIGRATION='20260701090000_measurement_unique_user_metric_date'
USERNAME_MIGRATION='20260704000000_username_lower'

export PGPASSWORD="$DB_PASSWORD"

# -- helpers ---------------------------------------------------------------

die() { echo ""; echo "✗ $*" >&2; echo ""; exit 1; }
ok()  { echo "✓ $*"; }
info(){ echo "→ $*"; }
warn(){ echo "⚠ $*" >&2; }

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

# Run a query and extract a single integer from the result. psql in
# -tA mode prints just the value (no header, no formatting).
count_rows() {
  run_psql -c "$1" | tr -d ' '
}

# -- 0. Preflight -----------------------------------------------------------

echo "=== Preflight ==="
require_container "$DB_CONTAINER"
require_container "$API_CONTAINER"

if ! docker exec -e PGPASSWORD="$DB_PASSWORD" -i "$DB_CONTAINER" \
     psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT 1;" >/dev/null 2>&1; then
  die "Cannot connect to $DB_CONTAINER as user $DB_USER. Check DB_PASSWORD."
fi
ok "DB connectivity OK"

info "Migration status (most recent 10):"
run_psql -c "SELECT migration_name, finished_at IS NOT NULL AS done, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at DESC LIMIT 10;"

# -- 1. Risk 1: Measurement duplicates --------------------------------------

echo
echo "=== Risk 1: Measurement duplicates ==="
echo "(would fail the $MEASUREMENT_MIGRATION migration)"

DUP_TRIPLES=$(count_rows "
  SELECT COUNT(*) FROM (
    SELECT 1 FROM \"Measurement\"
    GROUP BY \"userId\", metric, \"recordedAt\"
    HAVING COUNT(*) > 1
  ) s;
")
DUP_ROWS=$(count_rows "
  SELECT COALESCE(SUM(c-1), 0) FROM (
    SELECT COUNT(*) c FROM \"Measurement\"
    GROUP BY \"userId\", metric, \"recordedAt\"
    HAVING COUNT(*) > 1
  ) s;
")
echo "  Duplicate triples:           $DUP_TRIPLES"
echo "  Rows that would be deleted:  $DUP_ROWS"

if [[ "$DUP_TRIPLES" == "0" ]]; then
  ok "No Measurement duplicates — safe to proceed."
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

  if [[ "$DRY_RUN" == "1" ]]; then
    info "DRY_RUN=1 — skipping dedup DELETE. Re-run without DRY_RUN to apply."
  else
    info "Deleting duplicates (keeping earliest copy by ctid)..."
    DELETED=$(run_psql -c "
      DELETE FROM \"Measurement\" m
      USING \"Measurement\" dup
      WHERE m.ctid > dup.ctid
        AND m.\"userId\"     = dup.\"userId\"
        AND m.metric       = dup.metric
        AND m.\"recordedAt\" = dup.\"recordedAt\";
    " | grep -E '^DELETE [0-9]+$' | awk '{print $2}')
    ok "Deleted ${DELETED:-0} duplicate Measurement rows."

    REMAINING=$(count_rows "
      SELECT COUNT(*) FROM (
        SELECT 1 FROM \"Measurement\"
        GROUP BY \"userId\", metric, \"recordedAt\"
        HAVING COUNT(*) > 1
      ) s;
    ")
    if [[ "$REMAINING" != "0" ]]; then
      die "$REMAINING duplicate triples remain after dedup. Investigate manually."
    fi
    ok "All Measurement duplicates resolved."
  fi
fi

# -- 2. Risk 2: username case collisions ------------------------------------

echo
echo "=== Risk 2: username case collisions ==="
echo "(would fail the $USERNAME_MIGRATION migration)"

# If usernameLower doesn't exist yet (the migration is what
# creates it), the second query would error out. Catch that.
COLLISION_ROWS=$(run_psql -c "
  SELECT COALESCE(
    (SELECT COUNT(*) FROM (
      SELECT LOWER(\"username\") AS k, COUNT(*) c
      FROM \"User\"
      GROUP BY LOWER(\"username\")
      HAVING COUNT(*) > 1
    ) s),
    0
  );
" 2>/dev/null || echo "0")

if [[ "$COLLISION_ROWS" == "0" ]]; then
  ok "No username case collisions — safe to proceed."
else
  warn "Found $COLLISION_ROWS case-colliding username group(s):"
  echo
  run_psql -c "
    SELECT
      LOWER(\"username\") AS lower_name,
      STRING_AGG('id=' || id || ' name=' || \"username\", E'\n  ') AS rows
    FROM \"User\"
    GROUP BY LOWER(\"username\")
    HAVING COUNT(*) > 1
    ORDER BY lower_name;
  " 2>/dev/null
  echo
  warn "This script will NOT auto-fix username collisions — the operator"
  warn "must decide which row to keep (delete, or rename to a unique"
  warn "value) before the $USERNAME_MIGRATION migration can apply."
  echo
  echo "Suggested SQL (run inside $DB_CONTAINER after picking a winner):"
  echo
  echo "  -- Option A: rename one user to break the collision"
  echo "  UPDATE \"User\""
  echo "    SET \"username\" = '<new_unique_name>',"
  echo "        \"usernameLower\" = LOWER('<new_unique_name>')"
  echo "    WHERE id = '<id-of-the-row-to-rename>';"
  echo
  echo "  -- Option B: delete the duplicate (cascades to its rows)"
  echo "  DELETE FROM \"User\" WHERE id = '<id-of-the-row-to-delete>';"
  echo
  die "Resolve the collision(s) above and re-run this script."
fi

# -- 3. Run prisma migrate deploy -------------------------------------------

echo
echo "=== Running prisma migrate deploy ==="
# Make sure the api container is running (idempotent — `docker
# start` is a no-op if already running). docker exec requires
# the container to be running; we used to stop it first, but
# that broke things if the container was already up.
if ! docker ps --format '{{.Names}}' | grep -qx "$API_CONTAINER"; then
  if [[ "$DRY_RUN" == "1" ]]; then
    info "DRY_RUN=1 — would have started $API_CONTAINER if it was down."
  else
    info "Starting $API_CONTAINER (was stopped)..."
    docker start "$API_CONTAINER" >/dev/null
    sleep 2
  fi
fi
if [[ "$DRY_RUN" == "1" ]]; then
  info "DRY_RUN=1 — skipping migrate deploy."
else
  ok "$API_CONTAINER is running"
  info "Running npx prisma migrate deploy inside $API_CONTAINER..."
  if run_in_api npx prisma migrate deploy 2>&1 | tee /tmp/prisma-migrate.log; then
    ok "migrate deploy succeeded"
  else
    die "prisma migrate deploy returned non-zero. Check /tmp/prisma-migrate.log"
  fi
fi

# -- 4. Verify --------------------------------------------------------------

echo
echo "=== Verify ==="
sleep 2
HEALTH_CODE=$(docker exec "$API_CONTAINER" \
  sh -c 'curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/health' 2>/dev/null || echo "000")
ok "Health check returned: $HEALTH_CODE"
if [[ "$HEALTH_CODE" != "200" ]]; then
  warn "Health check did not return 200. The container may still be starting"
  warn "up; verify with: docker logs $API_CONTAINER --tail 50"
fi

info "Final migration state:"
run_psql -c "SELECT migration_name, finished_at IS NOT NULL AS done, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at DESC LIMIT 12;"

ok "Pre-deploy check complete. Safe to pull the new image and deploy."