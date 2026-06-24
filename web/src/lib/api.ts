const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || '/api';

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

type ApiInit = Omit<RequestInit, 'body' | 'credentials'> & {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
};

export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const { body, headers, query, ...rest } = init;
  const hasBody = body !== undefined;
  // Append query string from `init.query` if provided. Lets callers
  // write `api('/foods/search', { query: { q: 'chicken' } })` and
  // stay type-safe (no manual `encodeURIComponent`).
  let url = `${API_BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v == null) continue;
      params.append(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (path.includes('?') ? '&' : '?') + qs;
  }
  const res = await fetch(url, {
    ...rest,
    credentials: 'include',
    headers: {
      // Only set Content-Type when there's a body. Fastify will try to
      // JSON.parse an empty body when Content-Type is application/json
      // and return 400 Bad Request, which breaks no-body POSTs.
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(headers || {}),
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = (data as any)?.error || res.statusText || 'Request failed';
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

/**
 * POST a JSON body. Shorthand for `api(path, { method: 'POST', body })`
 * since "POST with JSON" is the single most common API call shape and
 * writing `method: 'POST', body: {}` everywhere clutters the call site.
 */
export function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', body });
}
