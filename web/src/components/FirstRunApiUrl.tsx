/**
 * First-run prompt + settings reset + login-page "change api
 * server" trigger for the Capacitor app + web.
 *
 * When the user opens the app for the first time, the bundled
 * web app has no idea where the api server is. This modal asks
 * for the api base URL and persists it to localStorage.
 *
 * Three mounting sites:
 *   - FirstRunApiUrl (root, first-run only) — auto-opens when
 *     no URL is set yet.
 *   - ApiUrlSettingsTrigger (Settings page) — button-triggered,
 *     "Change API url".
 *   - ApiUrlLoginTrigger (Login page) — button-triggered, so
 *     the user can recover from a misconfigured URL when login
 *     fails. Without this, the user is locked out of the app
 *     with no way to change the URL.
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
import {
  getApiBaseUrl,
  getApiBaseUrlSource,
  isApiUrlPromptDismissed,
  markApiUrlPromptDismissed,
  setApiBaseUrl,
  clearApiBaseUrl,
} from '@/lib/apiUrl';

// Shared form body. Three mounting sites render the same fields;
// extracting them keeps the validation + save logic in one place.
// `onSaved` is called after a successful save (parent can close
// the modal, reload the page, etc.). `onClose` is called when
// the user dismisses without saving.
function ApiUrlFormBody({ onSaved, onClose }: { onSaved?: () => void; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [stored, setStored] = useState('');

  useEffect(() => {
    const cur = getApiBaseUrl();
    setStored(cur);
    setValue(cur);
  }, []);

  function save() {
    const v = value.trim().replace(/\/+$/, ''); // strip trailing slashes
    if (!v) return;
    setApiBaseUrl(v);
    onSaved?.();
  }

  return (
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
        <div className="flex items-center gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-[10px] font-mono uppercase tracking-widest text-ink-400 hover:text-ink-200 px-2 py-1"
            >
              Cancel
            </button>
          )}
          <NeonButton
            variant="lime"
            onClick={save}
            disabled={!value.trim()}
          >
            Save &amp; Continue
          </NeonButton>
        </div>
      </div>
    </div>
  );
}

export function FirstRunApiUrl() {
  // Auto-opens on mount ONLY when (a) no URL is stored AND
  // (b) the user has never dismissed the prompt. Once they save
  // OR dismiss, we mark the prompt dismissed in localStorage and
  // it never re-opens unless the user explicitly invokes the
  // Settings / Login "Change API url" trigger (which sets
  // `clearApiBaseUrl` + `clearApiUrlPromptDismissed` first).
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (isApiUrlPromptDismissed()) {
      setOpen(false);
      return;
    }
    if (getApiBaseUrlSource() === 'default') setOpen(true);
  }, []);
  if (!open) return null;
  return (
    <Modal
      open
      onClose={() => {
        // Closing without saving still marks the prompt as
        // dismissed. The user can re-open it from Settings/Login.
        markApiUrlPromptDismissed();
        setOpen(false);
      }}
      title="Connect to your FitQuest server"
      width="max-w-md"
      hideCloseButton
    >
      <ApiUrlFormBody
        onSaved={() => {
          // setApiBaseUrl already marks dismissed internally.
          window.location.reload();
        }}
        onClose={() => {
          markApiUrlPromptDismissed();
          setOpen(false);
        }}
      />
    </Modal>
  );
}

/**
 * Trigger button for re-opening the api url prompt. Mount this
 * somewhere accessible (e.g. on the Settings page or the Login
 * page) so users can recover from a misconfigured URL without
 * uninstalling the apk.
 */
function ApiUrlTrigger({ label = 'Change API url', buttonClass = '' }: { label?: string; buttonClass?: string }) {
  const [open, setOpen] = useState(false);
  function openPrompt() {
    setOpen(true);
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={openPrompt}
        className={
          buttonClass ||
          'text-[10px] font-mono uppercase tracking-widest text-ink-400 hover:text-neon-cyan border border-ink-500/30 px-2 py-1'
        }
      >
        {label}
      </button>
    );
  }
  return (
    <Modal open onClose={() => setOpen(false)} title="Connect to your FitQuest server" width="max-w-md" hideCloseButton>
      <ApiUrlFormBody
        onSaved={() => window.location.reload()}
        onClose={() => setOpen(false)}
      />
    </Modal>
  );
}

// Backwards-compatible export used by /settings.
export function ApiUrlSettingsTrigger() {
  return <ApiUrlTrigger label="Change API url" />;
}

/**
 * Login-page "change API server" trigger. Same body as the
 * Settings trigger but styled for the Login card (so the user
 * notices it when they're stuck). Shows the same "currently
 * stored" field so they can spot the typo in their existing URL.
 */
export function ApiUrlLoginTrigger() {
  return (
    <ApiUrlTrigger
      label="Change API server"
      buttonClass="text-[10px] font-mono uppercase tracking-widest text-neon-amber hover:text-neon-cyan border border-neon-amber/40 px-2 py-1"
    />
  );
}
