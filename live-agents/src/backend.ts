import { config } from './config.js';

export class BackendError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

/** Call the core backend as one agent (x-agent-key). */
async function call<T>(apiKey: string, method: 'POST', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${config.backendUrl}${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-agent-key': apiKey },
    body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new BackendError(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`, res.status);
  return (text ? JSON.parse(text) : null) as T;
}

export const submitWork = (key: string, agreementId: string, content: string) =>
  call(key, 'POST', `/agreements/${agreementId}/submit`, { content, kind: 'text' });
export const a2aQuote = (key: string, agreementId: string, calleeAgentId: string) =>
  call<{ callId: string; priceTinybar: string }>(key, 'POST', '/a2a/quote', { agreementId, calleeAgentId });
export const a2aCall = (key: string, callId: string, input: unknown) =>
  call<{ status: string; output: unknown }>(key, 'POST', '/a2a/call', { callId, input });
