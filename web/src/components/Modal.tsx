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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg-900/80 backdrop-blur-sm p-4"
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
