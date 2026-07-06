#!/usr/bin/env bash
#
# sync-android.sh — wrapper to invoke ../fitquest-android/scripts/sync-android.sh
# from this repo. Keeps the android release flow discoverable from
# where the web/api work happens.
#
# Usage:
#   ./scripts/sync-android.sh                  # refresh notes for current Android version
#   BUMP=1 ./scripts/sync-android.sh           # auto-bump patch + refresh notes
#   NEXT_VERSION=1.0.4 ./scripts/sync-android.sh
#
# The wrapper only stages artifacts (CHANGELOG.md, release notes
# draft, app/build.gradle bump). It does NOT run gradle / sign /
# publish — those stay manual per the user's "don't build the apk
# yet" guardrail.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_REPO="${ANDROID_REPO:-}"

if [[ -z "$ANDROID_REPO" ]]; then
  # Default: try sibling checkout. The user's tree has both repos
  # under /home/josh/claw-code/.
  for candidate in ../fitquest-android /home/josh/claw-code/fitquest-android; do
    if [[ -d "$REPO_ROOT/$candidate" ]]; then
      ANDROID_REPO="$(cd "$REPO_ROOT/$candidate" && pwd)"
      break
    fi
  done
fi

if [[ -z "$ANDROID_REPO" || ! -d "$ANDROID_REPO" ]]; then
  echo "ERROR: Could not find fitquest-android checkout. Set ANDROID_REPO=/path." >&2
  exit 1
fi

if [[ ! -x "$ANDROID_REPO/scripts/sync-android.sh" ]]; then
  echo "ERROR: $ANDROID_REPO/scripts/sync-android.sh not found or not executable." >&2
  exit 1
fi

# PARENT_REPO points at THIS repo so the android script reads the
# right git history. Forward all BUMP / NEXT_VERSION / SINCE env.
export PARENT_REPO="$REPO_ROOT"
exec "$ANDROID_REPO/scripts/sync-android.sh" "$@"