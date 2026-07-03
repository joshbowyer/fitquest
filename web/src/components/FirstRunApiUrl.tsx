/**
 * First-run prompt for the Capacitor app. When the user opens
 * the app for the first time, the bundled web app has no
 * idea where the api server is. This modal asks for the api
 * base URL (e.g. https://fit.example.com or
 * http://192.168.1.50:3001 for LAN dev) and persists it to
 * localStorage so the rest of the app can use it.
 *
 * Skipped if a URL is already set (via the build-time
 * VITE_API_URL or a previous run's localStorage entry). The
 * modal is dismissable (Esc / X) and re-shows on next launch
 * if still unset.
 */
import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { NeonButton } from './NeonButton';
import { getApiBaseUrl, getApiBaseUrlSource, setApiBaseUrl } from '@/lib/apiUrl';

export function FirstRunApiUrl() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  useEffect(() => {
    // Show only if we have no real URL. The 'default' source
    // means the fallback /api is in effect, which won't work
    // in the WebView (no proxy). The 'env' source means the
    // developer baked in a URL at build time — no prompt needed.
    if (getApiBaseUrlSource() === 'default') {
      const env = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
      setValue(env);
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
          The FitQuest app needs to know where your server lives.
          Enter the base URL (no trailing slash). If the api is
          reverse-proxied under a path (e.g. <code>/api</code>),
          include that path here too — the app's requests
          append to the base URL verbatim. The app remembers
          the value across launches.
        </div>
        <input
          type="url"
          autoFocus
          placeholder="https://api.fit.example.com/api"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="input-neon w-full text-sm font-mono"
        />
        <div className="text-[10px] font-mono text-ink-400 space-y-0.5">
          <div>For local dev: <span className="neon-text-cyan">http://10.0.2.2:3001/api</span> (emulator → host).</div>
          <div>For same-origin: <span className="neon-text-cyan">https://fit.example.com/api</span> (web &amp; api on the same domain).</div>
          <div>For split api domain: <span className="neon-text-cyan">https://api.fit.example.com/api</span> (separate caddy vhost, no /api prefix on the proxy itself — so the prefix is here).</div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
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
