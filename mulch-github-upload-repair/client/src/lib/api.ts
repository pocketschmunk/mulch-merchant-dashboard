export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) { super(message); }
}
export type Requester = <T>(path: string, options?: { method?: string; body?: unknown; csrf?: string }) => Promise<T>;
export const request: Requester = async <T>(path: string, options: { method?: string; body?: unknown; csrf?: string } = {}): Promise<T> => {
  if (!path.startsWith('/api/')) throw new ApiError(400, 'invalid_path', 'Only same-origin application APIs are supported.');
  const method = options.method ?? 'GET';
  if (!['GET', 'HEAD'].includes(method) && !options.csrf && (!path.startsWith('/api/auth/') || path === '/api/auth/logout')) {
    throw new ApiError(403, 'csrf_missing', 'Your session has no CSRF token. Sign in again before saving.');
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch { throw new ApiError(0, 'server_unavailable', 'The application server is unavailable. No account data or changes have been confirmed.'); }
  let data: unknown;
  try { data = await response.json(); } catch { throw new ApiError(response.status, 'invalid_response', 'The application server did not return the expected JSON response.'); }
  if (!response.ok) {
    const error = data as { error?: string; message?: string; details?: Record<string, unknown> };
    throw new ApiError(response.status, error.error ?? 'request_failed', error.message ?? `Request failed (${response.status}).`, error.details);
  }
  return data as T;
};
export function describeError(error: unknown): string { return error instanceof Error ? error.message : 'The request could not be completed.'; }
export const storePath = (id: string, suffix: string) => `/api/stores/${encodeURIComponent(id)}/${suffix}`;
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
