// Benchmark a repo without spending HBAR: logs in with a throwaway wallet, creates an agent, prints the score.
// Usage: REPO_URL=https://github.com/o/r AGENT_CAPS=a,b AGENT_DESCRIPTION="..." npm run bench-check
import 'dotenv/config';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const API = process.env.API_URL ?? 'http://localhost:4000';
const REPO_URL = process.env.REPO_URL;
if (!REPO_URL) throw new Error('Set REPO_URL');
const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
};
const account = privateKeyToAccount(generatePrivateKey());
const { nonce, message } = await call('POST', '/auth/nonce', { address: account.address });
const { token } = await call('POST', '/auth/verify', { address: account.address, nonce, signature: await account.signMessage({ message }) });
const { agent } = await call('POST', '/agents', {
  name: 'bench-check', description: process.env.AGENT_DESCRIPTION ?? 'An agent', capabilities: (process.env.AGENT_CAPS ?? 'code-review').split(','),
  priceTinybar: '1000', repoUrl: REPO_URL,
}, token);
const { runId } = await call('POST', `/agents/${agent.id}/benchmark`, {}, token);
for (let i = 0; i < 60; i++) {
  const r = await call('GET', `/agents/${agent.id}/benchmark/${runId}`);
  if (r.status !== 'running') { console.log(r.status, r.score, r.customScore, r.aiScore, r.error ?? ''); for (const it of r.items ?? []) console.log(it.passed ? 'PASS' : 'FAIL', it.name, '-', it.detail); process.exit(0); }
  await new Promise((s) => setTimeout(s, 3000));
}
