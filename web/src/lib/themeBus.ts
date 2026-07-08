/**
 * Theme bus — small pub-sub for the dark/light theme toggle.
 *
 * Mirrors the shape of soundBus.ts: a module-level source of truth
 * (`currentTheme()`), a `setTheme()` setter that persists to
 * localStorage AND applies the theme to <html>, plus a `subscribe()`
 * hook so components can re-render on change.
 *
 * Why a bus instead of React context: the theme must be applied as
 * early as possible (before React hydrates) so the first paint uses
 * the right palette. main.tsx calls `applyStoredTheme()` on startup;
 * the Settings page calls `setTheme()` on user choice.
 *
 * Storage key: `fq_theme` (per task spec). Stored value: 'dark' | 'light'.
 * Default: respects `window.matchMedia('(prefers-color-scheme: light)')`
 * when no stored preference exists.
 */
export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'fq_theme';
const LIGHT_CLASS = 'light';

let current: Theme = 'dark';
const listeners = new Set<() => void>();

/**
 * Best-effort initial-theme picker. Tries localStorage first; on miss
 * falls back to the OS preference. Always returns a valid Theme and
 * updates the module-level `current`. Safe to call multiple times —
 * repeated calls with no preference change are no-ops.
 */
function resolveInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage unavailable (private mode, SSR, etc.) — fall through.
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    try {
      if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    } catch {
      // matchMedia can throw in weird sandboxed environments.
    }
  }
  return 'dark';
}

/**
 * Apply the theme to <html>. Used by both applyStoredTheme() at boot
 * and setTheme() on user toggle. We use a class rather than the
 * data-theme attribute because the index.css light overrides are
 * keyed off `.light` (the cheaper selector for the pervasively-themed
 * Tailwind classes).
 */
function applyToDom(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'light') {
    root.classList.add(LIGHT_CLASS);
  } else {
    root.classList.remove(LIGHT_CLASS);
  }
}

/**
 * Boot-time call. Resolves the initial theme (stored > OS > dark)
 * and applies it to <html> BEFORE React mounts so the first paint
 * matches the user's preference. Idempotent — main.tsx calls it
 * exactly once.
 */
export function applyStoredTheme(): Theme {
  current = resolveInitialTheme();
  applyToDom(current);
  return current;
}

/**
 * Read the current theme without forcing a re-render. The Settings
 * page uses this for the toggle's "current" highlight.
 */
export function currentTheme(): Theme {
  return current;
}

/**
 * Switch theme. Updates module state, persists to localStorage,
 * applies the class to <html>, and notifies subscribers.
 */
export function setTheme(next: Theme): void {
  if (next !== 'dark' && next !== 'light') return;
  if (next === current) return;
  current = next;
  applyToDom(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // localStorage write failed (quota, private mode). In-memory state
    // still wins for the rest of the session.
  }
  for (const fn of listeners) {
    try { fn(); } catch { /* don't let one bad listener block the rest */ }
  }
}

/**
 * Subscribe to theme changes. Returns an unsubscribe function. Used
 * by React components (the Settings page) via useTheme() so they
 * re-render on toggle. Keeping the bus outside React state lets the
 * initial paint happen synchronously at boot.
 */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}