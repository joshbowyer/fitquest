import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { NeonButton } from '@/components/NeonButton';

export function LoginPage() {
  const navigate = useNavigate();
  const { refresh, setUser } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ user: any }>('/auth/login', {
        method: 'POST',
        body: { identifier, password },
      });
      setUser(r.user);
      await refresh();
      navigate('/dashboard');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md panel scanline p-8">
        <div className="text-center mb-8">
          <div className="font-display tracking-[0.5em] text-3xl neon-text-cyan mb-2">FIT//QUEST</div>
          <div className="text-xs font-mono text-ink-300 tracking-widest">PERSONAL FITNESS RPG // v0.1</div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
              Username or Email
            </label>
            <input
              className="input-neon"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
              Passcode
            </label>
            <input
              className="input-neon"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {err && (
            <div className="text-xs font-mono text-neon-magenta border border-neon-magenta/30 bg-neon-magenta/5 p-2">
              ! {err}
            </div>
          )}
          <NeonButton type="submit" disabled={busy} fullWidth>
            {busy ? 'Authenticating…' : '→ Enter'}
          </NeonButton>
        </form>
        <div className="mt-6 text-center text-xs font-mono text-ink-300">
          New operative?{' '}
          <Link to="/register" className="neon-text-cyan hover:underline">
            Register
          </Link>
        </div>
      </div>
    </div>
  );
}
