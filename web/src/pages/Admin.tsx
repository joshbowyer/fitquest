import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
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

type LlmTaskOverride = {
  provider: 'OPENAI' | 'ANTHROPIC' | 'OLLAMA' | 'MINIMAX';
  model: string;
  apiKey?: string | null;
  baseUrl?: string | null;
} | null;

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
  // Per-task model overrides. Missing / null = use the default
  // primary + fallback chain for that task.
  taskOverrides: {
    food: LlmTaskOverride;
    foodSaved: LlmTaskOverride;
    morningReport: LlmTaskOverride;
    spiritualDirector: LlmTaskOverride;
    activityInsight: LlmTaskOverride;
    metricInsight: LlmTaskOverride;
  };
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
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

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
    // Send the live form state as `override` so the test reflects
    // what the user just typed (and persists it to the DB if it's
    // not saved yet). Falls back to the saved row on the server
    // when override fields are null.
    mutationFn: (which) =>
      api<LlmTestResult>('/admin/llm-test', {
        method: 'POST',
        body: {
          which,
          override: llmForm ? {
            provider: llmForm.provider,
            apiKey: llmForm.apiKey,
            baseUrl: llmForm.baseUrl,
            model: llmForm.model,
            enabled: llmForm.enabled,
            fallbackEnabled: llmForm.fallbackEnabled,
            fallbackProvider: llmForm.fallbackProvider,
            fallbackApiKey: llmForm.fallbackApiKey,
            fallbackBaseUrl: llmForm.fallbackBaseUrl,
            fallbackModel: llmForm.fallbackModel,
          } : undefined,
        },
      }),
    onSuccess: () => {
      // The server may have persisted the override; refresh the
      // canonical config so the form re-syncs (in case the user
      // hit Test without clicking Save).
      qc.invalidateQueries({ queryKey: ['admin', 'llm-config'] });
    },
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

  // Destructive: deletes the user + all their data (cascade).
  // Requires confirmation in the modal — the form lists what gets
  // wiped so the admin knows what they're committing to.
  const deleteUserM = useDelayedMutation<
    { ok: boolean; deleted: { id: string; username: string } },
    string
  >({
    mutationFn: (id) =>
      api<{ ok: boolean; deleted: { id: string; username: string } }>(
        `/admin/users/${id}`,
        { method: 'DELETE' },
      ),
    onError: (e) => alert(e instanceof ApiError ? e.message : 'Delete failed'),
    onSuccess: () => {
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
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

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-2">
        {/* -------- Users -------- */}
        <Panel title="Users" className="sm:col-span-2 lg:col-span-2">
          {usersQ.isLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : usersQ.isError ? (
            <p className="text-sm text-rose-300">Failed to load users.</p>
          ) : (
            <>
              {/* Mobile: stacked cards. Each card shows the user's
                  identity strip + stats + a wrap-friendly action row. */}
              <div className="md:hidden space-y-2">
                {usersQ.data?.users.map((u) => (
                  <UserCardMobile
                    key={u.id}
                    user={u}
                    isSelf={u.id === user?.id}
                    onResetPw={() => setResetTarget(u)}
                    onClear2fa={() => clear2faM.run(u.id)}
                    onToggleAdmin={() =>
                      toggleAdminM.run({ id: u.id, isAdmin: !u.isAdmin })
                    }
                    onDelete={() => setDeleteTarget(u)}
                    isClearing2fa={clear2faM.isPending}
                    isTogglingAdmin={toggleAdminM.isPending}
                  />
                ))}
              </div>

              {/* Tablet+: full table. Wraps horizontally if the
                  viewport is narrower than the natural width. */}
              <div className="hidden md:block overflow-x-auto -mx-2">
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
                          <div className="flex flex-wrap gap-1 justify-end">
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
                                toggleAdminM.isPending || u.id === user?.id
                              }
                              title={u.id === user?.id ? "Can't change your own admin" : ''}
                            >
                              {u.isAdmin ? 'Demote' : 'Promote'}
                            </NeonButton>
                            <NeonButton
                              size="sm"
                              variant="magenta"
                              onClick={() => setDeleteTarget(u)}
                              disabled={u.id === user?.id}
                            >
                              Delete
                            </NeonButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
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

              {/* Per-task model overrides. Each task can route to a
                  different model so you can use the right tool for
                  each job: e.g. a strong JSON model for food Ask-AI,
                  a warmer persona model for the spiritual director.
                  Empty override = use the default primary + fallback
                  chain. The apiKey/baseUrl are optional per task;
                  if absent, the task reuses the primary's. This
                  keeps a local Ollama setup clean (one baseUrl, one
                  apiKey, many models). */}
              <div className="sm:col-span-2 mt-4 pt-3 border-t border-ink-500/30">
                <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
                  Per-task model overrides
                </div>
                <div className="text-[10px] font-mono text-ink-500 mb-3">
                  Each task inherits the primary + fallback chain unless overridden below.
                  Credentials (apiKey / baseUrl) are optional per task — leave empty to reuse the primary's.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {([
                    { key: 'food',              label: 'Food search Ask-AI', hint: 'parses a freeform description into a search query' },
                    { key: 'foodSaved',         label: 'Saved food Ask-AI',   hint: 'estimates macros for a description (no OFF lookup)' },
                    { key: 'morningReport',     label: 'Morning report',      hint: 'long structured JSON briefing, last 7d vs prior 7d' },
                    { key: 'spiritualDirector', label: 'Spiritual director',  hint: 'Ignatian / warm tone reflection on todays Gospel' },
                    { key: 'activityInsight',   label: 'AI activity insight', hint: 'per-workout score 1-10 + recovery recommendation' },
                    { key: 'metricInsight',     label: 'AI metric deep-dive', hint: 'per-measurement narrative for the /insights/metrics page' },
                  ] as const).map(({ key, label, hint }) => {
                    const ov = llmForm.taskOverrides[key];
                    return (
                      <div
                        key={key}
                        className="border border-ink-500/30 p-2.5 space-y-1.5 bg-bg-900/40"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-200">
                              {label}
                            </div>
                            <div className="text-[9px] font-mono text-ink-500 mt-0.5">
                              {hint}
                            </div>
                          </div>
                          <label className="flex items-center gap-1 text-[10px] font-mono text-ink-400 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!ov}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  // Seed with the primary so the form has
                                  // a sensible starting point. The user
                                  // can change provider + model.
                                  setLlmForm({
                                    ...llmForm,
                                    taskOverrides: {
                                      ...llmForm.taskOverrides,
                                      [key]: { provider: llmForm.provider, model: llmForm.model },
                                    },
                                  });
                                } else {
                                  setLlmForm({
                                    ...llmForm,
                                    taskOverrides: {
                                      ...llmForm.taskOverrides,
                                      [key]: null,
                                    },
                                  });
                                }
                              }}
                            />
                            override
                          </label>
                        </div>
                        {ov && (
                          <div className="space-y-1.5 pt-1">
                            <select
                              className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs font-mono"
                              value={ov.provider}
                              onChange={(e) => {
                                const nextProvider = e.target.value as LlmConfig['provider'];
                                const preset = providersQ.data?.providers?.[nextProvider];
                                setLlmForm({
                                  ...llmForm,
                                  taskOverrides: {
                                    ...llmForm.taskOverrides,
                                    [key]: {
                                      ...ov,
                                      provider: nextProvider,
                                      // If the user picked a different
                                      // provider, auto-fill its default
                                      // model so they don't have to type
                                      // it from scratch.
                                      model: ov.model || preset?.defaultModel || ov.model,
                                      baseUrl: ov.baseUrl ?? preset?.baseUrl ?? null,
                                    },
                                  },
                                });
                              }}
                            >
                              <option value="OPENAI">OpenAI</option>
                              <option value="ANTHROPIC">Anthropic</option>
                              <option value="OLLAMA">Ollama (local)</option>
                              <option value="MINIMAX">Minimax</option>
                            </select>
                            <input
                              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-mono"
                              type="text"
                              placeholder="model name (e.g. gemma3:12b)"
                              value={ov.model}
                              onChange={(e) => {
                                setLlmForm({
                                  ...llmForm,
                                  taskOverrides: {
                                    ...llmForm.taskOverrides,
                                    [key]: { ...ov, model: e.target.value },
                                  },
                                });
                              }}
                            />
                            <input
                              className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-mono"
                              type="text"
                              placeholder={`baseUrl (optional, e.g. ${ov.provider === 'OLLAMA' ? 'http://localhost:11434/v1' : 'leave empty to reuse primary'})`}
                              value={ov.baseUrl ?? ''}
                              onChange={(e) => {
                                setLlmForm({
                                  ...llmForm,
                                  taskOverrides: {
                                    ...llmForm.taskOverrides,
                                    [key]: { ...ov, baseUrl: e.target.value || null },
                                  },
                                });
                              }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* -------- Delete-user confirmation modal -------- */}
      <DeleteUserModal
        target={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(id) => deleteUserM.run(id)}
        isPending={deleteUserM.isPending}
      />

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

/**
 * Mobile-only user card. Replaces the wide table on phones so the
 * users section doesn't require horizontal scroll. Each card is a
 * self-contained identity strip + stats row + wrap-friendly actions.
 */
function UserCardMobile({
  user,
  isSelf,
  onResetPw,
  onClear2fa,
  onToggleAdmin,
  onDelete,
  isClearing2fa,
  isTogglingAdmin,
}: {
  user: AdminUser;
  isSelf: boolean;
  onResetPw: () => void;
  onClear2fa: () => void;
  onToggleAdmin: () => void;
  onDelete: () => void;
  isClearing2fa: boolean;
  isTogglingAdmin: boolean;
}) {
  return (
    <div className="border border-ink-500/30 rounded p-3 bg-bg-900/40">
      {/* Identity strip */}
      <div className="flex items-baseline justify-between mb-2 gap-2">
        <div className="min-w-0">
          <div className="font-display text-base text-slate-100 truncate">
            {user.username}
            {user.isAdmin && (
              <span className="text-violet-300 text-xs ml-1">★</span>
            )}
          </div>
          <div className="text-[10px] font-mono text-slate-500 truncate">
            {user.email}
          </div>
        </div>
        <div className="text-right text-[10px] font-mono text-ink-400 shrink-0">
          {user.class ?? <span className="text-ink-500">no class</span>}
          <div className="flex gap-2 justify-end mt-0.5">
            <span className="text-neon-cyan">L{user.level}</span>
            <span className="text-neon-amber">{user.gold}G</span>
            <span className="text-violet-300">{user.soulstones}◆</span>
          </div>
        </div>
      </div>
      {/* Meta strip: 2FA, joined, sessions/workouts */}
      <div className="flex items-center gap-3 text-[10px] font-mono text-ink-400 mb-2">
        <span>
          2FA:{' '}
          <span className={user.twoFactorEnabled ? 'text-emerald-400' : 'text-ink-500'}>
            {user.twoFactorEnabled ? 'on' : 'off'}
          </span>
        </span>
        <span>joined {formatRelative(user.createdAt)}</span>
        <span>
          {user._count.workouts} workouts · {user._count.sessions} sessions
        </span>
      </div>
      {/* Action row: wraps on narrow screens */}
      <div className="flex flex-wrap gap-1.5">
        <NeonButton size="sm" variant="amber" onClick={onResetPw}>
          Reset PW
        </NeonButton>
        {user.twoFactorEnabled && (
          <NeonButton
            size="sm"
            variant="amber"
            onClick={onClear2fa}
            disabled={isClearing2fa}
          >
            Clear 2FA
          </NeonButton>
        )}
        <NeonButton
          size="sm"
          variant={user.isAdmin ? 'magenta' : 'lime'}
          onClick={onToggleAdmin}
          disabled={isTogglingAdmin || isSelf}
        >
          {user.isAdmin ? 'Demote' : 'Promote'}
        </NeonButton>
        <NeonButton
          size="sm"
          variant="magenta"
          onClick={onDelete}
          disabled={isSelf}
        >
          Delete
        </NeonButton>
      </div>
    </div>
  );
}

/**
 * Destructive-action confirmation. Asks the admin to type the
 * target username before the Delete button enables — defends
 * against muscle-memory clicks on a real name.
 */
function DeleteUserModal({
  target,
  onCancel,
  onConfirm,
  isPending,
}: {
  target: AdminUser | null;
  onCancel: () => void;
  onConfirm: (id: string) => void;
  isPending: boolean;
}) {
  const [typed, setTyped] = useState('');
  // Reset typed text every time the target changes so the confirm
  // field starts empty for the next delete.
  useEffect(() => {
    setTyped('');
  }, [target?.id]);
  if (!target) return null;
  const matches = typed === target.username;
  return (
    <Modal
      open={!!target}
      onClose={onCancel}
      title={`Delete ${target.username}?`}
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-300">
          This permanently deletes the user and{' '}
          <b>all of their data</b>:
        </p>
        <ul className="text-xs font-mono text-ink-400 space-y-0.5 list-disc pl-5">
          <li>Workouts + sets + exercises</li>
          <li>Measurements (weight, HRV, sleep, body comp)</li>
          <li>Spiritual reflections + prayer logs</li>
          <li>Quest progress, achievements, skill trees</li>
          <li>Saved foods + nutrition logs</li>
          <li>Inventory, raid contributions, party membership</li>
          <li>All sessions (they will be logged out immediately)</li>
        </ul>
        <p className="text-xs font-mono text-rose-300">
          This cannot be undone. Type the username to confirm.
        </p>
        <label className="block">
          <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
            Type <span className="text-neon-cyan">{target.username}</span> below
          </span>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            className="mt-1 w-full rounded border border-ink-500/40 bg-bg-900 px-2 py-1.5 text-sm font-mono"
            placeholder={target.username}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <div className="flex justify-end gap-2">
          <NeonButton variant="cyan" onClick={onCancel}>
            Cancel
          </NeonButton>
          <NeonButton
            variant="magenta"
            onClick={() => onConfirm(target.id)}
            disabled={!matches || isPending}
            loading={isPending}
            loadingText="Deleting…"
          >
            Delete user
          </NeonButton>
        </div>
      </div>
    </Modal>
  );
}
