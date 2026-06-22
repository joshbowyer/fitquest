import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { classNames, formatRelative } from '@/lib/format';
import { Modal } from '@/components/Modal';

type AdminUser = {
  id: string;
  username: string;
  email: string;
  isAdmin: boolean;
  twoFactorEnabled: boolean;
  class: string | null;
  level: number;
  xp: number;
  gold: number;
  soulstones: number;
  createdAt: string;
  _count: { sessions: number; workouts: number };
};

type LlmConfig = {
  id?: string;
  provider: 'OPENAI' | 'ANTHROPIC' | 'OLLAMA' | 'MINIMAX';
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
  enabled: boolean;
  // Secondary / fallback (any of these can be null/empty = no fallback)
  fallbackEnabled: boolean;
  fallbackProvider: 'OPENAI' | 'ANTHROPIC' | 'OLLAMA' | 'MINIMAX' | null;
  fallbackApiKey: string | null;
  fallbackBaseUrl: string | null;
  fallbackModel: string | null;
  // Shared
  systemPrompt: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type LlmProviderPreset = {
  baseUrl: string | null;
  defaultModel: string;
};
type LlmProviderMap = Record<string, LlmProviderPreset>;

export function AdminPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState('');

  // ---- Users ----
  const usersQ = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api<{ users: AdminUser[] }>('/admin/users'),
    enabled: !!user?.isAdmin,
  });

  // ---- LLM config ----
  const llmQ = useQuery({
    queryKey: ['admin', 'llm-config'],
    queryFn: () => api<{ config: LlmConfig }>('/admin/llm-config'),
    enabled: !!user?.isAdmin,
  });

  const providersQ = useQuery({
    queryKey: ['admin', 'llm-providers'],
    queryFn: () => api<{ providers: LlmProviderMap }>('/admin/llm-providers'),
    enabled: !!user?.isAdmin,
    staleTime: Infinity,
  });

  const [llmForm, setLlmForm] = useState<LlmConfig | null>(null);
  useEffect(() => {
    if (llmQ.data && !llmForm) setLlmForm(llmQ.data.config);
  }, [llmQ.data, llmForm]);

  const saveLlmM = useDelayedMutation({
    mutationFn: (body: LlmConfig) =>
      api<{ config: LlmConfig }>('/admin/llm-config', { method: 'PUT', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'llm-config'] });
    },
  }, 800);

  type LlmTestResult = {
    ok: boolean;
    text: string;
    model: string;
    provider: string;
    latencyMs: number;
    error?: string;
    httpStatus?: number;
    attempt?: 1 | 2 | 0;
    which?: 'primary' | 'fallback';
  };
  const testLlmM = useDelayedMutation<LlmTestResult, 'primary' | 'fallback'>({
    mutationFn: (which) =>
      api<LlmTestResult>('/admin/llm-test', { method: 'POST', body: { which } }),
  }, 1500);

  const resetPwM = useDelayedMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      api<{ ok: boolean }>(`/admin/users/${id}/reset-password`, {
        method: 'POST',
        body: { newPassword },
      }),
    onSuccess: () => {
      setResetTarget(null);
      setNewPassword('');
    },
  }, 1200);

  const clear2faM = useDelayedMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/admin/users/${id}/clear-2fa`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  }, 800);

  const toggleAdminM = useDelayedMutation({
    mutationFn: ({ id, isAdmin }: { id: string; isAdmin: boolean }) =>
      api<{ ok: boolean }>(`/admin/users/${id}/toggle-admin`, {
        method: 'POST',
        body: { isAdmin },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  }, 800);

  // ---- Render ----
  if (!user) {
    return (
      <Layout>
        <PageHeader title="Admin" subtitle="Sign in to access admin tools." />
        <Panel><p className="text-sm text-slate-400">Not signed in.</p></Panel>
      </Layout>
    );
  }
  if (!user.isAdmin) {
    return (
      <Layout>
        <PageHeader title="Admin" subtitle="You don't have access." />
        <Panel>
          <p className="text-sm text-rose-300">
            This page is reserved for administrators. Your account is
            <code className="mx-1 px-1 bg-slate-800 rounded text-xs">isAdmin: false</code>.
            If you believe you should have access, ask the existing admin to promote you.
          </p>
        </Panel>
      </Layout>
    );
  }

  return (
    <Layout>
      <PageHeader
        title="Admin Console"
        subtitle={`${usersQ.data?.users.length ?? 0} users · LLM: ${llmQ.data?.config.enabled ? 'ON' : 'OFF'}`}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* -------- Users -------- */}
        <Panel title="Users" className="lg:col-span-2">
          {usersQ.isLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : usersQ.isError ? (
            <p className="text-sm text-rose-300">Failed to load users.</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500 border-b border-slate-700">
                  <tr>
                    <th className="text-left py-2 px-2">Username</th>
                    <th className="text-left py-2 px-2">Class</th>
                    <th className="text-right py-2 px-2">Level</th>
                    <th className="text-right py-2 px-2">Gold</th>
                    <th className="text-right py-2 px-2">Stones</th>
                    <th className="text-center py-2 px-2">2FA</th>
                    <th className="text-center py-2 px-2">Admin</th>
                    <th className="text-right py-2 px-2">Joined</th>
                    <th className="text-right py-2 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {usersQ.data?.users.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-slate-800 hover:bg-slate-800/30"
                    >
                      <td className="py-2 px-2">
                        <div className="font-medium text-slate-100">{u.username}</div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </td>
                      <td className="py-2 px-2 text-slate-300">
                        {u.class ?? <span className="text-slate-600">—</span>}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {u.level}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-amber-300">
                        {u.gold}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-violet-300">
                        {u.soulstones}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {u.twoFactorEnabled ? (
                          <span className="text-emerald-400">●</span>
                        ) : (
                          <span className="text-slate-600">○</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {u.isAdmin ? (
                          <span className="text-violet-300 text-xs">★</span>
                        ) : (
                          <span className="text-slate-600 text-xs">·</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right text-xs text-slate-500">
                        {formatRelative(u.createdAt)}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <div className="flex gap-1 justify-end">
                          <NeonButton
                            size="sm"
                            variant="amber"
                            onClick={() => setResetTarget(u)}
                          >
                            Reset PW
                          </NeonButton>
                          {u.twoFactorEnabled && (
                            <NeonButton
                              size="sm"
                              variant="amber"
                              onClick={() => clear2faM.run(u.id)}
                              disabled={clear2faM.isPending}
                            >
                              Clear 2FA
                            </NeonButton>
                          )}
                          <NeonButton
                            size="sm"
                            variant={u.isAdmin ? 'magenta' : 'lime'}
                            onClick={() =>
                              toggleAdminM.run({
                                id: u.id,
                                isAdmin: !u.isAdmin,
                              })
                            }
                            disabled={
                              toggleAdminM.isPending || u.id === user.id
                            }
                            title={u.id === user.id ? "Can't change your own admin" : ''}
                          >
                            {u.isAdmin ? 'Demote' : 'Promote'}
                          </NeonButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* -------- LLM config -------- */}
        <Panel
          title="LLM Configuration"
          subtitle="Provider + key for future in-app coach/quest narrator."
          className="lg:col-span-2"
        >
          {llmQ.isLoading || !llmForm ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs uppercase text-slate-500">Provider</span>
                <div className="flex gap-2 mt-1">
                  <select
                    className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                    value={llmForm.provider}
                    onChange={(e) => {
                      const next = e.target.value as LlmConfig['provider'];
                      setLlmForm({ ...llmForm, provider: next });
                    }}
                  >
                    <option value="OPENAI">OpenAI</option>
                    <option value="ANTHROPIC">Anthropic</option>
                    <option value="OLLAMA">Ollama (local)</option>
                    <option value="MINIMAX">Minimax</option>
                  </select>
                  <NeonButton
                    type="button"
                    size="sm"
                    variant="cyan"
                    disabled={!providersQ.data}
                    onClick={() => {
                      const preset = providersQ.data?.providers[llmForm.provider];
                      if (!preset) return;
                      setLlmForm({
                        ...llmForm,
                        baseUrl: preset.baseUrl,
                        model: preset.defaultModel,
                      });
                    }}
                    title="Auto-fill base URL and default model for this provider"
                  >
                    Preset
                  </NeonButton>
                </div>
              </label>
              <label className="block">
                <span className="text-xs uppercase text-slate-500">Model</span>
                <input
                  type="text"
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                  value={llmForm.model}
                  onChange={(e) => setLlmForm({ ...llmForm, model: e.target.value })}
                  placeholder={
                    providersQ.data?.providers[llmForm.provider]?.defaultModel ?? 'model name'
                  }
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs uppercase text-slate-500 flex items-center gap-2">
                  API Key
                  {llmQ.data?.config.apiKey ? (
                    <span className="text-[10px] font-mono normal-case tracking-normal text-emerald-400">
                      ✓ key saved
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono normal-case tracking-normal text-amber-400">
                      ⚠ not set
                    </span>
                  )}
                </span>
                <input
                  type="password"
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm font-mono"
                  value={llmForm.apiKey ?? ''}
                  onChange={(e) =>
                    setLlmForm({ ...llmForm, apiKey: e.target.value || null })
                  }
                  placeholder="sk-... (enter to save, blank to keep current)"
                />
                {llmQ.data?.config.apiKey && (
                  <div className="mt-1 text-[10px] font-mono text-slate-500">
                    Currently saved as <span className="text-slate-300">{llmQ.data.config.apiKey}</span>
                    {' '}<span className="text-slate-600">— leave blank to keep</span>
                  </div>
                )}
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs uppercase text-slate-500">
                  Base URL <span className="text-slate-600">(optional)</span>
                </span>
                <input
                  type="text"
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm font-mono"
                  value={llmForm.baseUrl ?? ''}
                  onChange={(e) =>
                    setLlmForm({ ...llmForm, baseUrl: e.target.value || null })
                  }
                  placeholder="http://localhost:11434"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs uppercase text-slate-500">
                  System Prompt
                </span>
                <textarea
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                  rows={3}
                  value={llmForm.systemPrompt ?? ''}
                  onChange={(e) =>
                    setLlmForm({
                      ...llmForm,
                      systemPrompt: e.target.value || null,
                    })
                  }
                  placeholder="You are a fitness coach for an RPG-style training app…"
                />
              </label>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={llmForm.enabled}
                  onChange={(e) =>
                    setLlmForm({ ...llmForm, enabled: e.target.checked })
                  }
                  className="rounded"
                />
                <span className="text-sm text-slate-300">
                  Enabled — use this config for AI features
                </span>
              </label>
              <div className="sm:col-span-2 flex justify-end gap-2">
                <NeonButton
                  type="button"
                  variant="cyan"
                  disabled={testLlmM.isPending}
                  onClick={() => testLlmM.run('primary')}
                  title="Sends a test prompt to the saved primary model"
                >
                  {testLlmM.isPending ? 'Testing…' : 'Test Connection'}
                </NeonButton>
                <NeonButton
                  type="button"
                  variant="violet"
                  disabled={saveLlmM.isPending}
                  onClick={() => {
                    // eslint-disable-next-line no-console
                    console.log('[admin] saving LLM config', llmForm);
                    saveLlmM.run(llmForm);
                  }}
                >
                  {saveLlmM.isPending ? 'Saving…' : 'Save LLM config'}
                </NeonButton>
              </div>

              {/* -------- Fallback (secondary) model -------- */}
              <div className="sm:col-span-2 mt-3 pt-3 border-t border-ink-500/20">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm font-display tracking-widest text-ink-50">
                      Fallback (secondary) model
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      Used automatically when the primary fails (5xx, timeout,
                      network, 404 model-not-found, 429). Either side can
                      be set or unset — e.g. Ollama-only setups leave
                      primary blank and fill in fallback.
                    </div>
                  </div>
                  <label className="flex items-center gap-2 shrink-0 ml-3">
                    <input
                      type="checkbox"
                      checked={llmForm.fallbackEnabled}
                      onChange={(e) =>
                        setLlmForm({ ...llmForm, fallbackEnabled: e.target.checked })
                      }
                      className="rounded"
                    />
                    <span className="text-sm text-slate-300">Enabled</span>
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs uppercase text-slate-500">Provider</span>
                    <div className="flex gap-2 mt-1">
                      <select
                        className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                        value={llmForm.fallbackProvider ?? ''}
                        onChange={(e) => {
                          const next = (e.target.value || null) as LlmConfig['fallbackProvider'];
                          setLlmForm({ ...llmForm, fallbackProvider: next });
                        }}
                      >
                        <option value="">— None —</option>
                        <option value="OPENAI">OpenAI</option>
                        <option value="ANTHROPIC">Anthropic</option>
                        <option value="OLLAMA">Ollama (local)</option>
                        <option value="MINIMAX">Minimax</option>
                      </select>
                      <NeonButton
                        type="button"
                        size="sm"
                        variant="cyan"
                        disabled={!providersQ.data || !llmForm.fallbackProvider}
                        onClick={() => {
                          const preset =
                            providersQ.data?.providers[llmForm.fallbackProvider ?? 'OPENAI'];
                          if (!preset) return;
                          setLlmForm({
                            ...llmForm,
                            fallbackBaseUrl: preset.baseUrl,
                            fallbackModel: preset.defaultModel,
                          });
                        }}
                        title="Auto-fill base URL and default model for the fallback provider"
                      >
                        Preset
                      </NeonButton>
                    </div>
                  </label>
                  <label className="block">
                    <span className="text-xs uppercase text-slate-500">Model</span>
                    <input
                      type="text"
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                      value={llmForm.fallbackModel ?? ''}
                      onChange={(e) =>
                        setLlmForm({ ...llmForm, fallbackModel: e.target.value || null })
                      }
                      placeholder={
                        llmForm.fallbackProvider
                          ? providersQ.data?.providers[llmForm.fallbackProvider]?.defaultModel ?? 'model name'
                          : 'select a provider first'
                      }
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-xs uppercase text-slate-500 flex items-center gap-2">
                      API Key
                      {llmQ.data?.config.fallbackApiKey ? (
                        <span className="text-[10px] font-mono normal-case tracking-normal text-emerald-400">
                          ✓ key saved
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono normal-case tracking-normal text-amber-400">
                          ⚠ not set
                        </span>
                      )}
                    </span>
                    <input
                      type="password"
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm font-mono"
                      value={llmForm.fallbackApiKey ?? ''}
                      onChange={(e) =>
                        setLlmForm({ ...llmForm, fallbackApiKey: e.target.value || null })
                      }
                      placeholder="sk-... (blank = keep current)"
                    />
                    {llmQ.data?.config.fallbackApiKey && (
                      <div className="mt-1 text-[10px] font-mono text-slate-500">
                        Currently saved as <span className="text-slate-300">{llmQ.data.config.fallbackApiKey}</span>
                      </div>
                    )}
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-xs uppercase text-slate-500">
                      Base URL <span className="text-slate-600">(optional)</span>
                    </span>
                    <input
                      type="text"
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm font-mono"
                      value={llmForm.fallbackBaseUrl ?? ''}
                      onChange={(e) =>
                        setLlmForm({ ...llmForm, fallbackBaseUrl: e.target.value || null })
                      }
                      placeholder="http://localhost:11434"
                    />
                  </label>
                </div>
                <div className="mt-3 flex justify-end">
                  <NeonButton
                    type="button"
                    variant="amber"
                    disabled={
                      testLlmM.isPending ||
                      !llmForm.fallbackEnabled ||
                      !llmForm.fallbackProvider ||
                      !llmForm.fallbackModel
                    }
                    onClick={() => testLlmM.run('fallback')}
                    title="Sends a test prompt to the saved fallback model (saves first if form is dirty)"
                  >
                    {testLlmM.isPending ? 'Testing…' : 'Test Fallback'}
                  </NeonButton>
                </div>
              </div>

              {/* Last-test result (shows whichever ran last) */}
              {testLlmM.data && !testLlmM.isPending && (
                <div
                  className={classNames(
                    'sm:col-span-2 mt-2 p-2 text-[11px] font-mono border',
                    testLlmM.data.ok
                      ? 'border-emerald-500/30 text-emerald-300'
                      : 'border-rose-500/30 text-rose-300',
                  )}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>{testLlmM.data.ok ? '✓' : '✗'}</span>
                    <span className="uppercase tracking-widest">
                      {testLlmM.data.which ?? 'primary'} test
                    </span>
                    <span className="text-slate-400">
                      {testLlmM.data.model} · {testLlmM.data.provider} · {testLlmM.data.latencyMs}ms
                    </span>
                    {testLlmM.data.attempt === 2 && (
                      <span className="text-amber-300">(used fallback)</span>
                    )}
                  </div>
                  {testLlmM.data.ok ? (
                    <div className="mt-1 text-slate-200">{testLlmM.data.text}</div>
                  ) : (
                    <div className="mt-1 text-rose-200">
                      {testLlmM.data.error}
                      {testLlmM.data.httpStatus && (
                        <span className="ml-2 text-slate-500">HTTP {testLlmM.data.httpStatus}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {saveLlmM.error && (
                <p className="sm:col-span-2 text-xs text-rose-400">
                  Save failed: {String((saveLlmM.error as any)?.message ?? saveLlmM.error)}
                </p>
              )}
              {saveLlmM.data && !saveLlmM.error && (
                <p className="sm:col-span-2 text-xs text-emerald-400">
                  Saved.
                </p>
              )}
              {testLlmM.data && (
                <div
                  className={classNames(
                    'sm:col-span-2 text-xs p-2 border font-mono',
                    testLlmM.data.ok
                      ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300'
                      : 'border-rose-500/40 bg-rose-500/5 text-rose-300',
                  )}
                >
                  {testLlmM.data.ok ? (
                    <>
                      <div className="text-emerald-300 font-bold">
                        ✓ Connection successful ({testLlmM.data.latencyMs}ms)
                      </div>
                      <div className="text-slate-300 mt-1">
                        model: <b>{testLlmM.data.model}</b> · provider: {testLlmM.data.provider}
                      </div>
                      <div className="text-slate-200 mt-1 italic">
                        "{testLlmM.data.text}"
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-rose-300 font-bold">
                        ✗ Test failed {testLlmM.data.httpStatus ? `(${testLlmM.data.httpStatus})` : ''}
                      </div>
                      <div className="text-slate-300 mt-1">
                        {testLlmM.data.error}
                      </div>
                    </>
                  )}
                </div>
              )}
              {testLlmM.error && !testLlmM.data && (
                <div className="sm:col-span-2 text-xs text-rose-400 font-mono">
                  Test request failed: {String((testLlmM.error as any)?.message ?? testLlmM.error)}
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* -------- Reset password modal -------- */}
      <Modal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title={resetTarget ? `Reset password for ${resetTarget.username}` : ''}
      >
        {resetTarget && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (newPassword.length >= 8) {
                resetPwM.run({ id: resetTarget.id, newPassword });
              }
            }}
          >
            <p className="text-sm text-slate-400">
              This invalidates all of their existing sessions. The user will need to log in
              again with the new password.
            </p>
            <label className="block">
              <span className="text-xs uppercase text-slate-500">New password</span>
              <input
                type="text"
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm font-mono"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="min 8 characters"
                autoFocus
              />
            </label>
            <div className="flex justify-end gap-2">
              <NeonButton variant="cyan" onClick={() => setResetTarget(null)}>
                Cancel
              </NeonButton>
              <NeonButton
                variant="magenta"
                disabled={newPassword.length < 8 || resetPwM.isPending}
                type="submit"
              >
                {resetPwM.isPending ? 'Resetting…' : 'Reset password'}
              </NeonButton>
            </div>
          </form>
        )}
      </Modal>
    </Layout>
  );
}
