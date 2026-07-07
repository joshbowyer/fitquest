/**
 * Minimal LLM client. Routes to the right provider based on the
 * LlmConfig row. Uses raw HTTP fetch (no SDK dependencies) so the
 * API stays light and the same code path serves all 4 providers:
 *
 *   - OPENAI    : OpenAI-compatible (https://api.openai.com/v1/chat/completions)
 *   - OLLAMA    : OpenAI-compatible (http://localhost:11434/v1/chat/completions)
 *   - MINIMAX   : OpenAI-compatible (https://api.MiniMax.com/v1/chat/completions)
 *   - ANTHROPIC : Native Anthropic Messages API (different schema + auth header)
 *
 * For the headline features (morning report, correlation narrative,
 * spiritual director) the response is parsed into structured JSON.
 * For the test-connection endpoint we just return the raw text.
 */

export type LlmProvider = 'OPENAI' | 'OLLAMA' | 'MINIMAX' | 'ANTHROPIC';

export type LlmTask = 'food' | 'foodSaved' | 'morningReport' | 'spiritualDirector' | 'activityInsight' | 'metricInsight' | 'coach';

/// One task's override. Only provider + model are required; if
/// apiKey/baseUrl are absent we reuse the primary's. This keeps a
/// local Ollama setup clean — one API key / base URL, many models.
export type LlmTaskConfig = {
  provider: LlmProvider;
  model: string;
  apiKey?: string | null;
  baseUrl?: string | null;
};

export type LlmConfig = {
  provider: LlmProvider;
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
  enabled: boolean;
  systemPrompt: string | null;
  // Optional fallback. Tries after primary fails (5xx, timeout,
  // network, model-not-found). Either can be None: e.g. an
  // Ollama-only setup leaves primary blank and sets fallback.
  fallbackEnabled?: boolean;
  fallbackProvider?: LlmProvider | null;
  fallbackApiKey?: string | null;
  fallbackBaseUrl?: string | null;
  fallbackModel?: string | null;
  // Per-task model overrides. Missing entries fall back to the
  // default primary + fallback chain. See LlmTaskConfig above.
  taskOverrides?: Partial<Record<LlmTask, LlmTaskConfig>> | null;
};

/**
 * Read the saved LlmConfig row and return it as the callLlm-ready
 * LlmConfig (includes fallback fields + per-task overrides, casts
 * provider strings, returns a sensible default if no row exists
 * yet).
 *
 * Centralised so every LLM call site routes through the same
 * fallback chain. The admin /test endpoint uses the same helper
 * to keep "what primary and what fallback" consistent.
 */
export async function getActiveLlmConfig(): Promise<LlmConfig | null> {
  const { prisma } = await import('./prisma.js');
  const row = await prisma.llmConfig.findFirst();
  if (!row) return null;
  if (!row.enabled) return null;
  // taskOverrides is stored as JSON. Be defensive: a row written
  // before this field existed might be null; and the shape inside
  // is loosely-typed so we cast to the LlmTaskConfig shape after
  // narrowing.
  const rawOverrides = (row as any).taskOverrides as
    | Partial<Record<LlmTask, LlmTaskConfig>>
    | null
    | undefined;
  return {
    provider: row.provider as LlmConfig['provider'],
    apiKey: row.apiKey,
    baseUrl: row.baseUrl,
    model: row.model,
    enabled: row.enabled,
    systemPrompt: row.systemPrompt,
    fallbackEnabled: row.fallbackEnabled,
    fallbackProvider: (row.fallbackProvider as LlmConfig['fallbackProvider']) ?? null,
    fallbackApiKey: row.fallbackApiKey,
    fallbackBaseUrl: row.fallbackBaseUrl,
    fallbackModel: row.fallbackModel,
    taskOverrides: rawOverrides ?? null,
  };
}

export type LlmCallResult = {
  ok: boolean;
  text: string;
  model: string;
  provider: LlmConfig['provider'];
  latencyMs: number;
  error?: string;
  httpStatus?: number;
  /// Which attempt succeeded (1 = primary, 2 = fallback). 0 on
  /// total failure. Surfaced so the morning report can mention
  /// "ran on fallback today" if the primary is flapping.
  attempt?: 1 | 2 | 0;
};

type CallOpts = {
  prompt: string;
  /** Optional system prompt. Falls back to LlmConfig.systemPrompt. */
  system?: string;
  /** Max tokens to generate. Default 256 (plenty for a test). */
  maxTokens?: number;
  /** Temperature 0-2. Default 0.2 for deterministic test responses. */
  temperature?: number;
  /** Per-request timeout in ms. Default 30s. */
  timeoutMs?: number;
  /**
   * Force the model to output valid JSON. Sets `response_format:
   * { type: 'json_object' }` for OpenAI-compatible APIs and the
   * equivalent `format: 'json'` for Ollama. Use this whenever the
   * caller relies on the LLM returning parseable JSON (extractJson
   * in api/src/routes/foods.ts, etc). The model prompt should
   * still describe the expected schema — JSON mode is a
   * structural guarantee, not a content one.
   *
   * Note: Anthropic doesn't support response_format; the field is
   * silently dropped for that provider. Anthropic is good enough
   * at JSON to not need it.
   */
  jsonMode?: boolean;
};

