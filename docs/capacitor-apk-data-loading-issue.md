# Resolving the Capacitor APK data loading issue

## Symptom (from docker logs)
The fitquest-web container shows:
    GET /auth/me HTTP/1.1 200 923 "https://localhost/" ...
The /auth/me endpoint doesn't exist on the web container; the
923 bytes is the SPA shell (index.html). The api base URL got
set to the WEB origin instead of the API origin, so every API
call from the Capacitor WebView lands on the web container.

## Root cause
The api client at web/src/lib/api.ts does:
  let url = `${getApiBaseUrl()}${path}`;
  await fetch(url, { credentials: 'include' });
If the stored base URL in localStorage is the WEB origin
(`https://fitquest.joshbullock.net`), requests to /auth/me
hit the web, not the api. The caddyfile for fitquest.joshbullock.net
reverse-proxies everything EXCEPT /api/* to the web container,
and the SPA returns 200 with the index.html body.

## Fix (immediate, on the user's side)
1. Settings → Apps → FitQuest → Storage → Clear data
2. Re-open the app
3. First-run prompt: enter `https://fitquest-api.joshbullock.net`
   (no /api, NO trailing slash). The api domain is the second
   caddy vhost that reverse-proxies to api:3001 directly.
4. Save & Continue → page reloads → api client now uses the
   api domain → requests go to the right container.

## Long-term fix (proposed)
- Persist the api base URL with a clear "this must be your api
  domain, not your web domain" hint at the top of the prompt.
- Validate the URL in the prompt: warn if it matches the
  window.location.origin (which is the web origin in the
  Capacitor WebView — never the api).
- Add a "Reset" button in /settings that clears the stored URL
  + re-triggers the first-run prompt.

The current fix is just for the immediate symptom. The
first-run prompt already shows examples including the
api-domain case; the user just needs to enter the right
value on a clean install.
