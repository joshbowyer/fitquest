import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fitquest.app',
  appName: 'FitQuest',
  webDir: 'dist',
  // The Capacitor Android project lives in its own repo:
  //   github.com/joshbowyer/fitquest-android
  // Local checkout path: absolute, sibling of web/. Previously the
  // project lived at web/android/ but that dir is gitignored —
  // syncing into it produced an untracked project nobody else
  // could build. Pointing android.path at the standalone checkout
  // lets `npx cap sync` write the web bundle into the sibling
  // project that the build script packages into an APK.
  // ABSOLUTE PATH: Capacitor's `android.path` is resolved relative
  // to the workspace root (FitnessStats/), not the config file's
  // directory, so '../fitquest-android' from web/ would land at
  // FitnessStats/fitquest-android (which doesn't exist). Override
  // via the CAPACITOR_ANDROID_PATH env var when running from a
  // different checkout root.
  android: {
    path: process.env.CAPACITOR_ANDROID_PATH ?? '/home/josh/claw-code/fitquest-android',
  },
  // Secure scheme (https://localhost) so SameSite=Lax session
  // cookies work + Service Workers can register. The actual
  // server.androidScheme is set per build — we use https for
  // production so cookies + fetch behave correctly. For local
  // dev (emulator / LAN) the same scheme + cleartext traffic
  // exception works.
  server: {
    androidScheme: 'https',
  },
  // Local plugin config — pulls the Vite env var at build time
  // and hands it to the local-notifications plugin as the api
  // base URL. The web app's own /lib/api.ts reads VITE_API_URL
  // directly, so this is just for the notifications module.
};

export default config;
