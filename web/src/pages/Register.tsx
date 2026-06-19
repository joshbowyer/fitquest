import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { NeonButton } from '@/components/NeonButton';

export function RegisterPage() {
  const navigate = useNavigate();
  const { refresh, setUser } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ user: any }>('/auth/register', {
        method: 'POST',
        body: { email, username, password },
      });
      setUser(r.user);
      await refresh();
      navigate('/profile');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md panel scanline p-8">
        <div className="text-center mb-8">
          <div className="font-display tracking-[0.5em] text-3xl neon-text-cyan mb-2">FIT//QUEST</div>
          <div className="text-xs font-mono text-ink-300 tracking-widest">CREATE OPERATIVE // v0.1</div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
              Email
            </label>
            <input
              className="input-neon"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
              Callsign (username)
            </label>
            <input
              className="input-neon"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              pattern="[a-zA-Z0-9_-]{3,32}"
              title="3-32 chars, letters/numbers/_/-"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
              Passcode
            </label>
            <input
              className="input-neon"
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <div className="text-[10px] text-ink-400 mt-1 font-mono">min 8 characters</div>
          </div>
          {err && (
            <div className="text-xs font-mono text-neon-magenta border border-neon-magenta/30 bg-neon-magenta/5 p-2">
              ! {err}
            </div>
          )}
          <NeonButton type="submit" disabled={busy} fullWidth>
            {busy ? 'Creating…' : '→ Initialize'}
          </NeonButton>
        </form>
        <div className="mt-6 text-center text-xs font-mono text-ink-300">
          Already operative?{' '}
          <Link to="/login" className="neon-text-cyan hover:underline">
            Login
          </Link>
        </div>
      </div>
    </div>
  );
}
