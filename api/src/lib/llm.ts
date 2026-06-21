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

export type LlmConfig = {
  provider: 'OPENAI' | 'OLLAMA' | 'MINIMAX' | 'ANTHROPIC';
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
  enabled: boolean;
  systemPrompt: string | null;
};

export type LlmCallResult = {
  ok: boolean;
  text: string;
  model: string;
  provider: LlmConfig['provider'];
  latencyMs: number;
  error?: string;
  httpStatus?: number;
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
 */
export async function callLlm(
  config: LlmConfig,
  opts: CallOpts,
): Promise<LlmCallResult> {
  const start = Date.now();
  const baseUrl = (config.baseUrl || defaultBaseUrl(config.provider)).replace(/\/$/, '');
  const model = config.model || modelNameFallback(config.provider);
  const systemPrompt = opts.system ?? config.systemPrompt ?? undefined;
  const maxTokens = opts.maxTokens ?? 256;
  const temperature = opts.temperature ?? 0.2;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // ANTHROPIC + MINIMAX both use the Anthropic Messages API:
    //   POST {baseUrl}/v1/messages with x-api-key auth header.
    // OPENAI + OLLAMA use the OpenAI-compatible chat/completions
    //   endpoint with Authorization: Bearer.
    if (config.provider === 'ANTHROPIC' || config.provider === 'MINIMAX') {
      return await callAnthropic(config, baseUrl, model, systemPrompt, opts.prompt, maxTokens, temperature, controller.signal, start);
    }
    return await callOpenAiCompatible(config, baseUrl, model, systemPrompt, opts.prompt, maxTokens, temperature, controller.signal, start);
  } catch (err: any) {
    return {
      ok: false,
      text: '',
      model,
      provider: config.provider,
      latencyMs: Date.now() - start,
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
): Promise<LlmCallResult> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    }),
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
  };
}
