#!/usr/bin/env bash
# Diagnostic for "why does FitQuestBridge lose its permissions / su?"
#
# Single-device setup: no $PHONE variable needed. Piped straight
# to `adb shell` (no -s needed on single-device hosts).
#
# What each block is checking:
#   1. pm dump — App framework state (MODE_RESTRICTED/FROZEN/etc.)
#   2. cmd appops get — the kernel-level capability the bridge
#      actually checks at read time. MANAGE_EXTERNAL_STORAGE here
#      is what /import/batch-style file IO looks at.
#   3. dumpsys package — package-level flags (stopped, hidden,
#      restricted). `stopped=true` is the smoking gun if Android
#      force-stopped the bridge at some point.
#   4. magisk DenyList + superuser list — confirm FitQuestBridge
#      isn't being silently root-blocked.
#   5. logcat — the bridge's own logs (FitQuestBridge:V) plus
#      PackageManager's denied/restricted broadcasts and any
#      ActivityManager warnings about the bridge.
#
# Usage: just run it. Output is dense but skimmable.

set -u

echo "=== 1. pm dump — framework state ==="
echo "(grep filters to keep only FitQuestBridge-relevant rows;"
echo " ignore the LineageOS overlay rows — every app has them.)"
adb shell pm dump com.fitquest.bridge \
    | grep -E "MODE_(RESTRICTED|FOREGROUND|FROZEN|PAUSED|QUIET|UNUSED)|disabled=true|hidden=true|forceStop|frozen|hibernat" \
    | head -15

echo
echo "=== 2. cmd appops get — runtime permissions ==="
echo "(MANAGE_EXTERNAL_STORAGE = storage, RUN_ANY_IN_BACKGROUND ="
echo " whether the OS lets your foreground service run normally.)"
adb shell cmd appops get com.fitquest.bridge MANAGE_EXTERNAL_STORAGE
adb shell cmd appops get com.fitquest.bridge RUN_ANY_IN_BACKGROUND
adb shell cmd appops get com.fitquest.bridge RUN_IN_BACKGROUND
adb shell cmd appops get com.fitquest.bridge POST_NOTIFICATION

echo
echo "=== 3. dumpsys package — package flags ==="
adb shell dumpsys package com.fitquest.bridge \
    | grep -E "stopped=|notLaunched=|restricted=|disabled=|hidden=|firstInstall|userId=" \
    | head -10

echo
echo "=== 4. Magisk — DenyList + superuser grants ==="
echo "(If 'fitquest' shows up in either list, Magisk is silently"
echo " blocking root or otherwise gating the app.)"
adb shell su -c "magisk --denylist ls 2>/dev/null | grep -iE 'fit|pip' || echo '  (not in DenyList)'"
echo
adb shell su -c "magisk --sulist 2>/dev/null | grep -iE 'fit|pip' || echo '  (no FitQuestBridge superuser grants yet)'"

echo
echo "=== 5. logcat — bridge + system messages ==="
echo "(Looking for explicit denial messages, force-stop broadcasts,"
echo " or AppOps changes that would tell us when the revoke happened.)"
adb logcat -d -s PackageManager:I ActivityManager:W FitQuestBridge:V \
    | tail -40