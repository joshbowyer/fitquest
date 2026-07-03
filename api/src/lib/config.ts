export const config = {
  isDev: process.env.NODE_ENV !== 'production',
  port: Number(process.env.PORT ?? 3001),
  host: process.env.API_HOST ?? '0.0.0.0',
  cookieSecret: process.env.COOKIE_SECRET ?? 'dev-secret-change-me-please-min-32-chars-aaaaa',
  cookieName: process.env.COOKIE_NAME ?? 'fitquest_session',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  // Comma-separated list of additional allowed origins for
  // CORS. The primary origin (webOrigin above) is always
  // allowed; this list adds Capacitor WebView origins
  // (https://localhost) and any other hosts the dev / user
  // needs. Set the env var e.g.:
  //   WEB_ORIGIN_EXTRA="https://localhost,http://10.0.2.2:5173"
  // When unset, defaults to allowing the Capacitor localhost
  // origin (https) so the APK works out of the box.
  webOriginExtra: (process.env.WEB_ORIGIN_EXTRA ?? 'https://localhost')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  sessionTtlDays: 30,
} as const;
