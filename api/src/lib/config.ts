export const config = {
  isDev: process.env.NODE_ENV !== 'production',
  port: Number(process.env.PORT ?? 3001),
  host: process.env.API_HOST ?? '0.0.0.0',
  cookieSecret: process.env.COOKIE_SECRET ?? 'dev-secret-change-me-please-min-32-chars-aaaaa',
  cookieName: process.env.COOKIE_NAME ?? 'fitquest_session',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  sessionTtlDays: 30,
} as const;
