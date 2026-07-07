/**
 * Morning reminder — schedules a daily 8:00 AM local-time
 * notification via the @capacitor/local-notifications plugin.
 * The schedule persists across app restarts and works even
 * when the app is closed (Android's JobScheduler fires the
 * notification at the next 8 AM).
 *
 * Best-effort: silently no-ops if the plugin isn't available
 * (i.e. running in a regular browser tab during dev) or if
 * the user denies the permission prompt. No re-prompt on
 * denial — Android won't show the prompt again anyway.
 *
 * v1 hardcodes 8 AM. A future version could expose the time
 * in the existing Settings page (localStorage-backed) so the
 * user picks when to be reminded. For now, 8 AM is the
 * reasonable default — most people do their morning fitquest
 * check-in around then.
 */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const REMINDER_ID = 1001;
const REMINDER_HOUR = 8;
const REMINDER_MINUTE = 0;
const CHANNEL_ID = 'morning-reminder';

function next830am(): Date {
  // Compute the next 8:00 AM (or 8:30 with the 30-min offset
  // so it doesn't fire exactly at 8:00:00 — gives doze-mode
  // scheduling a few minutes of slack). Today if it's still in
  // the future, otherwise tomorrow.
  const now = new Date();
  const target = new Date(now);
  target.setHours(REMINDER_HOUR, REMINDER_MINUTE, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

export async function scheduleMorningReminder(): Promise<{ scheduled: boolean; reason?: string }> {
  // Only run inside the Capacitor Android runtime. In a
  // regular browser (dev mode) the plugin's web implementation
  // is a no-op but we still check explicitly so the call is
  // safe everywhere.
  if (Capacitor.getPlatform() !== 'android') {
    return { scheduled: false, reason: 'not-android' };
  }
  if (!Capacitor.isPluginAvailable('LocalNotifications')) {
    return { scheduled: false, reason: 'plugin-missing' };
  }

  // Create the channel (Android 8+ requirement; idempotent).
  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Morning Reminder',
    description: 'Daily nudge to check your fitquest dailies',
    importance: 4, // HIGH — heads-up notification, plays sound
    visibility: 1, // PUBLIC — shows on lock screen
    sound: 'default',
    vibration: true,
  });

  // Ask for permission. The plugin returns the current
  // permission state; 'prompt' means we haven't asked yet.
  // The user can deny — that's fine, we silently skip.
  const current = await LocalNotifications.checkPermissions();
  if (current.display === 'prompt' || current.display === 'prompt-with-rationale') {
    const next = await LocalNotifications.requestPermissions();
    if (next.display !== 'granted') {
      return { scheduled: false, reason: 'permission-denied' };
    }
  } else if (current.display !== 'granted') {
    return { scheduled: false, reason: 'permission-denied' };
  }

  // Schedule daily at 8:00 AM. Capacitor's local-notifications
  // 'every: day' + 'at: <next 8am>' = daily 8 AM. The plugin
  // handles the repeating logic natively.
  // Capacitor's API takes `{ notifications: [...] }` — passing the
  // notification fields at the top level (as this previously did)
  // is silently rejected by the plugin, so the reminder was never
  // actually registered.
  await LocalNotifications.schedule({
    notifications: [
      {
        id: REMINDER_ID,
        channelId: CHANNEL_ID,
        title: 'FitQuest // Today',
        body: 'Check your dailies · log a workout · mark the day complete.',
        schedule: {
          repeats: true,
          every: 'day',
          at: next830am(),
        },
        sound: 'default',
        smallIcon: 'ic_stat_notification',
      },
    ],
  });

  return { scheduled: true };
}
