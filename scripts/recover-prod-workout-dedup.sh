#!/usr/bin/env bash
# Recovery script for Workout duplicates introduced by an
# uncontrolled FIT re-import flood (e.g. the FitQuestBridge APK
# running without a unique constraint on the Workout table, then
# uploading every .fit multiple times before the user noticed).
#
# Companion to scripts/recover-prod-measurement-migration.sh —
# same docker + creds conventions.
#
# What it does (all idempotent + re-runnable):
#   1. Sanity-checks the three containers.
#   2. Inventories duplicates on the Workout table (same
#      (userId, performedAt) as the natural key — same user,
#      same start time = same session; the FIT importer sets
#      performedAt = session.startTime so a re-import creates
#      identical rows).
#   3. Deletes duplicates keeping the earliest copy by ctid
#      (so we keep the row that was created first, which is
#      usually the most semantically-correct one — e.g. it
#      has the auto-populated `notes` from the original sync).
#   4. Optionally adds a UNIQUE constraint on
#      (userId, performedAt) so future re-imports dedupe at
#      the DB level (Workout persist still calls `create`, so
#      without the constraint every duplicate is a new row;
#      with it, the second insert fails loudly and we can
#      migrate to upsert later).
#
# Run from the project root:
#   bash scripts/recover-prod-workout-dedup.sh            # apply
#   bash scripts/recover-prod-workout-dedup.sh --no-constraint  # dedup only, no schema change
#   DRY_RUN=1 bash scripts/recover-prod-workout-dedup.sh  # show what would happen
#
# Environment overrides:
#   DB_CONTAINER  — default: fitquest-db
#   API_CONTAINER — default: fitquest-api
#   DB_USER, DB_NAME, DB_PASSWORD — see existing recovery script
#   APPLY_CONSTRAINT=0 — skip the unique-index creation step
#                        (equivalent to --no-constraint)

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-fitquest-db}"
API_CONTAINER="${API_CONTAINER:-fitquest-api}"
DB_USER="${DB_USER:-fitness}"
DB_NAME="${DB_NAME:-fitquest}"
DB_PASSWORD="${DB_PASSWORD:-fitness}"
DRY_RUN="${DRY_RUN:-0}"
APPLY_CONSTRAINT="${APPLY_CONSTRAINT:-1}"

# Parse simple flags so the script can be invoked from the docs
# without remembering env var names.
for arg in "$@"; do
    case "$arg" in
        --no-constraint) APPLY_CONSTRAINT=0 ;;
        --dry-run)        DRY_RUN=1 ;;
        *) echo "unknown arg: $arg" >&2; exit 1 ;;
    esac
done

export PGPASSWORD="$DB_PASSWORD"

die() { echo ""; echo "✗ $*" >&2; echo ""; exit 1; }
ok()  { echo "✓ $*"; }
info(){ echo "→ $*"; }
warn(){ echo "⚠ $*" >&2; }

