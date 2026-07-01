import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth, type User } from '@/lib/auth';
import { CLASS_META } from '@/lib/types';
import { classNames } from '@/lib/format';
import { useNavOrder } from '@/hooks/useNavOrder';
import { useLiveClock } from '@/hooks/useLiveClock';
import { api } from '@/lib/api';
import type { ReactNode } from 'react';

type Props = { children: ReactNode };

type NavItem = { to: string; label: string; icon: string; mobile?: boolean; requiresAdmin?: boolean };

// Desktop sidebar shows all items, in the user's preferred order.
// On mobile, the top-bar hamburger opens a full-screen overlay that
// also shows every item (no separate "primary" subset + overflow
// drawer anymore — that split felt arbitrary once we hit ~15 items).
// The `mobile: true` flag is now only used for sidebar grouping
// decisions on desktop (e.g. badge for admin-only).
const NAV: NavItem[] = [
  { to: '/dashboard',    label: 'Dashboard',  icon: '◆', mobile: true },
  { to: '/home-base',    label: 'HomeBase',   icon: '◉', mobile: true },
  { to: '/status',       label: 'Status',     icon: '◊', mobile: true },
  { to: '/today',        label: 'Today',      icon: '◐', mobile: true },
  { to: '/activities',   label: 'Activity',   icon: '▣', mobile: true },
  { to: '/routines',     label: 'Routines',   icon: '☰', mobile: false },
  { to: '/spiritual',    label: 'Spiritual',  icon: '☩', mobile: false },
  { to: '/recovery',     label: 'Recovery',   icon: '☾', mobile: false },
  { to: '/import',       label: 'Import',     icon: '↥', mobile: false },
  { to: '/nutrition',    label: 'Nutrition',  icon: '⌬', mobile: false },
  { to: '/habits',       label: 'Habits',     icon: '✓', mobile: false },
  { to: '/measurements', label: 'Measure',    icon: '◎', mobile: false },
  { to: '/insights',     label: 'Insights',   icon: '◈', mobile: false },
  { to: '/tools',        label: 'Tools',      icon: '⚒', mobile: false },
  { to: '/check-ins',    label: 'Check-ins',  icon: '◷', mobile: false },
  { to: '/body-comp',     label: 'Body comp',  icon: '⚖', mobile: false },
  { to: '/skills',       label: 'Skill Tree', icon: '✦', mobile: false },
  { to: '/party',        label: 'Party',      icon: '⚑', mobile: false },
  { to: '/inventory',    label: 'Inventory',  icon: '⚔', mobile: false },
  { to: '/achievements', label: 'Achieve',    icon: '◆', mobile: false },
  { to: '/profile',      label: 'Profile',    icon: '◉', mobile: false },
  { to: '/settings',     label: 'Settings',    icon: '⚙', mobile: false },
  { to: '/admin',        label: 'Admin',      icon: '★', mobile: false, requiresAdmin: true },
];

