/**
 * First-run prompt + settings reset for the Capacitor app.
 * When the user opens the app for the first time, the bundled
 * web app has no idea where the api server is. This modal asks
 * for the api base URL and persists it to localStorage.
 *
 * Always shows the current stored URL (or "unset" if never
 * configured) so the user can verify what the app is using —
 * this caught a real bug where the user entered the web origin
 * (fitquest.joshbullock.net) instead of the api origin
 * (fitquest-api.joshbullock.net) and every request hit the SPA
 * shell.
 *
 * IMPORTANT: the api container is on its own caddy vhost
 * (fitquest-api.joshbullock.net) and the api routes are at
 * /auth, /users, /measurements, etc. — no /api prefix on the
 * api itself. If the user enters the WEB origin, every
 * request goes to the web container (which serves the SPA
 * shell). Must be the API origin.
 */
import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { NeonButton } from './NeonButton';
import { getApiBaseUrl, getApiBaseUrlSource, setApiBaseUrl, clearApiBaseUrl } from '@/lib/apiUrl';

export function FirstRunApiUrl() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [stored, setStored] = useState('');

  useEffect(() => {
    // Read the current value (or "unset" if never set) so the
    // user can verify what's stored. The modal opens on first
    // load when no URL is set; on subsequent loads it stays
    // closed unless the user explicitly resets via the modal
    // trigger in /settings.
    const cur = getApiBaseUrl();
    setStored(cur);
    if (getApiBaseUrlSource() === 'default') {
      setValue('');
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, []);

  if (!open) return null;

  return (
    <Modal open onClose={() => setOpen(false)} title="Connect to your FitQuest server" width="max-w-md">
      <div className="space-y-3">
        <div className="text-sm text-ink-200">
          The FitQuest app needs the <strong>api domain</strong> (NOT
          the web domain). The api has its own caddy vhost that
          reverse-proxies to the api container — the web
          domain serves the SPA shell and won't answer api
          requests.
        </div>
        {stored && (
          <div className="text-[10px] font-mono text-ink-400 bg-bg-900/40 border border-ink-700/30 px-2 py-1">
            <span className="text-ink-500">Currently stored:</span>{' '}
            <span className="text-neon-amber break-all">{stored}</span>
          </div>
        )}
        <input
          type="url"
          autoFocus
          placeholder="https://api.fit.example.com"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="input-neon w-full text-sm font-mono"
        />
        <div className="text-[10px] font-mono text-ink-400 space-y-0.5">
          <div>Your api domain (the one with the caddy vhost pointing at api:3001):</div>
          <div className="neon-text-cyan">https://fitquest-api.joshbullock.net</div>
          <div className="mt-1 text-ink-500">NOT <code className="text-rose-400">https://fitquest.joshbullock.net</code> — that&apos;s the web domain, every request will hit the SPA shell.</div>
        </div>
        <div className="flex justify-between gap-2 pt-1">
          {stored && (
            <button
              type="button"
              onClick={() => {
                clearApiBaseUrl();
                setStored('');
                setValue('');
              }}
              className="text-[10px] font-mono uppercase tracking-widest text-ink-400 hover:text-rose-400 px-2 py-1"
            >
              Clear stored
            </button>
          )}
          <NeonButton
            variant="lime"
            onClick={() => {
              const v = value.trim().replace(/\/+$/, ''); // strip trailing slashes
              if (v) {
                setApiBaseUrl(v);
                setOpen(false);
                // Reload to pick up the new api base.
                window.location.reload();
              }
            }}
            disabled={!value.trim()}
          >
            Save &amp; Continue
          </NeonButton>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Trigger button for re-opening the api url prompt. Mount this
 * somewhere accessible (e.g. on the Settings page) so users can
 * recover from a misconfigured URL without uninstalling the apk.
 */
export function ApiUrlSettingsTrigger() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [stored, setStored] = useState('');

  function openPrompt() {
    setStored(getApiBaseUrl());
    setValue(getApiBaseUrl());
    setOpen(true);
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={openPrompt}
        className="text-[10px] font-mono uppercase tracking-widest text-ink-400 hover:text-neon-cyan border border-ink-500/30 px-2 py-1"
      >
        Change API url
      </button>
    );
  }
  return (
    <Modal open onClose={() => setOpen(false)} title="Connect to your FitQuest server" width="max-w-md">
      <div className="space-y-3">
        <div className="text-sm text-ink-200">
          Set the <strong>api domain</strong> (NOT the web domain).
          The api container is on its own caddy vhost that
          reverse-proxies to api:3001.
        </div>
        {stored && (
          <div className="text-[10px] font-mono text-ink-400 bg-bg-900/40 border border-ink-700/30 px-2 py-1">
            <span className="text-ink-500">Currently stored:</span>{' '}
            <span className="text-neon-amber break-all">{stored}</span>
          </div>
        )}
        <input
          type="url"
          autoFocus
          placeholder="https://api.fit.example.com"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="input-neon w-full text-sm font-mono"
        />
        <div className="flex justify-between gap-2 pt-1">
          {stored && (
            <button
              type="button"
              onClick={() => {
                clearApiBaseUrl();
                setStored('');
                setValue('');
              }}
              className="text-[10px] font-mono uppercase tracking-widest text-ink-400 hover:text-rose-400 px-2 py-1"
            >
              Clear stored
            </button>
          )}
          <NeonButton
            variant="lime"
            onClick={() => {
              const v = value.trim().replace(/\/+$/, '');
              if (v) {
                setApiBaseUrl(v);
                setOpen(false);
                window.location.reload();
              }
            }}
            disabled={!value.trim()}
          >
            Save &amp; Continue
          </NeonButton>
        </div>
      </div>
    </Modal>
  );
}