function defaultBaseUrl(provider: LlmConfig['provider']): string {
  switch (provider) {
    case 'OPENAI':
      return 'https://api.openai.com/v1';
    case 'OLLAMA':
      return 'http://localhost:11434/v1';
    case 'MINIMAX':
      // Minimax exposes the Anthropic Messages API on the /anthropic
      // path. callLlm appends /v1/messages so the final URL is
      // https://api.minimax.io/anthropic/v1/messages.
      return 'https://api.minimax.io/anthropic';
    case 'ANTHROPIC':
      return 'https://api.anthropic.com';
  }
}

function modelNameFallback(provider: LlmConfig['provider']): string {
  switch (provider) {
    case 'OPENAI':
      return 'gpt-4o-mini';
    case 'OLLAMA':
      return 'llama3.2';
    case 'MINIMAX':
      return 'MiniMax-M3';
    case 'ANTHROPIC':
      return 'claude-3-5-sonnet-20241022';
  }
}

/**
 * Single entry point for all LLM calls. Returns the model's text
 * response and metadata, or a structured error.
 *
 * Throws on transport errors so callers can distinguish them from
 * "model returned an error" cases via the httpStatus field.
 *
 * Per-task overrides: if `task` is set and a matching override is
 * configured in `config.taskOverrides`, the override replaces the
 * primary (provider + model; apiKey/baseUrl fall back to the
 * primary's). Each task still benefits from the same fallback
 * chain — a 5xx on the food override falls back to the configured
 * fallback model.
 *
 * Fallback chain: if `config.fallbackEnabled` is true and a
 * fallback is configured, a transient primary failure (5xx,
 * network, timeout, model-not-found 404) automatically retries on
 * the fallback. Auth errors (401/403) and bad-input errors
 * (400/422) skip the fallback — those are config bugs that won't
 * be fixed by switching models.
 */
export async function callLlm(
  config: LlmConfig,
  opts: CallOpts,
  task?: LlmTask,
): Promise<LlmCallResult> {
  // Resolve the effective primary config: task override > config
  const effective = resolvePrimaryConfig(config, task);

  // ---- Attempt 1: primary ----
  const primary = await callOnce(effective, opts, 1);

  if (primary.ok) return primary;

  // Bail early on auth / bad-input errors (no point retrying on
  // fallback — same credentials issue).
  if (!shouldFallback(primary)) return primary;

  // ---- Attempt 2: fallback (if configured) ----
  if (!config.fallbackEnabled) return primary;
  if (!config.fallbackProvider) return primary;
  if (!config.fallbackModel) return primary;

  const fallbackConfig: LlmConfig = {
    provider: config.fallbackProvider,
    apiKey: config.fallbackApiKey ?? null,
    baseUrl: config.fallbackBaseUrl ?? null,
    model: config.fallbackModel,
    enabled: true,
    systemPrompt: config.systemPrompt ?? null,
  };
  const fallback = await callOnce(fallbackConfig, opts, 2);
  // If fallback also failed, return the primary's error (it's
  // the more useful diagnostic for the user) but tag attempt=0.
  if (!fallback.ok) {
    return { ...primary, attempt: 0 };
  }
  return fallback;
}

/**
 * Resolve the effective primary LlmConfig for a given task.
 * If a task override is set, its provider/model replace the
 * primary's; apiKey/baseUrl are reused from the primary unless
 * the override specifies them. Missing override = use the
 * default primary as-is.
 */
function resolvePrimaryConfig(config: LlmConfig, task?: LlmTask): LlmConfig {
  if (!task) return config;
  const override = config.taskOverrides?.[task];
  if (!override) return config;
  return {
    ...config,
    provider: override.provider,
    model: override.model,
    apiKey: override.apiKey ?? config.apiKey,
    baseUrl: override.baseUrl ?? config.baseUrl,
  };
}

/**
 * Decide whether a primary failure warrants trying the fallback.
 * We retry on transient infra issues (5xx, 404 model-not-found,
 * 408, 429 rate-limit, network, timeout). We DO NOT retry on
 * 401/403 (auth) or 400/422 (bad input) — those are the admin's
 * config bugs and the fallback would just hit the same wall.
 */
function shouldFallback(r: LlmCallResult): boolean {
  if (!r.httpStatus) return true; // network / timeout / unknown
  if (r.httpStatus === 404) return true; // model not found
  if (r.httpStatus === 408) return true; // request timeout
  if (r.httpStatus === 429) return true; // rate limit
  if (r.httpStatus >= 500 && r.httpStatus < 600) return true;
  return false;
}

/**
 * Internal: run a single LLM attempt. Returns the result with
 * `attempt` stamped on it. Used by callLlm for both primary and
 * fallback so the logic is identical.
 */
