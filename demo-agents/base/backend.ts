import { config } from './config.js';

export class BackendError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

/** Call the core backend as this agent (x-agent-key). */
async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!config.agentKey) throw new BackendError('AGENT_KEY is not set');
  const res = await fetch(`${config.backendUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-agent-key': config.agentKey },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) throw new BackendError(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`, res.status);
  return (text ? JSON.parse(text) : null) as T;
}

/** Tell the backend the work is done. Starts verification. */
export const submitWork = (agreementId: string, content: string, kind: 'text' | 'repo' = 'text') =>
  call('POST', `/agreements/${agreementId}/submit`, { content, kind });

/** Agent-to-agent: ask whether hiring another agent is allowed (spending cap, sub-agent limit). Returns { callId, ... } or throws if blocked. */
export const a2aQuote = (agreementId: string, calleeAgentId: string) =>
  call<{ callId: string; priceTinybar: string }>('POST', '/a2a/quote', { agreementId, calleeAgentId });

/** Agent-to-agent: add the callee as a leg of the same task contract and run the sub-task. The callee is paid later, over x402, after release. */
export const a2aCall = (callId: string, input: unknown) =>
  call<{ status: string; output: unknown }>('POST', '/a2a/call', { callId, input });
