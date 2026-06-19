import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { CLASS_META } from '@/lib/types';
import { classNames, formatPct } from '@/lib/format';
import type { ReactNode } from 'react';

type Props = { children: ReactNode };

const NAV = [
  { to: '/dashboard', label: 'Stat Sheet', icon: '◆' },
  { to: '/workouts', label: 'Workouts', icon: '▣' },
  { to: '/measurements', label: 'Measurements', icon: '◎' },
  { to: '/habits', label: 'Habits', icon: '◐' },
  { to: '/insights', label: 'Insights', icon: '◈' },
  { to: '/skills', label: 'Skills', icon: '✦' },
  { to: '/party', label: 'Party', icon: '⚑' },
  { to: '/profile', label: 'Profile', icon: '◉' },
];

export function Layout({ children }: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const cls = user?.class ? CLASS_META[user.class] : null;
  const colorClass = cls ? `neon-text-${cls.color}` : 'neon-text-cyan';

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="min-h-full grid grid-cols-[220px_1fr] grid-rows-[60px_1fr]">
      {/* Top bar */}
      <header className="col-span-2 border-b border-neon-cyan/15 bg-bg-800/80 backdrop-blur-sm flex items-center px-6 gap-6 z-10">
        <div className="font-display tracking-[0.4em] text-sm neon-text-cyan">FIT//QUEST</div>
        <div className="flex-1" />
        {user && (
          <div className="flex items-center gap-5 text-sm font-mono">
            <div className="flex items-center gap-2">
              <span className="text-ink-300 text-[10px] uppercase tracking-widest">LVL</span>
              <span className="neon-text-cyan text-lg font-bold">{user.level}</span>
            </div>
            <div className="w-40 hidden md:block">
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
                {cls?.label ?? 'No class'}
              </span>
            </div>
            <button onClick={handleLogout} className="btn-ghost text-[10px]">
              Logout
            </button>
          </div>
        )}
      </header>

      {/* Sidebar */}
      <aside className="row-start-2 border-r border-neon-cyan/15 bg-bg-800/40 grid-bg p-3">
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

      {/* Main */}
      <main className="row-start-2 p-6 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-6 pb-3 border-b border-neon-cyan/15">
      <div>
        <h1 className="text-2xl font-display tracking-widest neon-text-cyan uppercase">{title}</h1>
        {subtitle && <div className="text-xs text-ink-300 font-mono mt-1">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}
