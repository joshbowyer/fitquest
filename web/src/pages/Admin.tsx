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
                <span className="text-xs uppercase text-slate-500">API Key</span>
                <input
                  type="password"
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm font-mono"
                  value={llmForm.apiKey ?? ''}
                  onChange={(e) =>
                    setLlmForm({ ...llmForm, apiKey: e.target.value || null })
                  }
                  placeholder={
                    llmForm.apiKey
                      ? '•••• (leave blank to keep)'
                      : 'sk-...'
                  }
                />
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
              <div className="sm:col-span-2 flex justify-end">
                <NeonButton
                  type="button"
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
