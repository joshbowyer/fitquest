/**
 * Web notifications bus — opt-in browser notifications for the
 * same events that play sound. Parallel to soundBus.ts: same
 * event name, same architectural shape, but the transport is
 * the Notification API instead of AudioContext.
 *
 * Foreground only in this version. The Notification API shows a
 * system-level toast / banner even when the tab is in the
 * background (within the browser), as long as permission has
 * been granted. For native push delivery (when the browser is
 * closed entirely), a Service Worker + VAPID push subscription
 * is required — out of scope for v1; the user-facing trigger
 * surface is the same.
 *
 * Opt-in flow:
 *   - User enables in Settings → page calls requestPermission()
 *     which shows the browser's native permission prompt.
 *   - User grants → fire a single test notification so they
 *     know it works.
 *   - User denies (or dismisses) → bus stays silent, persists
 *     "denied" so we don't re-prompt.
 *
 * State persists to localStorage:
 *   fitquest:notify:enabled — '1' / '0'
 *   fitquest:notify:permission — 'granted' / 'denied' / 'default'
 */

export type NotifyEvent = 'shieldDrop' | 'breachDefeat' | 'bossKill' | 'lootDrop' | 'levelUp' | 'achievement' | 'skillUnlock' | 'workoutComplete' | 'restTimerDone' | 'streakBreak';

// Per-event titles + body. Kept short — system notifications
// truncate at ~80 chars on most platforms.
const EVENT_COPY: Record<NotifyEvent, { title: string; body: string; tag: string }> = {
  shieldDrop: {
    title: '⚠ Shield dropped',
    body: 'Home base is exposed. Patch the damage before it cascades.',
    tag: 'fitquest-shield',
  },
  breachDefeat: {
    title: '✗ Breach defeated',
    body: 'The Maw is down. Worlds cleared. Loot incoming.',
    tag: 'fitquest-breach',
  },
  bossKill: {
    title: '☠ Boss killed',
    body: 'World boss defeated. Check your raid log for the kill breakdown.',
    tag: 'fitquest-boss',
  },
  lootDrop: {
    title: '✧ Loot dropped',
    body: 'A new item dropped from the encounter. Open inventory to equip.',
    tag: 'fitquest-loot',
  },
  levelUp: {
    title: '✦ Level up',
    body: 'New tier. New thresholds. New screen.',
    tag: 'fitquest-levelup',
  },
  achievement: {
    title: '★ Achievement',
    body: 'New badge unlocked. Check the achievements panel.',
    tag: 'fitquest-achievement',
  },
  skillUnlock: {
    title: '✦ Skill unlocked',
    body: 'New class ability. Check the skill tree.',
    tag: 'fitquest-skill',
  },
  workoutComplete: {
    title: '⚔ Workout committed',
    body: 'PRs updated. Shield bumped. Recovery timer started.',
    tag: 'fitquest-workout',
  },
  restTimerDone: {
    title: '⏱ Rest done',
    body: 'Back to it. Next set is waiting.',
    tag: 'fitquest-rest',
  },
  streakBreak: {
    title: '— Streak broken',
    body: 'A daily slipped. Quick re-start to rebuild the chain.',
    tag: 'fitquest-streak',
  },
};

const STORAGE_KEY_ENABLED = 'fitquest:notify:enabled';
const STORAGE_KEY_PERMISSION = 'fitquest:notify:permission';

let enabled = false;
let permission: NotificationPermission = 'default';

try {
  enabled = localStorage.getItem(STORAGE_KEY_ENABLED) === '1';
} catch {
  // localStorage unavailable — default to off.
}

try {
  // Best-effort: read the current browser permission. On
  // first run this is 'default' (not yet asked).
  if (typeof Notification !== 'undefined') {
    permission = Notification.permission;
  }
} catch {
  // SSR / disabled.
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY_ENABLED, enabled ? '1' : '0');
    localStorage.setItem(STORAGE_KEY_PERMISSION, permission);
  } catch {
    // silent
  }
}

/**
 * Request browser notification permission. Returns the resulting
 * permission state (granted / denied / default). No-op when the
 * browser doesn't support the API.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  try {
    const result = await Notification.requestPermission();
    permission = result;
    persist();
    return result;
  } catch {
    return 'denied';
  }
}

/**
 * Fire a system notification for the given event. No-op when:
 *   - the user hasn't enabled notifications in Settings
 *   - the browser doesn't support the API
 *   - permission isn't granted (would throw)
 *   - the tab is visible AND focused (don't notify for things
 *     the user can already see in the UI)
 */
export function emitNotification(event: NotifyEvent): void {
  if (!enabled) return;
  if (typeof Notification === 'undefined') return;
  if (permission !== 'granted') return;
  // Skip when the tab is currently visible + focused — the user
  // is already looking at the app. Notifications are most useful
  // when the user has the tab in the background (different tab,
  // other app, screen locked).
  if (typeof document !== 'undefined') {
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      return;
    }
  }
  const copy = EVENT_COPY[event];
  try {
    new Notification(copy.title, {
      body: copy.body,
      tag: copy.tag, // collapses multiple into one (browser dedup)
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      silent: false,
    });
  } catch {
    // silent — some browsers throw on too-frequent notifications
  }
}

export function setNotificationsEnabled(value: boolean) {
  enabled = value;
  persist();
}

export function isNotificationsEnabled(): boolean {
  return enabled;
}

export function getNotificationPermission(): NotificationPermission {
  return permission;
}

// =============================================================
// React hook: fire a notification when a polled value changes.
// =============================================================
//
// Several game events are server-driven (shield drop from a
// penance event, breach defeat, boss kill, loot drop, streak
// break) and the client doesn't currently have a websocket /
// SSE to learn about them in real time. The cheapest "good
// enough" delivery for foreground-only notifications is to poll
// the relevant endpoint and fire a notification on a change.
//
// Usage:
//   const { data } = useQuery({ queryKey: ['homebase'], ... });
//   useValueChange(data?.shieldValue, (newVal, oldVal) => {
//     if (newVal != null && oldVal != null && newVal < oldVal) {
//       emitNotification('shieldDrop');
//     }
//   });
//
// The callback is only fired when both old and new values are
// defined AND different — guards against first-mount (oldVal ===
// undefined) and against no-op renders.

import { useEffect, useRef } from 'react';

export function useValueChange<T>(
  value: T,
  onChange: (newValue: T, oldValue: T | undefined) => void,
  isEqual: (a: T, b: T) => boolean = Object.is,
): void {
  const prevRef = useRef<T | undefined>(undefined);
  useEffect(() => {
    const prev = prevRef.current;
    if (prev !== undefined && !isEqual(value, prev)) {
      onChange(value, prev);
    }
    prevRef.current = value;
  }, [value, onChange, isEqual]);
}