async function callOnce(
  config: LlmConfig,
  opts: CallOpts,
  attempt: 1 | 2,
): Promise<LlmCallResult> {
  const start = Date.now();
  const baseUrl = (config.baseUrl || defaultBaseUrl(config.provider)).replace(/\/$/, '');
  const model = config.model || modelNameFallback(config.provider);
  const systemPrompt = opts.system ?? config.systemPrompt ?? undefined;
  const maxTokens = opts.maxTokens ?? 256;
  const temperature = opts.temperature ?? 0.2;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  // jsonMode is implemented differently per provider:
  //   - OpenAI / OpenAI-compat (Ollama, etc): set
  //     `response_format: { type: 'json_object' }` (OpenAI) or
  //     `format: 'json'` (Ollama's native form). We send
  //     response_format because every OpenAI-compat server we
  //     support (Ollama ≥0.5, OpenAI, Minimax's OpenAI endpoint,
  //     llama.cpp's server, etc.) honors it, whereas Ollama's
  //     `format: 'json'` is *only* honored by Ollama — and
  //     inconsistently across models: samantha-mistral, gemma3,
  //     and llama3.2 all ignore it and emit prose, often wrapped
  //     in markdown ```json fences. Verified 2026-06-22.
  //   - Anthropic: no response_format support. Anthropic's own
  //     tool-use / structured output works differently and isn't
  //     wired here. We just skip the field for that provider.
  const jsonMode = opts.jsonMode === true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // ANTHROPIC + MINIMAX both use the Anthropic Messages API:
    //   POST {baseUrl}/v1/messages with x-api-key auth header.
    // OPENAI + OLLAMA use the OpenAI-compatible chat/completions
    //   endpoint with Authorization: Bearer.
    if (config.provider === 'ANTHROPIC' || config.provider === 'MINIMAX') {
      return await callAnthropic(config, baseUrl, model, systemPrompt, opts.prompt, maxTokens, temperature, controller.signal, start, attempt);
    }
    return await callOpenAiCompatible(config, baseUrl, model, systemPrompt, opts.prompt, maxTokens, temperature, controller.signal, start, attempt, jsonMode);
  } catch (err: any) {
    return {
      ok: false,
      text: '',
      model,
      provider: config.provider,
      latencyMs: Date.now() - start,
      attempt,
      error: err?.name === 'AbortError' ? 'Timeout' : String(err?.message ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAiCompatible(
  config: LlmConfig,
  baseUrl: string,
  model: string,
  systemPrompt: string | undefined,
  userPrompt: string,
  maxTokens: number,
  temperature: number,
  signal: AbortSignal,
  start: number,
  attempt: 1 | 2,
  jsonMode: boolean,
): Promise<LlmCallResult> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const body: any = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    stream: false,
  };
  // Force JSON output via OpenAI's response_format flag. Every
  // OpenAI-compat server we ship with (Ollama ≥0.5, OpenAI,
  // Minimax's OpenAI endpoint, llama.cpp's server) honors this.
  // We deliberately do NOT send Ollama's `format: 'json'` — that
  // field is Ollama-specific and models like samantha-mistral /
  // gemma3 / llama3.2 ignore it, returning prose. Sending both
  // would be a JSON-schema mismatch on the strict OpenAI endpoint
  // and on Ollama the extra field is silently dropped, so just
  // response_format is enough.
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify(body),
  });

  const latencyMs = Date.now() - start;
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return {
      ok: false,
      text: '',
      model,
      provider: config.provider,
      latencyMs,
      attempt,
      httpStatus: res.status,
      error: `${res.status} ${res.statusText}: ${errText.slice(0, 200)}`,
    };
  }
  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  return {
    ok: true,
    text: typeof text === 'string' ? text : JSON.stringify(text),
    model: data?.model ?? model,
    provider: config.provider,
    latencyMs,
    attempt,
  };
}

async function callAnthropic(
  config: LlmConfig,
  baseUrl: string,
  model: string,
  systemPrompt: string | undefined,
  userPrompt: string,
  maxTokens: number,
  temperature: number,
  signal: AbortSignal,
  start: number,
  attempt: 1 | 2,
): Promise<LlmCallResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (config.apiKey) headers['x-api-key'] = config.apiKey;

  const body: any = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: 'user', content: userPrompt }],
  };
  if (systemPrompt) body.system = systemPrompt;

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify(body),
  });

  const latencyMs = Date.now() - start;
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return {
      ok: false,
      text: '',
      model,
      provider: 'ANTHROPIC',
      latencyMs,
      attempt,
      httpStatus: res.status,
      error: `${res.status} ${res.statusText}: ${errText.slice(0, 200)}`,
    };
  }
  const data: any = await res.json();
  // Anthropic (and Minimax) may return multiple content blocks:
  //   - 'thinking' blocks: internal reasoning, not user-visible
  //   - 'text' blocks: the actual response
  // Concatenate all text blocks so the caller sees the real answer.
  const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
  const text = blocks
    .filter((b) => b?.type === 'text' && typeof b?.text === 'string')
    .map((b) => b.text)
    .join('\n');
  return {
    ok: true,
    text,
    model: data?.model ?? model,
    provider: 'ANTHROPIC',
    latencyMs,
    attempt,
  };
}
