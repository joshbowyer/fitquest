/**
 * API base URL resolver. Order of precedence:
 *   1. localStorage `fitquest:apiBaseUrl` (user-set in the
 *      first-run prompt — persisted across app restarts)
 *   2. Vite build-time env var `VITE_API_URL` (set at build
 *      time by the developer — useful for hard-coded deploys)
 *   3. Default '/api' (works in the dev server's vite proxy
 *      during browser dev — does NOT work in the Capacitor
 *      WebView, so the user must set #1 or #2 before the app
 *      is usable in the field)
 */
const LS_KEY = 'fitquest:apiBaseUrl';

export function getApiBaseUrl(): string {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    // localStorage might be unavailable (private mode, etc.)
  }
  const envUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (envUrl) return envUrl;
  return '/api';
}

export function setApiBaseUrl(url: string): void {
  try {
    localStorage.setItem(LS_KEY, url);
  } catch {
    // ignore
  }
}

export function clearApiBaseUrl(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}

export function getApiBaseUrlSource(): 'localStorage' | 'env' | 'default' {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored && stored.trim()) return 'localStorage';
  } catch {
    // fall through
  }
  if ((import.meta.env.VITE_API_URL as string | undefined)?.trim()) return 'env';
  return 'default';
}
