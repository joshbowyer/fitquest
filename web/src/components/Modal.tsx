import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { classNames } from '@/lib/format';

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-md',
  // Common override for destructive-action modals (delete/reset
  // confirmations) where the typed-input field is long enough to
  // squeeze the cancel button off the right edge. Modal callers
  // can pass `width="max-w-lg"` to opt into the wider shell.
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  // Escape-to-close, body-scroll-lock, and a defensive cleanup of
  // any orphaned portal nodes. The cleanup runs on every close —
  // addresses a mobile Safari "ghost mask" bug where a previously-
  // rendered backdrop would linger for a frame after the modal was
  // unmounted (esp. when the user closed by tapping outside, the
  // backdrop click handler ran onClose, and the parent's setState
  // unmounted the modal but the portal node was still in the DOM).
  useEffect(() => {
    if (!open) {
      // Belt-and-suspenders: nuke any leftover portal nodes from
      // a previous mount. Without this, a fast-tap on iOS Safari
      // occasionally leaves the dark backdrop visible while the
      // content is gone.
      const stale = document.querySelectorAll('[data-modal-portal]');
      stale.forEach((n) => n.remove());
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Body scroll lock — prevents the page from scrolling behind
    // the modal on iOS Safari. Saved/restored on close.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      // Cleanup-time nuke too — catches the close case where the
      // portal node didn't get a chance to unmount yet.
      const stale = document.querySelectorAll('[data-modal-portal]');
      stale.forEach((n) => n.remove());
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      data-modal-portal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg-900/80 p-4"
      style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className={classNames(
          // max-h keeps long lists inside the viewport instead of
          // overflowing the screen edge. flex flex-col lets the
          // children container scroll while the title stays pinned.
          'panel relative p-5 shadow-panel w-full max-h-[calc(100vh-2rem)] flex flex-col',
          width,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display tracking-widest text-sm uppercase neon-text-magenta mb-3 shrink-0">
          {title}
        </h2>
        <div className="overflow-y-auto overscroll-contain flex-1 min-h-0 -mr-2 pr-2">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