run_psql() {
    docker exec -e PGPASSWORD="$DB_PASSWORD" -i "$DB_CONTAINER" \
        psql -U "$DB_USER" -d "$DB_NAME" -tA -v ON_ERROR_STOP=1 "$@"
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

if ! docker exec -e PGPASSWORD="$DB_PASSWORD" -i "$DB_CONTAINER" \
     psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT 1;" >/dev/null 2>&1; then
    die "Cannot connect to $DB_CONTAINER as user $DB_USER. Check DB_PASSWORD."
fi
ok "DB connectivity OK"

# -- 1. Inventory duplicates on Workout ------------------------------------

echo
echo "=== Workout duplicate inventory ==="
echo "(natural key: userId + performedAt — same user, same start time)"

DUP_TRIPLES=$(run_psql -c "
    SELECT COUNT(*) FROM (
        SELECT 1 FROM \"Workout\"
        GROUP BY \"userId\", \"performedAt\"
        HAVING COUNT(*) > 1
    ) s;
")
# Each duplicate "triple" (s/user-time-group) expands to N-1
# redundant rows. Total deletions = sum(c-1) across groups.
ROWS_TO_DELETE=$(run_psql -c "
    SELECT COALESCE(SUM(c-1), 0) FROM (
        SELECT COUNT(*) c FROM \"Workout\"
        GROUP BY \"userId\", \"performedAt\"
        HAVING COUNT(*) > 1
    ) s;
")

# Also count by user so the user sees how big the damage is per
# account.
PER_USER=$(run_psql -c "
    SELECT u.\"username\", COUNT(*) AS dup_rows
    FROM \"Workout\" w
    JOIN \"User\" u ON u.id = w.\"userId\"
    GROUP BY u.\"username\"
    HAVING COUNT(*) > 1
    ORDER BY dup_rows DESC
    LIMIT 10;
")

echo "Duplicate (userId, performedAt) triples: $DUP_TRIPLES"
echo "Workout rows that will be deleted:       $ROWS_TO_DELETE"
if [[ -n "$PER_USER" ]]; then
    echo
    echo "Top affected users:"
    echo "$PER_USER" | while IFS='|' read -r user count; do
        echo "  $user: $count duplicate rows"
    done
fi

if [[ "$DUP_TRIPLES" == "0" ]]; then
    ok "No Workout duplicates — nothing to clean up."
fi

# Show a few sample duplicates so the user can sanity-check the
# natural key is doing what they expect (multiple identical
# start times = same session).
if [[ "$DUP_TRIPLES" != "0" ]]; then
    info "Sample duplicates (first 5):"
    run_psql -c "
        SELECT
            LEFT(\"userId\", 12) || '..' AS user,
            \"performedAt\",
            \"type\",
            \"name\",
            \"duration\",
            COUNT(*) AS cnt
        FROM \"Workout\"
        GROUP BY \"userId\", \"performedAt\", \"type\", \"name\", \"duration\"
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC, \"performedAt\" DESC
        LIMIT 5;
    "
fi

# -- 2. Dedupe --------------------------------------------------------------

if [[ "$DRY_RUN" == "1" ]]; then
    info "DRY_RUN=1 — skipping DELETE. Re-run without DRY_RUN to apply."
elif [[ "$DUP_TRIPLES" != "0" ]]; then
    info "Deleting duplicates (keeping earliest copy by ctid)..."
    DELETED=$(run_psql -c "
        DELETE FROM \"Workout\" w
        USING \"Workout\" dup
        WHERE w.ctid > dup.ctid
          AND w.\"userId\"      = dup.\"userId\"
          AND w.\"performedAt\" = dup.\"performedAt\";
    " | grep -E '^DELETE [0-9]+$' | awk '{print $2}')
    ok "Deleted ${DELETED:-0} duplicate Workout rows."

    REMAINING=$(run_psql -c "
        SELECT COUNT(*) FROM (
            SELECT 1 FROM \"Workout\"
            GROUP BY \"userId\", \"performedAt\"
            HAVING COUNT(*) > 1
        ) s;
    ")
    if [[ "$REMAINING" != "0" ]]; then
        die "$REMAINING duplicate triples remain after dedup. Investigate manually."
    fi
    ok "All Workout duplicates resolved."
fi

# -- 3. Optional: add UNIQUE constraint on (userId, performedAt) ---------

echo
echo "=== Unique constraint (optional) ==="
# Only attempt the constraint if dedup actually ran to completion
# (i.e. duplicates are now 0). Otherwise we'd hit the "key X is
# duplicated" error and the whole script would fail with no useful
# output. In DRY_RUN mode the dedup doesn't run, so duplicates
# are nonzero, so we skip.
SKIP_CONSTRAINT_REASON=""
if [[ "$DRY_RUN" == "1" ]]; then
    SKIP_CONSTRAINT_REASON="DRY_RUN=1 (dedup didn't run, duplicates remain)"
elif [[ "$APPLY_CONSTRAINT" == "0" ]]; then
    SKIP_CONSTRAINT_REASON="APPLY_CONSTRAINT=0 --no-constraint was passed"
fi

if [[ -n "$SKIP_CONSTRAINT_REASON" ]]; then
    info "Skipping constraint: $SKIP_CONSTRAINT_REASON"
    warn "Re-run without DRY_RUN and after dedup completes to apply."
else
    # Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS so re-running
    # the script doesn't error if it was already applied.
    info "Adding unique index on (userId, performedAt)..."
    run_psql -c "
        CREATE UNIQUE INDEX IF NOT EXISTS \"Workout_userId_performedAt_key\"
        ON \"Workout\"(\"userId\", \"performedAt\");
    " >/dev/null
    ok "Index ensured on (userId, performedAt)."
    warn "The FIT persist path still calls prisma.workout.create()."
    warn "With this index, a duplicate INSERT raises a Postgres"
    warn "unique-violation error (23505) — loud failure, no silent"
    warn "duplicate rows. The proper fix is to migrate persist.ts"
    warn "to use upsert; for now the constraint catches the bug at"
    warn "import time instead of letting duplicates slip through."
fi

# -- 4. Verify --------------------------------------------------------------

echo
echo "=== Verify ==="
DUP_AFTER=$(run_psql -c "
    SELECT COUNT(*) FROM (
        SELECT 1 FROM \"Workout\"
        GROUP BY \"userId\", \"performedAt\"
        HAVING COUNT(*) > 1
    ) s;
")
TOTAL_AFTER=$(run_psql -c "SELECT COUNT(*) FROM \"Workout\";")
ok "Workout rows total after cleanup: $TOTAL_AFTER"
ok "Duplicate triples remaining:       $DUP_AFTER"

info "Final migration state (last 5):"
run_psql -c "SELECT migration_name, finished_at IS NOT NULL AS done, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;"

ok "Workout dedup complete."