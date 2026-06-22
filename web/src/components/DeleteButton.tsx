import { classNames } from '@/lib/format';

type Props = {
  onClick: () => void;
  /** Tooltip text. */
  title?: string;
  /** Disabled — grays the button and prevents click. */
  disabled?: boolean;
  /** Show only on parent hover. Default true. When false, the
   * button is always visible — useful in dense panels where
   * the parent isn't hover-stable. */
  showOnHover?: boolean;
  /** Smaller variant for use in tight rows (12px instead of 18px). */
  size?: 'sm' | 'md';
  /** Inline label after the X (e.g. "Delete"). Default omits. */
  label?: string;
};

/**
 * Standard delete button — a small red box containing a clear X.
 * Replaces the old "tiny ×" pattern where the click target was
 * often smaller than 14px and got visually overlapped by the
 * browser scrollbar on hover. Use this anywhere we delete a row.
 *
 * Usage: <DeleteButton onClick={...} title="Delete this log" />
 *
 * The box is intentionally always-visible by default so users can
 * see what to click. Pass `showOnHover` to keep the old "appears on
 * parent hover" behavior for dense tables.
 */
export function DeleteButton({
  onClick, title = 'Delete', disabled, showOnHover = false, size = 'md', label,
}: Props) {
  const dim = size === 'sm' ? 'w-5 h-5' : 'w-[18px] h-[18px]';
  const text = size === 'sm' ? 'text-[10px]' : 'text-[11px]';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={classNames(
        'inline-flex items-center gap-1.5 shrink-0',
        dim,
        'border border-rose-500/40 bg-rose-500/10 text-rose-300',
        'hover:bg-rose-500/25 hover:border-rose-400 hover:text-rose-200',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'transition-colors',
        showOnHover && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
      )}
    >
      <span className={classNames(text, 'font-bold leading-none m-auto')}>×</span>
      {label && <span className="text-[10px] font-mono uppercase tracking-widest text-rose-300">{label}</span>}
    </button>
  );
}
