import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { NeonButton } from '@/components/NeonButton';
import { useAuth } from '@/lib/auth';
import { classNames } from '@/lib/format';

type NotificationCategory =
  | 'SKILL' | 'PENANCE' | 'SHOP' | 'SYSTEM' | 'ACHIEVEMENT' | 'LEVEL';

type Notification = {
  id: string;
  category: NotificationCategory;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Compact bell-anchored preview of the user's most recent notifications.
 * Replaces the bell's old hard-navigate-to-/notifications behaviour so
 * the user can scan + dismiss without leaving whatever page they're on.
 *
 * Rendered into document.body via createPortal (same pattern Modal.tsx
 * uses) so its `position: fixed` isn't trapped inside any overflow:hidden
 * or transformed ancestor in the layout tree. Anchored under the top
 * bar's right edge — the top bar is `sticky top-0` with z-30, so the
 * flyout sits at z-40 to stay above it.
 *
 * Dismiss triggers:
 *   - clicking outside the panel (data-notif-bell is excluded so the
 *     bell-click that opened us doesn't immediately re-fire as a close)
 *   - Escape key
 *   - the See All button (navigates to /notifications + closes)
 *
 * Data: reuses the same GET /notifications endpoint the full inbox
 * page uses (see pages/Notifications.tsx). Limit is dropped to 5 since
 * we only render the first slice anyway — saves a tiny bit of payload
 * on the common case. Same queryKey prefix so the unread-count badge
 * in the top bar stays coherent with the full inbox.
 */
export function NotificationFlyout({ open, onClose }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement | null>(null);
  // mount-rAF mount state drives the fade+slide entrance (opacity /
  // translate transition). Default false so the panel paints in the
  // hidden state on first render; the effect below flips it to true
  // on the next animation frame so the transition runs.
  const [mounted, setMounted] = useState(false);

  // Entrance animation: defer the "visible" state by one frame so the
  // initial opacity-0 / translate offset paints first, then flips to
  // opacity-100 / translate-0 with the Tailwind transition taking over.
  // On close, flip back to hidden before unmounting so the panel
  // fades out (Tailwind transition applies both directions).
  useEffect(() => {
    if (!open) {
      setMounted(false);
      return;
    }
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Outside-click + Escape dismiss. The pointerdown listener is
  // attached on a short delay so the click that opened us doesn't
  // immediately re-fire as a close (the bell is outside the panel,
  // so a naive contains() check would close us on the same click
  // that opened us, before the user even saw the panel).
  //
  // The bell itself is also excluded via the [data-notif-bell]
  // attribute set in Layout.tsx — when the flyout is already open
  // and the user re-clicks the bell, we want the bell's own onClick
  // to handle the toggle (it already does setNotifOpen(v => !v)),
  // not the global pointerdown handler closing-then-reopening.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.('[data-notif-bell]')) return;
      if (panelRef.current && !panelRef.current.contains(target)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    // Defer pointer listener by a tick so the opening click / tap is
    // already past by the time we start listening.
    const t = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointer);
    }, 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose]);

  // Same queryKey prefix the full inbox uses so this share's cache
  // invalidation with the page (e.g. marking one read on the inbox
  // page reflects here on the next open). Limit 5 because we only
  // render the first 5 anyway; saves a bit of payload.
  const listQ = useQuery({
    queryKey: ['notifications', 'list', 'ALL'],
    queryFn: () =>
      api<{ items: Notification[] }>('/notifications', {
        query: { limit: 5 },
      }),
    enabled: !!user && open,
    // Don't refetch on an interval here — the badge in the top bar
    // already polls every 60s, and the user can close-and-reopen to
    // pick up fresh data. The full inbox page does its own polling.
    staleTime: 30_000,
  });

  // Don't render anything until we're mounted. Saves a stray portal
  // node when the bell has never been clicked.
  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const items = listQ.data?.items ?? [];

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notifications"
      data-notification-flyout
      className={classNames(
        // Positioning. The top bar is 60px tall (h-[60px]) with
        // paddingTop: env(safe-area-inset-top) applied at the header
        // level, so the visible bottom edge of the bar sits at
        // 60 + safe-area from the viewport top. The top calc below
        // puts the flyout right under that edge on both notched and
        // non-notched phones. right uses the same safe-area-aware
        // calc so landscape phones (with notch on the right) don't
        // tuck the flyout under the safe-area gutter.
        'fixed z-40',
        'top-[calc(60px+env(safe-area-inset-top))]',
        'right-[max(0.5rem,env(safe-area-inset-right))]',
        'sm:right-[max(1rem,env(safe-area-inset-right))]',
        // Card chrome — matches Modal/Panel's surface family for
        // border + glow, but with a fully OPAQUE background
        // (bg-bg-800/95 + backdrop-blur-none) instead of the usual
        // .panel's bg-bg-800/70 + backdrop-blur-sm. The panel's
        // default translucency reads as nearly invisible against
        // busy page content below it — text was getting lost. This
        // is the one place in the app that needs a solid surface
        // (it's a small floating chrome element, not a full-width
        // content area), so we override the background rather than
        // changing the shared .panel class which other components
        // (Modal, Panel itself, etc.) rely on.
        'rounded-lg border border-neon-cyan/20 bg-bg-800/95',
        // Inset cyan glow + outer drop-shadow, matching .panel's
        // shadow-panel so the flyout reads as the same surface
        // family visually even though the background is now solid.
        'shadow-[inset_0_0_0_1px_rgb(var(--neon-cyan)/0.08),0_0_30px_rgb(var(--neon-cyan)/0.05)]',
        // Width: compact but readable; collapses on narrow phones
        // so we never overflow the viewport. max-h + overflow-y
        // keeps it non-full-height — the panel grows with content
        // up to ~70% of the viewport, then scrolls internally.
        'w-[min(360px,calc(100vw-1rem))]',
        'max-h-[70vh] overflow-hidden',
        'flex flex-col',
        // Entrance/exit. Default hidden state (opacity-0, slight
        // offset from top-right) flips to mounted after one rAF.
        // Tailwind's transition-all takes ~150ms to land.
        'transition-all duration-150 ease-out',
        mounted
          ? 'opacity-100 translate-x-0 translate-y-0'
          : 'opacity-0 translate-x-2 -translate-y-2',
      )}
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-neon-cyan/20 shrink-0">
        <div className="font-display tracking-widest text-[11px] uppercase neon-text-cyan">
          Notifications
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close notifications"
          className="text-ink-400 hover:text-neon-cyan text-sm leading-none px-1"
        >
          ✕
        </button>
      </header>

      {/* Scroll container — max-h on the parent + overflow-hidden
          + overflow-y-auto on this child keeps the header + footer
          pinned while the list scrolls. min-h-0 on a flex child
          lets the scroll container actually shrink (otherwise
          flex children's min-height defaults to auto and the
          panel would push past max-h). */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {listQ.isLoading ? (
          <div className="px-3 py-6 text-center text-[11px] font-mono text-ink-400">
            loading…
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] font-mono text-ink-400">
            No notifications
          </div>
        ) : (
          <ul className="divide-y divide-neon-cyan/10">
            {items.map((n) => {
              const unread = n.readAt == null;
              return (
                <li
                  key={n.id}
                  className={classNames(
                    // py-2 px-3 → ~36-40px tap target, comfortable
                    // for thumb taps on mobile without wasting
                    // vertical space. Hover state only meaningful
                    // on desktop (touch devices don't fire hover).
                    'flex items-start gap-2 py-2 px-3',
                    'hover:bg-bg-700/40 transition-colors cursor-default',
                  )}
                >
                  {/* Unread accent dot. The flyout is read-only
                      (clicks just navigate to the inbox) so the
                      dot is purely visual. Same neon-cyan/30
                      border + dot combo the full inbox uses. */}
                  <span
                    className={classNames(
                      'shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full',
                      unread ? 'bg-neon-cyan' : 'bg-transparent',
                    )}
                    aria-hidden={!unread}
                    aria-label={unread ? 'unread' : undefined}
                  />
                  <div className="flex-1 min-w-0">
                    <div
                      className={classNames(
                        'text-[12px] truncate',
                        unread ? 'text-ink-50 font-medium' : 'text-ink-200 font-medium',
                      )}
                    >
                      {n.title}
                    </div>
                    {n.body && (
                      <div className="text-[11px] text-ink-400 mt-0.5 line-clamp-2">
                        {n.body}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer — pinned at the panel bottom regardless of list
          length. NeonButton (cyan) for the See All CTA, full-width
          on mobile for a comfortable thumb target. */}
      <footer className="border-t border-neon-cyan/20 px-3 py-2 shrink-0 bg-bg-900/40">
        <NeonButton
          size="sm"
          variant="cyan"
          fullWidth
          onClick={() => {
            // Close first so the flyout doesn't briefly appear
            // overlapping the inbox page during the route change.
            // Then navigate. Order matters: if we navigated first
            // and the flyout re-rendered mid-flight, the user
            // could see a ghosted panel over the inbox for a frame.
            onClose();
            navigate('/notifications');
          }}
        >
          See All
        </NeonButton>
      </footer>
    </div>,
    document.body,
  );
}