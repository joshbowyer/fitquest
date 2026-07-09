/**
 * Native-platform detection — adds a class to <html> at startup so
 * global CSS (see .is-native-android in src/index.css) can scope
 * platform-specific overrides.
 *
 * Why this exists: Android WebView leaves stale compositor layers
 * when fixed-position overlays using `backdrop-filter` /
 * `backdrop-blur-*` unmount. The visible symptom is a "ghost"
 * backdrop that captures clicks until a text-selection / focus
 * event triggers a recomposite. The fix is to disable the blur on
 * native Android only — desktop / web users keep it.
 *
 * Why a separate module rather than inline in main.tsx: matches
 * the existing convention (`applyStoredTheme()` from themeBus.ts,
 * `scheduleMorningReminder()` from morningReminder.ts) of
 * extracting module-level concerns into /lib/ and calling the
 * helper from main.tsx. Also mirrors the platform-detection pattern
 * used in BarcodeScanner.tsx + morningReminder.ts:
 *
 *     Capacitor.isNativePlatform() &&
 *     Capacitor.getPlatform() === 'android'
 *
 * Called BEFORE React mounts (alongside applyStoredTheme) so the
 * class is on <html> before any overlay renders, and the override
 * is in effect from the first paint.
 */
import { Capacitor } from '@capacitor/core';

export const NATIVE_ANDROID_CLASS = 'is-native-android';

/**
 * Add the native-android marker class to <html> if we're running
 * inside a Capacitor Android wrapper. No-op in browser dev and
 * on non-Android platforms (currently just iOS, which we don't
 * ship to but the check is the safe default). Idempotent — calling
 * twice is harmless.
 *
 * We use the same detection chain as BarcodeScanner.tsx so the
 * behavior stays consistent across the app: `isNativePlatform()`
 * first to guarantee we're not in a regular browser tab, then
 * `getPlatform() === 'android'` to scope the override.
 */
export function applyNativePlatformClass(): boolean {
  if (typeof document === 'undefined') return false;
  const isAndroidNative =
    Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  if (!isAndroidNative) return false;
  document.documentElement.classList.add(NATIVE_ANDROID_CLASS);
  return true;
}