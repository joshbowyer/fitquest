import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { NeonButton } from '@/components/NeonButton';
import { ApiUrlLoginTrigger } from '@/components/FirstRunApiUrl';

type TotpStep = {
  /// We've already submitted username+password. Now we need
  /// a TOTP code (or recovery code) before we get a full session.
  username: string;
};

export function LoginPage() {
  const navigate = useNavigate();
  const { refresh, setUser } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [totpStep, setTotpStep] = useState<TotpStep | null>(null);
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(true);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ user?: any; requiresTotp?: boolean }>('/auth/login', {
        method: 'POST',
        body: { identifier, password },
      });
      if (r.requiresTotp) {
        // Password accepted; we got a TOTP_PENDING session cookie.
        // The browser will send it on the next request automatically.
        setTotpStep({ username: identifier });
        setErr(null);
        return;
      }
      setUser(r.user);
      await refresh();
      navigate('/dashboard');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function onTotpSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ user: any }>('/auth/login/totp', {
        method: 'POST',
        body: { code, trustDevice },
      });
      setUser(r.user);
      await refresh();
      navigate('/dashboard');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  if (totpStep) {
    return (
      <div className="min-h-screen grid-bg flex items-center justify-center p-6">
        <div className="w-full max-w-md panel scanline p-8">
          <div className="text-center mb-6">
            <div className="font-display tracking-[0.5em] text-2xl neon-text-cyan mb-1">FIT//QUEST</div>
            <div className="text-xs font-mono text-neon-amber tracking-widest">TWO-FACTOR AUTH</div>
            <div className="text-[10px] font-mono text-ink-400 mt-2">
              Welcome back, <span className="text-neon-cyan">{totpStep.username}</span>.
            </div>
          </div>
          <form onSubmit={onTotpSubmit} className="space-y-4">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
                6-digit code
              </label>
              <input
                className="input-neon text-center text-3xl tracking-[0.5em] font-mono"
                maxLength={11}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d- ]/g, ''))}
                autoFocus
              />
              <div className="text-[10px] font-mono text-ink-400 mt-1">
                Open your authenticator app. Or paste a recovery code
                (XXXX-XXXX-XX).
              </div>
            </div>
            <label className="flex items-center gap-2 text-[11px] font-mono text-ink-300 cursor-pointer">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
                className="accent-neon-cyan"
              />
              Remember this device for 90 days
            </label>
            {err && (
              <div className="text-xs font-mono text-neon-magenta border border-neon-magenta/30 bg-neon-magenta/5 p-2">
                ! {err}
              </div>
            )}
            <NeonButton type="submit" disabled={busy || code.length < 6} fullWidth variant="cyan">
              {busy ? 'Verifying…' : '→ Confirm'}
            </NeonButton>
            <button
              type="button"
              onClick={() => {
                setTotpStep(null);
                setCode('');
                setErr(null);
              }}
              className="w-full text-[10px] font-mono text-ink-400 hover:text-ink-200"
            >
              ← back
            </button>
          </form>
        </div>
      </div>
    );
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
              Callsign (username)
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
        <div className="mt-6 flex flex-col items-center gap-2 text-xs font-mono text-ink-300">
          <div>
            New operative?{' '}
            <Link to="/register" className="neon-text-cyan hover:underline">
              Register
            </Link>
          </div>
          <ApiUrlLoginTrigger />
        </div>
      </div>
    </div>
  );
}