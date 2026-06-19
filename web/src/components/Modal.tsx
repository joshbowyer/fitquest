import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { classNames } from '@/lib/format';

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-md',
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
          'panel relative p-5 shadow-panel w-full',
          width,
        )}
        onClick={(e) => e.stopPropagation()}
        style={{ borderColor: 'rgba(245,92,196,0.4)' }}
      >
        <h2 className="font-display tracking-widest text-sm uppercase neon-text-magenta mb-3">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body
  );
}
