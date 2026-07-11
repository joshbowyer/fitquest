import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth, type User } from '@/lib/auth';
import { CLASS_META } from '@/lib/types';
import { classNames } from '@/lib/format';
import { useNavOrder } from '@/hooks/useNavOrder';
import { useLiveClock } from '@/hooks/useLiveClock';
import { api } from '@/lib/api';
import { MorningPopup } from './MorningPopup';
import { NotificationFlyout } from './NotificationFlyout';
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
  { to: '/coach',        label: 'AI Coach',   icon: '✺', mobile: false },
  { to: '/todos',        label: 'Todos',      icon: '☐', mobile: false },
  { to: '/notifications', label: 'Notifications', icon: '☖', mobile: false },
  { to: '/recovery',     label: 'Recovery',   icon: '☾', mobile: false },
  { to: '/forecast',     label: 'Forecast',   icon: '☀', mobile: true },
  { to: '/calendar',     label: 'Calendar',   icon: '◷', mobile: false },
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
  { to: '/shop',         label: 'Pet Shop',   icon: '⚞', mobile: false },
  { to: '/pet',          label: 'Pet',        icon: '⚝', mobile: true  },
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
  // Unread notification count — drives the bell badge in the top bar.
  // Polls every 60s; also invalidated by the /notifications page's
  // mutations (shared ['notifications'] query key prefix).
  const unreadQ = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
    enabled: !!user,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const unreadCount = unreadQ.data?.count ?? 0;
  /// Mobile menu overlay. Single boolean — when true, the
  /// hamburger morphs into an X and a full-screen menu renders.
  const [menuOpen, setMenuOpen] = useState(false);
  /// Notification flyout. Toggled by the bell button in the top
  /// bar (both desktop and mobile). Replaces the previous
  /// navigate('/notifications') behaviour so the user can scan
  /// recent notifications without leaving the current page. The
  /// flyout handles its own outside-click + Escape dismiss and
  /// calls onClose to flip this back to false.
  const [notifOpen, setNotifOpen] = useState(false);
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
        className="app-topbar md:col-span-2 md:border-b md:border-neon-cyan/15 bg-bg-800 z-30
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

          {/* Title — flows naturally in the flex row so it sits
              immediately right of the hamburger on mobile (no
              longer centered, which overlapped with the 10-heart
              row in the dashboard hero on narrow viewports).
              Desktop uses the same flex flow with the hamburger
              hidden, so the title stays in its natural left-edge
              position. The flex-1 spacer to the right of the title
              pushes the desktop status row to the right edge. */}
          <div className="font-display tracking-[0.4em] text-sm neon-text-cyan shrink-0">
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
              {/* HP bar (rendered from the user's hearts, max 10). Green
                  fill regardless of Casual/Hardcore — the gradient of
                  damage is the same. Multiplier shown next to it.
                  Pulses red at ≤3 to signal "you're getting low." */}
              {user && (
                <div
                  className={classNames(
                    'flex items-center gap-1.5',
                    (user.hearts ?? 10) <= 3 && 'animate-heart-warn',
                  )}
                  title={`${Math.max(0, Math.min(10, user.hearts ?? 10))}/10 hearts · ×${(user.heartMultiplier ?? 1).toFixed(2)} multiplier`}
                >
                  <span className="text-[10px] font-mono uppercase tracking-widest text-ink-300">
                    HP
                  </span>
                  <div className="w-16 h-2 bg-bg-900 border border-neon-lime/30 rounded">
                    <div
                      className="h-full bg-neon-lime rounded transition-all"
                      style={{
                        width: `${Math.max(0, Math.min(100, ((user.hearts ?? 10) / 10) * 100))}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-mono tabular-nums text-rose-300">
                    ×{(user.heartMultiplier ?? 1).toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className={`text-[10px] uppercase tracking-widest ${colorClass}`}>
                  {user.classDisplay ?? cls?.label ?? 'No class'}
                </span>
              </div>
              {/* Notification bell + unread badge. Opens the
                  compact flyout anchored under the bell instead of
                  navigating to /notifications directly — the
                  flyout has its own See All button that does the
                  full-nav if the user wants the inbox. aria-
                  expanded drives screen-reader announcements for
                  the popup state. data-notif-bell is read by the
                  flyout's outside-click handler so a re-click on
                  the bell while the flyout is open doesn't get
                  interpreted as "click outside → close" (the bell
                  is outside the flyout's panel). */}
              <button
                type="button"
                data-notif-bell
                aria-expanded={notifOpen}
                aria-haspopup="dialog"
                onClick={() => setNotifOpen((v) => !v)}
                className="relative w-8 h-8 flex items-center justify-center text-neon-cyan hover:bg-bg-700/60 rounded transition-colors"
                aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
                title="Notifications"
              >
                <span className="text-base leading-none">☖</span>
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 flex items-center justify-center rounded-full bg-neon-magenta text-bg-900 text-[9px] font-bold tabular-nums">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
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
              <button
                type="button"
                data-notif-bell
                aria-expanded={notifOpen}
                aria-haspopup="dialog"
                onClick={() => setNotifOpen((v) => !v)}
                className="relative w-7 h-7 flex items-center justify-center text-neon-cyan"
                aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
              >
                <span className="text-sm leading-none">☖</span>
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[13px] h-[13px] px-0.5 flex items-center justify-center rounded-full bg-neon-magenta text-bg-900 text-[8px] font-bold tabular-nums">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              <span className="neon-text-cyan font-bold">L{user.level}</span>
              <span className="neon-text-amber">{user.gold}G</span>
              <div
                className={classNames(
                  'flex items-center gap-1',
                  (user.hearts ?? 10) <= 3 && 'animate-heart-warn',
                )}
                title={`${Math.max(0, Math.min(10, user.hearts ?? 10))}/10 hearts · ×${(user.heartMultiplier ?? 1).toFixed(2)} multiplier`}
              >
                <div className="w-12 h-1.5 bg-bg-900 border border-neon-lime/30 rounded">
                  <div
                    className="h-full bg-neon-lime rounded transition-all"
                    style={{
                      width: `${Math.max(0, Math.min(100, ((user.hearts ?? 10) / 10) * 100))}%`,
                    }}
                  />
                </div>
                <span className="text-[9px] font-mono tabular-nums text-rose-300">
                  ×{(user.heartMultiplier ?? 1).toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Sidebar — desktop only. Renders the same NavLink list as
          the mobile overlay so behaviour stays consistent. */}
      <aside className="app-sidebar hidden md:block md:row-start-2 md:border-r md:border-neon-cyan/15 bg-bg-800 p-3">
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
          onReorder={reorder}
          onReset={reset}
        />
      )}

      {/* Main content. Mobile gets bottom padding to clear the bottom
          nav... but the bottom nav is gone now, so only a small
          safe-area inset for phones with a home indicator. */}
      <main className="md:row-start-2 p-4 md:p-6 overflow-y-auto" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}>
        {children}
      </main>

      {/* Morning popup — Habitica-style recap modal. Mounted here
          (not inside any individual page) so the first-interaction
          trigger fires on any page the user lands on, and so the
          state persists across SPA route changes. The modal
          itself renders via createPortal to document.body, so its
          visual position is independent of this mount point. */}
      <MorningPopup />

      {/* Notification flyout. Same mount-point pattern as
          MorningPopup — always mounted, the component itself
          decides whether to render via portal based on the `open`
          prop. Always-on-mount keeps the react-query cache warm
          (the second open after a stale-while-revalidate window
          returns cached data instantly). */}
      <NotificationFlyout
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
      />
    </div>
  );
}

/**
 * Full-screen mobile navigation overlay. Slides in from the top,
 * covers the entire viewport, and lists every nav item in a 3-col
 * grid. Tapping a route closes the overlay (handled by the NavLink
 * onClick via the parent).
 *
 * Reorder mode: a "Reorder" toggle button in the top bar lets the
 * user drag-to-reorder items. Same `useNavOrder` hook + drag-and-
 * drop primitives as the desktop sidebar. Items get a drag handle
 * glyph + a 1px gap between them so the drop target is obvious.
 */
function MobileMenuOverlay({
  items,
  user,
  onClose,
  onLogout,
  onReorder,
  onReset,
}: {
  items: Array<{ to: string; label: string; icon: string; mobile?: boolean; requiresAdmin?: boolean }>;
  user: User | null;
  onClose: () => void;
  onLogout: () => void;
  onReorder: (from: number, to: number) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const dragIndex = useRef<number | null>(null);

  // Escape closes the overlay. Listener cleans up on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Auto-exit edit mode on close. Otherwise a re-open would land
  // in edit mode unexpectedly.
  useEffect(() => () => setEditing(false), []);

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
          get visual continuity between mobile and desktop. In edit
          mode, items become draggable with a 1px gap between them and
          a 4px gap on the side to show drop targets. Drag handle ⠿
          appears on the top-right of each cell. */}
      <nav className="p-3">
        <div
          className={classNames(
            'grid grid-cols-3 gap-2',
            editing && 'gap-y-1',
          )}
        >
          {items.map((item, idx) => (
            <div
              key={item.to}
              className="relative"
              draggable={editing}
              onDragStart={(e) => {
                if (!editing) return;
                dragIndex.current = idx;
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', item.to); } catch { /* ignore */ }
              }}
              onDragOver={(e) => {
                if (!editing) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                if (!editing) return;
                e.preventDefault();
                const from = dragIndex.current;
                if (from === null || from === idx) return;
                onReorder(from, idx);
                dragIndex.current = null;
              }}
            >
              <NavLink
                to={item.to}
                onClick={editing ? (e) => e.preventDefault() : onClose}
                className={({ isActive }) =>
                  classNames(
                    'flex flex-col items-center gap-2 py-4 border transition-colors',
                    editing
                      ? 'cursor-grab active:cursor-grabbing border-neon-amber/60 bg-neon-amber/5'
                      : isActive
                      ? 'border-neon-cyan/60 bg-neon-cyan/10 text-neon-cyan'
                      : 'border-ink-700/50 text-ink-200 hover:border-ink-300 hover:bg-bg-700/40',
                  )
                }
              >
                <span className="text-2xl">{item.icon}</span>
                <span className="font-display tracking-widest text-[10px] uppercase">{item.label}</span>
                {editing && (
                  <span className="absolute top-1 right-1 text-xs text-neon-amber leading-none select-none" aria-hidden>
                    ⠿
                  </span>
                )}
              </NavLink>
            </div>
          ))}
        </div>

        {/* Edit / Done toggle. Same wording as the desktop sidebar so
            users see one consistent affordance. */}
        <div className="mt-4 flex items-center justify-between gap-2">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="flex-1 px-2 py-1.5 text-[10px] font-display tracking-widest uppercase border border-neon-lime text-neon-lime bg-neon-lime/10 hover:bg-neon-lime/20"
              >
                ✓ Done
              </button>
              <button
                type="button"
                onClick={() => onReset()}
                className="px-2 py-1.5 text-[10px] font-mono border border-ink-500/40 text-ink-300 hover:border-neon-magenta hover:text-neon-magenta"
                title="Reset to default order"
              >
                reset
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="w-full px-2 py-1.5 text-[10px] font-mono uppercase tracking-widest text-ink-400 border border-ink-500/30 hover:border-neon-cyan hover:text-neon-cyan transition-all"
              title="Drag-to-reorder (persists across devices)"
            >
              ⠿ Reorder
            </button>
          )}
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
    // data-page-header: lets usePullToRefresh scope its trigger zone
    // to just the top-bar + page-title area (see that hook's
    // triggerZoneSelector) instead of firing on any touch anywhere
    // in the scrollable content.
    <div data-page-header className="flex flex-wrap items-end justify-between gap-2 mb-4 md:mb-6 pb-3 border-b border-neon-cyan/15">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl font-display tracking-widest neon-text-cyan uppercase truncate">{title}</h1>
        {subtitle && <div className="text-xs text-ink-300 font-mono mt-1">{subtitle}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}