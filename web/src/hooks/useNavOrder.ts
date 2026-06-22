import { useState, useEffect, useCallback } from 'react';

/**
 * Per-user sidebar item ordering. Persisted in localStorage so the
 * user's drag-to-reorder choices survive page reloads but don't leak
 * across browsers. The hook is the single source of truth — both the
 * desktop sidebar and the mobile bottom-nav read from it, so reordering
 * the desktop list also reorders the mobile top-5.
 *
 * Defaults: the `defaultOrder` argument, which should be the canonical
 * NAV array from Layout.tsx. Items missing from localStorage are
 * appended at the end in their original order, so a partial save (e.g.
 * from an older version of the app) degrades gracefully.
 */
export function useNavOrder<T extends { to: string }>(
  storageKey: string,
  defaultOrder: T[]
): {
  order: T[];
  reorder: (fromIndex: number, toIndex: number) => void;
  reset: () => void;
} {
  const [order, setOrder] = useState<T[]>(() => loadOrder(storageKey, defaultOrder));

  // Sync across tabs/windows.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === storageKey) {
        setOrder(loadOrder(storageKey, defaultOrder));
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey, defaultOrder]);

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      setOrder((cur) => {
        if (fromIndex === toIndex) return cur;
        const next = cur.slice();
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        saveOrder(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  const reset = useCallback(() => {
    localStorage.removeItem(storageKey);
    setOrder(defaultOrder);
  }, [storageKey, defaultOrder]);

  return { order, reorder, reset };
}

function loadOrder<T extends { to: string }>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback.slice();
    const savedTos = JSON.parse(raw) as string[];
    if (!Array.isArray(savedTos)) return fallback.slice();
    // Map saved `to` paths back to the canonical entries from `fallback`.
    // Items missing from savedTos get appended in their original order
    // (graceful degradation if the user had a stale partial save).
    const byTo = new Map(fallback.map((item) => [item.to, item]));
    const seen = new Set<string>();
    const result: T[] = [];
    for (const to of savedTos) {
      const item = byTo.get(to);
      if (item && !seen.has(to)) {
        result.push(item);
        seen.add(to);
      }
    }
    for (const item of fallback) {
      if (!seen.has(item.to)) {
        result.push(item);
        seen.add(item.to);
      }
    }
    return result;
  } catch {
    return fallback.slice();
  }
}

function saveOrder(key: string, items: Array<{ to: string }>) {
  try {
    localStorage.setItem(key, JSON.stringify(items.map((i) => i.to)));
  } catch {
    // localStorage full / disabled — silently drop. Next page load
    // falls back to the default order, which is correct behavior.
  }
}