#!/usr/bin/env bash
# Recovery for the failed workout_unique migration. The dedup
# script's "triples" filter is misleading — it only counts groups
# of 3+, but the UNIQUE constraint fails on ANY duplicate (groups
# of 2+). LobsterWrangler likely has 31 rows in pairs, not triples.
#
# 1. Show what's actually in _prisma_migrations for the failed row
# 2. Find all duplicate groups (not just triples)
# 3. Delete the duplicates keeping the earliest by ctid
# 4. Delete the failed migration row(s) so prisma can retry
# 5. Print the ready-to-restart state
#
# Idempotent + re-runnable.

set -euo pipefail
DB_CONTAINER="${DB_CONTAINER:-fitquest-db}"
API_CONTAINER="${API_CONTAINER:-fitquest-api}"
DB_USER="${DB_USER:-fitness}"
DB_NAME="${DB_NAME:-fitquest}"
DB_PASSWORD="${DB_PASSWORD:-fitness}"
export PGPASSWORD="$DB_PASSWORD"

die() { echo ""; echo "✗ $*" >&2; echo ""; exit 1; }
ok()  { echo "✓ $*"; }
info(){ echo "→ $*"; }

require_container() {
    local name="$1"
    if ! docker ps --format '{{.Names}}' | grep -qx "$name"; then
        die "Container '$name' is not running. Start the stack and retry."
    fi
    ok "Container $name is up"
}

# -- 0. Preflight -----------------------------------------------------------

require_container "$DB_CONTAINER"
require_container "$API_CONTAINER"

if ! docker exec -e PGPASSWORD="$DB_PASSWORD" -i "$DB_CONTAINER" \
     psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT 1;" >/dev/null 2>&1; then
    die "Cannot connect to $DB_CONTAINER as user $DB_USER. Check DB_PASSWORD."
fi
ok "DB connectivity OK"

run_psql() {
  # Use a here-string instead of `psql -c "$1"`. psql's -c flag
  # treats newlines in the argument as separate commands and
  # prints 'extra command-line argument ignored' warnings on
  # multi-line SQL. The here-string passes the SQL as stdin,
  # which is robust for any SQL shape.
  docker exec -e PGPASSWORD="$DB_PASSWORD" -i "$DB_CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -tA -v ON_ERROR_STOP=1 <<< "$1"
}

echo "=== 1. Current state of _prisma_migrations for the failed row ==="
run_psql "
  SELECT migration_name,
         finished_at IS NOT NULL AS finished,
         rolled_back_at IS NOT NULL AS rolled_back,
         started_at::text
  FROM \"_prisma_migrations\"
  WHERE migration_name = '20260702120000_workout_unique_per_user_time'
  ORDER BY started_at;"

echo
echo "=== 2. All duplicate (userId, performedAt) groups (any size > 1) ==="
run_psql "
  SELECT \"userId\", \"performedAt\"::text, COUNT(*) AS cnt
  FROM \"Workout\"
  GROUP BY \"userId\", \"performedAt\"
  HAVING COUNT(*) > 1
  ORDER BY cnt DESC
  LIMIT 20;"

DUPS=$(run_psql "
  SELECT COALESCE(SUM(c-1), 0) FROM (
    SELECT COUNT(*) c FROM \"Workout\"
    GROUP BY \"userId\", \"performedAt\"
    HAVING COUNT(*) > 1
  ) s;")

echo
if [[ "$DUPS" == "0" ]]; then
  echo "No duplicates — safe to clean up migration row + restart."
else
  echo "=== 3. Deleting $DUPS duplicate rows (keeping earliest by ctid) ==="
  DELETED=$(run_psql "
    DELETE FROM \"Workout\" w
    USING (
      SELECT MIN(ctid) AS keep_ctid, \"userId\", \"performedAt\"
      FROM \"Workout\"
      GROUP BY \"userId\", \"performedAt\"
      HAVING COUNT(*) > 1
    ) k
    WHERE w.\"userId\" = k.\"userId\"
      AND w.\"performedAt\" = k.\"performedAt\"
      AND w.ctid <> k.keep_ctid;
  ")
  echo "  deleted $DELETED rows"
fi

echo
echo "=== 4. Clearing failed migration row(s) so prisma retries it ==="
DELETED=$(run_psql "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20260702120000_workout_unique_per_user_time';")
echo "  cleared $DELETED migration row(s)"

echo
echo "=== 4.5. Drop the dedup's leftover UNIQUE INDEX (if present) ==="
# The dedup script creates a `CREATE UNIQUE INDEX ... Workout_userId_performedAt_key`.
# Postgres disallows an INDEX and a CONSTRAINT with the same name
# on the same table — the migration's `ADD CONSTRAINT ... UNIQUE`
# would fail with "relation already exists". Drop the index so
# the migration can create its own constraint cleanly.
DROPPED=$(run_psql "DROP INDEX IF EXISTS \"Workout_userId_performedAt_key\";")
echo "  dropped index: $DROPPED"

echo
echo "=== 5. Verify state ==="
run_psql "
  SELECT \"userId\", \"performedAt\"::text, COUNT(*) AS cnt
  FROM \"Workout\"
  GROUP BY \"userId\", \"performedAt\"
  HAVING COUNT(*) > 1
  ORDER BY cnt DESC
  LIMIT 5;"
echo "(no rows = no duplicates left)"
echo
echo "Now restart the api container — its entrypoint will run"
echo "prisma migrate deploy, which will retry the migration."
