import { config } from './config.js';

export class BackendError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

/** Minimal backend client. Sends x-agent-key. Throws BackendError on non-2xx (body kept for callers). */
export async function backend<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!config.agentKey) throw new Error('Agent API key is not set (see .env.example)');
  const res = await fetch(`${config.backendUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-agent-key': config.agentKey },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) throw new BackendError(res.status, parsed, `${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  return parsed as T;
}
