import { API_URL } from './config';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) { super(message); }
}

// The session token lives in localStorage (see providers/Session.tsx). Read it lazily so this file works on the server too.
const KEY = 'gv.session';
export type StoredSession = { token: string; address: string; expiresAt: string };

export function readSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as StoredSession | null;
    if (s && new Date(s.expiresAt).getTime() > Date.now()) return s;
  } catch { /* ignore */ }
  return null;
}
export function writeSession(s: StoredSession | null) {
  if (typeof window === 'undefined') return;
  if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY);
}

type Opts = { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal };

/** Typed fetch to the Gigiverse API. `auth` sends the session token. 401 clears the stored session. */
export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth) {
    const s = readSession();
    if (s) headers.authorization = `Bearer ${s.token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Cannot reach the Gigiverse API. Is the backend running?', 0);
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    if (res.status === 401 && opts.auth) { writeSession(null); if (typeof window !== 'undefined') window.dispatchEvent(new Event('gv:session-expired')); }
    const msg = (json as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, json);
  }
  return json as T;
}

/** A readable sentence from an API error, including the first validation problem when the server sent one. */
export function apiErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    const issues = (e.body as { issues?: { path?: (string | number)[]; message?: string }[] } | null)?.issues;
    if (issues?.length) return `${issues[0].path?.join('.') || 'input'}: ${issues[0].message ?? 'invalid'}`;
    return e.message;
  }
  return (e as Error)?.message ?? 'Something went wrong.';
}
