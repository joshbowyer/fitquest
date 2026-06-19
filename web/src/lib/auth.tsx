import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export type ClassName =
  | 'BODYBUILDER'
  | 'POWERLIFTER'
  | 'CALISTHENIST'
  | 'ENDURANCE'
  | 'HYBRID';

export type User = {
  id: string;
  email: string;
  username: string;
  level: number;
  xp: number;
  gold: number;
  class: ClassName | null;
  heightCm: number | null;
  wristCm: number | null;
  ankleCm: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  birthDate: string | null;
  progress?: { current: number; needed: number; pct: number };
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

  async function refresh() {
    try {
      const r = await api<{ user: User }>('/auth/me');
      setUser(r.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setUser(null);
  }

  useEffect(() => {
    refresh();
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