export function Layout({ children }: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Live clock for the sidebar footer. Updates every minute;
  // the hook also restarts the interval on tab focus so a
  // backgrounded tab doesn't display a stale time.
  const now = useLiveClock(60_000);
  // Plateau badge — surfaces the weekly cron result on the
  // Insights nav link so the user sees "X stale" without opening
  // /insights. Refreshes on a 30-min cadence (server writes ~once
  // a week so this is just to pick up manual force-refreshes).
  // Skipped in the no-auth shell so /login doesn't hit a 401.
  const plateauBadgeQ = useQuery({
    queryKey: ['plateaus', 'badge'],
    queryFn: () => api<{ count: number; weekStart: string | null; stale: boolean }>('/plateaus/snapshot/badges'),
    enabled: !!user,
    refetchInterval: 30 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });
  /// Mobile menu overlay. Single boolean — when true, the
  /// hamburger morphs into an X and a full-screen menu renders.
  const [menuOpen, setMenuOpen] = useState(false);
  /// Sidebar reorder edit-mode. When true, each NavLink becomes
  /// draggable and a drag-handle glyph appears on hover. A "Done"
  /// pill at the bottom of the sidebar flips it back off.
  const [editingNav, setEditingNav] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const cls = user?.class ? CLASS_META[user.class] : null;
  const colorClass = cls ? `neon-text-${cls.color}` : 'neon-text-cyan';

  const filteredNav = NAV.filter((n) => !n.requiresAdmin || user?.isAdmin);
  const { order: visibleNav, reorder, reset } = useNavOrder<NavItem>('fq.navOrder.v1', filteredNav);

  async function handleLogout() {
    await logout();
    setMenuOpen(false);
    navigate('/login');
  }

  return (
    <div className="min-h-full md:grid md:grid-cols-[220px_1fr] md:grid-rows-[60px_1fr]">
      {/* Top bar. Desktop shows full status row + Logout button on the
          right; mobile shows hamburger left, FIT//QUEST centered,
          and a condensed status pill on the right. */}
      <header
        className="md:col-span-2 md:border-b md:border-neon-cyan/15 bg-bg-800/95 backdrop-blur-md z-30
                   sticky top-0 border-b border-neon-cyan/15"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center px-3 md:px-6 gap-2 md:gap-6 h-[60px] relative">
          {/* Mobile hamburger / X. The button morphs into an X when
              the menu is open so the close affordance is in the same
              spot the user opened it from. aria-expanded drives
              screen-reader announcements. */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            className="md:hidden w-10 h-10 flex items-center justify-center text-neon-cyan text-2xl hover:bg-bg-700/60 rounded transition-colors"
          >
            {menuOpen ? '✕' : '☰'}
          </button>

          {/* Title — mobile is centered absolutely so it survives the
              variable-width left button + right status pill. Desktop
              uses the normal flow. */}
          <div className="font-display tracking-[0.4em] text-sm neon-text-cyan md:static md:translate-x-0 absolute left-0 right-0 text-center pointer-events-none md:pointer-events-auto">
            FIT<span className="hidden md:inline">//</span><span className="md:hidden">·</span>QUEST
          </div>

          <div className="flex-1 hidden md:block" />

          {/* Desktop-only status row */}
          {user && (
            <div className="hidden md:flex items-center gap-5 text-sm font-mono">
              <div className="flex items-center gap-2">
                <span className="text-ink-300 text-[10px] uppercase tracking-widest">LVL</span>
                <span className="neon-text-cyan text-lg font-bold">{user.level}</span>
              </div>
              <div className="w-40">
                <div className="flex justify-between text-[10px] text-ink-300 mb-1 font-mono">
                  <span>XP</span>
                  <span>{user.xp}</span>
                </div>
                <div className="h-1.5 bg-bg-700 border border-neon-cyan/20">
                  <div
                    className="h-full bg-neon-cyan shadow-neon-cyan/60"
                    style={{ width: `${(user.progress?.pct ?? 0) * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-ink-300 text-[10px] uppercase tracking-widest">GOLD</span>
                <span className="neon-text-amber text-lg font-bold">{user.gold}</span>
              </div>
              {/* Hearts. Always visible (both Casual + Hardcore) so the
                  user can see when they're missing things. Color
                  reflects the mode: cyan in Casual (no penalty,
                  just a visual signal), magenta in Hardcore (with
                  the graduated XP/gold/raid penalty). At ≤3 hearts
                  the row pulses red — even in Casual, the pulse is
                  a soft "you're getting low" signal. */}
              {user && (
                <div
                  className="flex items-center gap-1"
                  title={`${user.hearts ?? 10} hearts · ×${(user.heartMultiplier ?? 1).toFixed(2)} multiplier`}
                >
                  <span
                    className={classNames(
                      'text-base leading-none select-none',
                      user.mode === 'HARDCORE' ? 'text-neon-magenta' : 'text-neon-cyan',
                      (user.hearts ?? 10) <= 3 && 'animate-heart-warn',
                    )}
                  >
                    {Array.from({ length: 10 }, (_, i) => (
                      <span
                        key={i}
                        className={i < (user.hearts ?? 10) ? '' : 'opacity-25 grayscale'}
                        aria-label={i < (user.hearts ?? 10) ? 'heart filled' : 'heart empty'}
                      >
                        ♥
                      </span>
                    ))}
                  </span>
                  <span
                    className={classNames(
                      'text-[10px] font-mono tabular-nums',
                      user.mode === 'HARDCORE' ? 'text-neon-magenta' : 'text-neon-cyan',
                    )}
                  >
                    ×{(user.heartMultiplier ?? 1).toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className={`text-[10px] uppercase tracking-widest ${colorClass}`}>
                  {user.classDisplay ?? cls?.label ?? 'No class'}
                </span>
              </div>
              <button onClick={handleLogout} className="btn-ghost text-[10px]">
                Logout
              </button>
            </div>
          )}

          {/* Mobile-only: condensed status pill on the right. Hearts
              are visible in BOTH modes (Casual: cyan, Hardcore:
              magenta) with the same red pulse at ≤3. */}
          {user && (
            <div className="flex md:hidden items-center gap-2 text-xs font-mono ml-auto">
              <span className="neon-text-cyan font-bold">L{user.level}</span>
              <span className="neon-text-amber">{user.gold}G</span>
              <span
                className={classNames(
                  'leading-none select-none',
                  user.mode === 'HARDCORE' ? 'text-neon-magenta' : 'text-neon-cyan',
                  (user.hearts ?? 10) <= 3 && 'animate-heart-warn',
                )}
                title={`${user.hearts ?? 10} hearts · ×${(user.heartMultiplier ?? 1).toFixed(2)} multiplier`}
              >
                {Array.from({ length: 10 }, (_, i) => (
                  <span
                    key={i}
                    className={i < (user.hearts ?? 10) ? '' : 'opacity-25 grayscale'}
                    aria-label={i < (user.hearts ?? 10) ? 'heart filled' : 'heart empty'}
                  >
                    ♥
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Sidebar — desktop only. Renders the same NavLink list as
          the mobile overlay so behaviour stays consistent. */}
      <aside className="hidden md:block md:row-start-2 md:border-r md:border-neon-cyan/15 bg-bg-800/40 grid-bg p-3">
        <nav className="flex flex-col gap-1">
          {visibleNav.map((item, i) => (
            <NavLink
              key={item.to}
              to={item.to}
              draggable={editingNav}
              onDragStart={(e) => {
                if (!editingNav) return;
                dragIndex.current = i;
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', item.to); } catch { /* ignore */ }
              }}
              onDragOver={(e) => {
                if (!editingNav) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                if (!editingNav) return;
                e.preventDefault();
                const from = dragIndex.current;
                if (from == null) return;
                if (from !== i) reorder(from, i);
                dragIndex.current = null;
              }}
              onDragEnd={() => { dragIndex.current = null; }}
              className={({ isActive }) =>
                classNames(
                  'flex items-center gap-3 px-3 py-2 font-display tracking-widest text-xs uppercase transition-all border',
                  editingNav ? 'cursor-grab active:cursor-grabbing' : 'border-transparent',
                  !editingNav && isActive
                    ? 'bg-neon-cyan/10 border-neon-cyan/40 neon-text-cyan shadow-neon-cyan/30'
                    : !editingNav
                      ? 'text-ink-200 hover:bg-bg-700 hover:border-ink-500'
                      : isActive
                        ? 'border-neon-cyan/40 neon-text-cyan bg-neon-cyan/5'
                        : 'border-ink-500/30 text-ink-200 hover:border-neon-cyan/40',
                )
              }
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
              {/* Plateau badge — only on the Insights link. Pulsed
                  red when the snapshot is stale (cron missed a week),
                  amber otherwise. Empty when count = 0 or no data. */}
              {item.to === '/insights' && (plateauBadgeQ.data?.count ?? 0) > 0 && (
                <span
                  className={classNames(
                    'text-[10px] font-mono px-1.5 py-0.5 border rounded',
                    plateauBadgeQ.data?.stale
                      ? 'text-rose-300 border-rose-500/40 bg-rose-500/10 animate-pulse'
                      : 'text-amber-300 border-amber-500/40 bg-amber-500/10',
                  )}
                  title={
                    plateauBadgeQ.data?.stale
                      ? `Cron missed a week — last snapshot is stale`
                      : `${plateauBadgeQ.data?.count} plateau flag${(plateauBadgeQ.data?.count ?? 0) === 1 ? '' : 's'} this week`
                  }
                >
                  {plateauBadgeQ.data?.count} stale
                </span>
              )}
              {editingNav && (
                <span className="text-ink-400 text-[10px] tracking-normal" aria-hidden="true">
                  ⠿
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Sidebar footer: reorder toggle (edit mode) + local clock. */}
        <div className="mt-6 pt-4 border-t border-neon-cyan/10 space-y-3">
          {editingNav ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingNav(false)}
                className="flex-1 px-2 py-1 text-[10px] font-display tracking-widest uppercase border border-neon-lime text-neon-lime bg-neon-lime/10 hover:bg-neon-lime/20"
              >
                ✓ Done
              </button>
              <button
                type="button"
                onClick={() => {
                  reset();
                  setEditingNav(false);
                }}
                className="px-2 py-1 text-[10px] font-mono border border-ink-500/40 text-ink-300 hover:border-neon-magenta hover:text-neon-magenta"
                title="Reset sidebar order to the default"
              >
                reset
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingNav(true)}
              className="w-full px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-ink-400 border border-ink-500/30 hover:border-neon-cyan hover:text-neon-cyan transition-all"
              title="Drag-to-reorder the sidebar (persists across reloads)"
            >
              ⠿ Reorder
            </button>
          )}
          <div className="text-[10px] text-ink-400 font-mono leading-relaxed">
            <div>// local time</div>
            <div className="text-neon-cyan tabular-nums">{now.toLocaleString()}</div>
          </div>
        </div>
      </aside>

      {/* Mobile full-screen menu overlay. Renders every item the user
          can see (respects user.isAdmin for /admin). Auto-closes on
          navigation via the NavLink's onClick handler so back/forward
          and direct deep-links behave naturally. Escape also closes. */}
      {menuOpen && (
        <MobileMenuOverlay
          items={visibleNav}
          user={user}
          onClose={() => setMenuOpen(false)}
          onLogout={handleLogout}
        />
      )}

      {/* Main content. Mobile gets bottom padding to clear the bottom
          nav... but the bottom nav is gone now, so only a small
          safe-area inset for phones with a home indicator. */}
      <main className="md:row-start-2 p-4 md:p-6 overflow-y-auto" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}>
        {children}
      </main>
    </div>
  );
}

/**
 * Full-screen mobile navigation overlay. Slides in from the top,
 * covers the entire viewport, and lists every nav item in a 3-col
 * grid. Tapping a route closes the overlay (handled by the NavLink
 * onClick via the parent).
 */
function MobileMenuOverlay({
  items,
  user,
  onClose,
  onLogout,
}: {
  items: Array<{ to: string; label: string; icon: string }>;
  user: User | null;
  onClose: () => void;
  onLogout: () => void;
}) {
  // Escape closes the overlay. Listener cleans up on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="md:hidden fixed inset-0 z-40 bg-bg-900/95 backdrop-blur-md overflow-y-auto"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center justify-between px-3 h-[60px]">
        <div className="w-10 h-10" /> {/* spacer to match the hamburger's column width */}
        <div className="font-display tracking-[0.4em] text-sm neon-text-cyan pointer-events-none">
          FIT<span className="hidden md:inline">//</span><span className="md:hidden">·</span>QUEST
        </div>
        {/* The X-close button is already rendered in the top bar
            (the hamburger morphs into X), so this side just shows a
            spacer to keep the title centered. */}
        <div className="w-10 h-10" />
      </div>

      {/* User summary */}
      {user && (
        <div className="px-4 py-3 border-b border-neon-cyan/15 bg-bg-800/40 flex items-center gap-3">
          <div className="font-display tracking-widest text-base neon-text-cyan uppercase">
            {user.username}
          </div>
          <div className="flex-1" />
          <span className="font-mono text-xs text-neon-cyan">L{user.level}</span>
          <span className="font-mono text-xs text-neon-amber">{user.gold}G</span>
        </div>
      )}

      {/* Item grid. Same active-state styling as the sidebar so users
          get visual continuity between mobile and desktop. */}
      <nav className="p-3">
        <div className="grid grid-cols-3 gap-2">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                classNames(
                  'flex flex-col items-center gap-2 py-4 border transition-colors',
                  isActive
                    ? 'border-neon-cyan/60 bg-neon-cyan/10 text-neon-cyan'
                    : 'border-ink-700/50 text-ink-200 hover:border-ink-300 hover:bg-bg-700/40',
                )
              }
            >
              <span className="text-2xl">{item.icon}</span>
              <span className="font-display tracking-widest text-[10px] uppercase">{item.label}</span>
            </NavLink>
          ))}
        </div>

        {user && (
          <div className="mt-6 pt-4 border-t border-ink-700/30 flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
              signed in as <span className="text-ink-200">{user.username}</span>
            </span>
            <button onClick={onLogout} className="btn-ghost text-[10px]">
              Logout
            </button>
          </div>
        )}
      </nav>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 mb-4 md:mb-6 pb-3 border-b border-neon-cyan/15">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl font-display tracking-widest neon-text-cyan uppercase truncate">{title}</h1>
        {subtitle && <div className="text-xs text-ink-300 font-mono mt-1">{subtitle}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}