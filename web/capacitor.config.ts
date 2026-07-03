import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fitquest.app',
  appName: 'FitQuest',
  webDir: 'dist',
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
