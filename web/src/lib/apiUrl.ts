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
 *
 * Runonce semantics: once the user has either SAVED a URL OR
 * dismissed the modal, `fitquest:apiUrlDismissed: 'true'` is
 * stored in localStorage. The first-run modal checks this flag
 * and only shows when (a) no URL stored AND (b) not dismissed.
 * The user can re-open the prompt from Settings or Login via
 * the explicit "Change API url" trigger.
 */
const LS_KEY = 'fitquest:apiBaseUrl';
const LS_DISMISSED_KEY = 'fitquest:apiUrlDismissed';

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

/**
 * Returns true if the user has ever saved or dismissed the
 * first-run api-URL modal. Used by FirstRunApiUrl to decide
 * whether to auto-open. Once true, the only way to re-show
 * the modal is the explicit Settings / Login trigger.
 */
export function isApiUrlPromptDismissed(): boolean {
  try {
    if (localStorage.getItem(LS_DISMISSED_KEY) === 'true') return true;
  } catch {
    // fall through
  }
  // Saved URL also implies dismissed — the user already configured
  // the api, so the prompt is moot.
  if (getApiBaseUrlSource() !== 'default') return true;
  return false;
}

export function markApiUrlPromptDismissed(): void {
  try {
    localStorage.setItem(LS_DISMISSED_KEY, 'true');
  } catch {
    // ignore
  }
}

export function clearApiUrlPromptDismissed(): void {
  try {
    localStorage.removeItem(LS_DISMISSED_KEY);
  } catch {
    // ignore
  }
}

export function setApiBaseUrl(url: string): void {
  try {
    localStorage.setItem(LS_KEY, url);
    // Saving also counts as dismissing the prompt permanently —
    // we don't need to ask again unless the user explicitly
    // invokes the Settings / Login "Change API url" trigger.
    localStorage.setItem(LS_DISMISSED_KEY, 'true');
  } catch {
    // ignore
  }
}

export function clearApiBaseUrl(): void {
  try {
    localStorage.removeItem(LS_KEY);
    // Clearing the URL re-arms the prompt so the first-run modal
    // shows again. (Mostly used by the Settings reset path.)
    localStorage.removeItem(LS_DISMISSED_KEY);
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
