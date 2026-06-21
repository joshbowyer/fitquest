import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { ClassName } from './types';
import type { UnitSystem } from './units';

export type { ClassName, UnitSystem };

export type ClassLockStatus = {
  locked: boolean;
  remainingMs: number;
  unlockAt: string | null;
  remainingLabel: string;
  canUseSoulstone: boolean;
  birthdayUnlock: boolean;
  nextBirthdayAt: string | null;
};

export type UserSex = 'MALE' | 'FEMALE' | 'OTHER';
export type UserHairStyle = 'SHORT' | 'LONG' | 'MOHAWK' | 'BUZZ' | 'PONYTAIL' | 'PIXIE';

export type UserAvatar = {
  hairStyle: UserHairStyle;
  hairColor: string;
  skinTone: string;
  shirtColor: string;
  pantsColor: string;
  accentColor: string;
};

export type User = {
  id: string;
  email: string;
  username: string;
  level: number;
  xp: number;
  gold: number;
  soulstones: number;
  class: ClassName | null;
  // Class evolution: 3 stages per line, derived from level.
  // Stage 1 (Lv 1-9): beginner name (e.g., Bruiser)
  // Stage 2 (Lv 10-24): intermediate (e.g., Strongman)
  // Stage 3 (Lv 25+): final (e.g., Juggernaut)
  classDisplay: string | null;
  classStage: 1 | 2 | 3 | null;
  nextPromotion: { nextStage: 2 | 3; threshold: number } | null;
  units: UnitSystem;
  sex: UserSex | null;
  heightCm: number | null;
  wristCm: number | null;
  ankleCm: number | null;
  forearmLengthCm: number | null;
  neckCircCm: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  birthDate: string | null;
  createdAt: string;
  classChangedAt: string | null;
  classLock: ClassLockStatus;
  progress?: { current: number; needed: number; pct: number };
  // IRL sacrament (Holy Orders). Set by the user from Profile → Identity.
  // The app never prompts or advertises this; +5% XP on prayer logs.
  ordained: boolean;
  // Admin access: only the first user (or anyone explicitly granted)
  // can reach the /admin page, see all users, and configure LLM.
  isAdmin?: boolean;
  // Prayer types the user commits to perform daily. Drives the
  // built-in SPIRITUAL dailies shown on the /today page.
  spiritualDailyPrayers?: ('ROSARY' | 'MASS' | 'SCRIPTURE' | 'CONTEMPLATION' | 'LITURGY_HOURS' | 'CONFESSION' | 'OTHER')[];
  // Creatine usage. Subtracts ~1.5 kg of intracellular water from
  // displayed lean-mass calculations so the number reflects contractile
  // tissue, not water.
  creatine?: boolean;
  // Auto-derived: true when the user has logged Creatine on ≥3 of the
  // last 7 days. Server-side check; the lean-mass display uses this
  // rather than the boolean `creatine` flag.
  creatineActive?: boolean;
  // IANA timezone name (e.g. "America/New_York"). Used to render
  // absolute timestamps in the user's local time.
  timezone?: string | null;
};

type AuthCtx = {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Only the very first refresh() call is allowed to clear the user.
  // Subsequent failures (e.g., a cookie race right after register/login)
  // leave the user state alone, preventing a blank-screen flash.
  const hasInitialized = useRef(false);

  async function refresh() {
    try {
      const r = await api<{ user: User }>('/auth/me');
      setUser(r.user);
    } catch {
      if (!hasInitialized.current) {
        setUser(null);
      }
    } finally {
      setLoading(false);
      hasInitialized.current = true;
    }
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    hasInitialized.current = false;
    setUser(null);
  }

  useEffect(() => {
    refresh();
    // Re-fetch on window focus so units / class / etc. stay in sync
    // when the user changes them in another tab or after a Settings save.
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, refresh, logout, setUser }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
