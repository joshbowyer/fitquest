import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

/**
 * Per-user sidebar item ordering. Two-layer persistence:
 *
 *   1. Server (`/users/me/nav-order`) is the source of truth. Syncs
 *      across mobile + laptop so the user sees the same arrangement
 *      regardless of which device they log into.
 *   2. localStorage is a write-through cache. Subsequent page loads
 *      render immediately while the server fetch is in flight, so
 *      there's no flicker between the canonical default and the
 *      user's saved order.
 *
 * Defaults: the `defaultOrder` argument, which should be the canonical
 * NAV array from Layout.tsx. Items missing from the saved server
 * order are appended in their original order (graceful degradation
 * if a route was added in a later release and the user's save
 * predates it).
 */
export function useNavOrder<T extends { to: string }>(
  storageKey: string,
  defaultOrder: T[]
): {
  order: T[];
  loading: boolean;
  reorder: (fromIndex: number, toIndex: number) => void;
  reset: () => void;
} {
  // Start with the cached/local order so the sidebar renders
  // immediately on first paint. Server fetch updates it once the
  // response arrives.
  const [order, setOrder] = useState<T[]>(() => loadLocalOrder(storageKey, defaultOrder));
  const [loading, setLoading] = useState(true);

  // Fetch the server-side order on mount. This is the sync point
  // that ensures a mobile reordering shows up on the laptop, etc.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ order: string[] | null }>('/users/me/nav-order');
        if (cancelled) return;
        if (Array.isArray(res.order)) {
          const merged = mergeOrder(res.order, defaultOrder);
          setOrder(merged);
          saveLocalOrder(storageKey, merged);
        } else {
          // Server says "use default". Wipe stale local cache so a
          // browser from before the server-side feature doesn't keep
          // showing the old order.
          localStorage.removeItem(storageKey);
          setOrder(defaultOrder.slice());
        }
      } catch {
        // Network error: stick with the local cache. The user will
        // see their last-known order and any reorder will be queued
        // for the next refresh.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [storageKey, defaultOrder]);

  const persist = useCallback(
    async (next: T[]) => {
      saveLocalOrder(storageKey, next);
      try {
        await api('/users/me/nav-order', {
          method: 'PUT',
          body: { order: next.map((i) => i.to) },
        });
      } catch {
        // Server unreachable — local save still wins for the current
        // device. Next time the user opens the app on a synced device,
        // they'll see the older server order; we accept this small
        // window in exchange for never blocking the UI on the network.
      }
    },
    [storageKey]
  );

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      setOrder((cur) => {
        if (fromIndex === toIndex) return cur;
        const next = cur.slice();
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        // Fire-and-forget: don't await so the UI updates instantly.
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  const reset = useCallback(() => {
    localStorage.removeItem(storageKey);
    setOrder(defaultOrder.slice());
    void api('/users/me/nav-order', {
      method: 'PUT',
      body: { order: [] },
    }).catch(() => { /* swallow */ });
  }, [storageKey, defaultOrder]);

  return { order, loading, reorder, reset };
}

function mergeOrder<T extends { to: string }>(savedTos: string[], fallback: T[]): T[] {
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
}

function loadLocalOrder<T extends { to: string }>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback.slice();
    const savedTos = JSON.parse(raw) as string[];
    if (!Array.isArray(savedTos)) return fallback.slice();
    return mergeOrder(savedTos, fallback);
  } catch {
    return fallback.slice();
  }
}

function saveLocalOrder(key: string, items: Array<{ to: string }>) {
  try {
    localStorage.setItem(key, JSON.stringify(items.map((i) => i.to)));
  } catch {
    // localStorage full / disabled — drop silently.
  }
}