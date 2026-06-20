import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { CLASS_META } from '@/lib/types';
import { classNames } from '@/lib/format';
import type { ReactNode } from 'react';

type Props = { children: ReactNode };

type NavItem = { to: string; label: string; icon: string; mobile?: boolean };

// Mobile = primary 5 items shown in bottom nav on phones.
// Desktop sidebar shows all items.
// Items not in `mobile` only appear on tablet+ via the "More" drawer.
const NAV: NavItem[] = [
  { to: '/dashboard',   label: 'Dashboard', icon: '◆', mobile: true },
  { to: '/quest',       label: 'Quest',    icon: '◇', mobile: true },
  { to: '/status',      label: 'Status',   icon: '◊', mobile: true },
  { to: '/workouts',    label: 'Workouts', icon: '▣', mobile: true },
  { to: '/measurements', label: 'Measure',  icon: '◎', mobile: false },
  { to: '/habits',      label: 'Habits',   icon: '◐', mobile: false },
  { to: '/insights',    label: 'Insights', icon: '◈', mobile: false },
  { to: '/skills',      label: 'Skills',   icon: '✦', mobile: false },
  { to: '/party',       label: 'Party',    icon: '⚑', mobile: true },
  { to: '/profile',     label: 'Profile',  icon: '◉', mobile: false },
  { to: '/settings',    label: 'Settings', icon: '⚙', mobile: false },
];

export function Layout({ children }: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const cls = user?.class ? CLASS_META[user.class] : null;
  const colorClass = cls ? `neon-text-${cls.color}` : 'neon-text-cyan';

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const mobileNav = NAV.filter((n) => n.mobile);

  return (
    <div className="min-h-full md:grid md:grid-cols-[220px_1fr] md:grid-rows-[60px_1fr]">
      {/* Top bar — desktop shows full status, mobile is condensed */}
      <header
        className="md:col-span-2 md:border-b md:border-neon-cyan/15 bg-bg-800/95 backdrop-blur-md z-20
                   sticky top-0 border-b border-neon-cyan/15"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center px-4 md:px-6 gap-3 md:gap-6 h-[60px]">
          <div className="font-display tracking-[0.4em] text-sm neon-text-cyan">
            FIT<span className="hidden md:inline">//</span><span className="md:hidden">·</span>QUEST
          </div>
          <div className="flex-1" />

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

          {/* Mobile-only: condensed status pill + logout */}
          {user && (
            <div className="flex md:hidden items-center gap-2 text-xs font-mono">
              <span className="neon-text-cyan font-bold">L{user.level}</span>
              <span className="neon-text-amber">{user.gold}G</span>
              <button onClick={handleLogout} className="text-ink-300 hover:text-ink-50 text-xs ml-1">
                ⎋
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Sidebar — desktop only */}
      <aside className="hidden md:block md:row-start-2 md:border-r md:border-neon-cyan/15 bg-bg-800/40 grid-bg p-3">
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                classNames(
                  'flex items-center gap-3 px-3 py-2 font-display tracking-widest text-xs uppercase transition-all border border-transparent',
                  isActive
                    ? 'bg-neon-cyan/10 border-neon-cyan/40 neon-text-cyan shadow-neon-cyan/30'
                    : 'text-ink-200 hover:bg-bg-700 hover:border-ink-500'
                )
              }
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-6 pt-4 border-t border-neon-cyan/10 text-[10px] text-ink-400 font-mono leading-relaxed">
          <div>// local time</div>
          <div className="text-neon-cyan">{new Date().toLocaleString()}</div>
        </div>
      </aside>

      {/* Bottom nav — mobile only */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-bg-800/95 backdrop-blur-md border-t border-neon-cyan/20"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-5 h-14">
          {mobileNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                classNames(
                  'flex flex-col items-center justify-center gap-0.5 font-display tracking-widest text-[9px] uppercase transition-colors',
                  isActive ? 'text-neon-cyan' : 'text-ink-300',
                )
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* "More" FAB — mobile only. Opens drawer with non-primary nav items. */}
      <button
        onClick={() => setMoreOpen(true)}
        className="md:hidden fixed bottom-16 right-3 z-40 w-12 h-12 rounded-full bg-neon-cyan/20 border border-neon-cyan text-neon-cyan text-xl shadow-neon-cyan/40 flex items-center justify-center"
        aria-label="More navigation"
      >
        ☰
      </button>

      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-bg-900/80 backdrop-blur-sm flex items-end"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="w-full panel-magenta p-4 max-h-[70vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="font-display tracking-widest text-sm neon-text-magenta uppercase">
                // More
              </div>
              <button
                onClick={() => setMoreOpen(false)}
                className="text-ink-300 hover:text-ink-50 text-lg"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {NAV.filter((n) => !n.mobile).map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    classNames(
                      'flex flex-col items-center gap-2 py-4 border',
                      isActive
                        ? 'border-neon-cyan/60 bg-neon-cyan/10 text-neon-cyan'
                        : 'border-ink-700/50 text-ink-200 hover:border-ink-300',
                    )
                  }
                >
                  <span className="text-2xl">{item.icon}</span>
                  <span className="font-display tracking-widest text-[10px] uppercase">{item.label}</span>
                </NavLink>
              ))}
            </div>
            {user && (
              <div className="mt-4 pt-4 border-t border-ink-700/30 flex items-center justify-between text-xs font-mono">
                <span className="text-ink-300">{user.username}</span>
                <button onClick={handleLogout} className="btn-ghost text-[10px]">
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main content. Mobile gets bottom padding to clear the bottom nav. */}
      <main className="md:row-start-2 p-4 md:p-6 overflow-y-auto pb-24 md:pb-6">
        {children}
      </main>
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