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
};

export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const { body, headers, ...rest } = init;
  const hasBody = body !== undefined;
  const res = await fetch(`${API_BASE}${path}`, {
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
