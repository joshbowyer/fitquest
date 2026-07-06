import { useEffect, useId, useRef, type ReactNode } from 'react';
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
  // Capture the latest onClose via ref so the effect can stay
  // scoped to `open` only. Without this, every parent re-render
  // that recreates the onClose handler (e.g. inline
  // `() => setDetailMetric(null)` in Dashboard.tsx) would re-run
  // this effect — and its cleanup nukes the portal node. Result:
  // any open modal disappeared on the next parent re-render
  // (radial gauges on the dashboard were the most visible victim
  // — clicking set state, the next query tick re-rendered, the
  // modal vanished mid-open).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Per-modal unique id, used as the data-modal-portal attribute.
  // The previous implementation used a shared `[data-modal-portal]`
  // selector for orphan-cleanup, which could nuke a *new* modal's
  // portal if it opened in the same frame as this one closed
  // (visible on Android as a "ghost" backdrop that captures
  // clicks until the user long-presses some text — long-press
  // triggered a focus / repaint that finally cleared the stale
  // node). With a unique id, the cleanup only ever matches THIS
  // modal's portal.
  const portalId = useId();
  const portalSelector = `[data-modal-portal="${portalId}"]`;

  // Body scroll lock + Escape-to-close. Only runs when `open`
  // flips; the keydown closure reads the latest onClose through
  // the ref so we never need it in the dep array.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Orphaned-portal cleanup. Only runs on the open → closed
  // transition. Belt-and-suspenders for the mobile-Safari
  // "ghost mask" bug where a tap-outside fast-path occasionally
  // left the dark backdrop visible while the content was gone.
  // Targeted at THIS modal's portal via the unique id so we
  // never nuke a sibling modal that opened in the same frame.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const t = window.setTimeout(() => {
        document
          .querySelectorAll(portalSelector)
          .forEach((n) => n.remove());
      }, 0);
      wasOpen.current = false;
      return () => window.clearTimeout(t);
    }
    wasOpen.current = open;
    return;
  }, [open, portalSelector]);

  if (!open) return null;

  return createPortal(
    <div
      data-modal-portal={portalId}
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
