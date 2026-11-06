// Registers both demo agents through the documented API and writes their one-time keys into demo-agents/.env.
// Flow (backend/src/routes/auth.ts, agents.ts): POST /auth/nonce -> sign message -> POST /auth/verify -> POST /agents.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const envPath = process.env.ENV_PATH ?? resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(envPath)) dotenv.config({ path: envPath, quiet: true });
const backend = (process.env.BACKEND_URL ?? 'http://localhost:4000').replace(/\/$/, '');

function setEnv(key: string, value: string) {
  let text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${key}=${value}\n`;
  writeFileSync(envPath, text, { mode: 0o600 });
  process.env[key] = value;
}

async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const res = await fetch(`${backend}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function main() {
  // A generated TEST key. Testnet only, never funded. Kept in the gitignored .env.
  let pk = process.env.LISTER_PRIVATE_KEY;
  if (!pk) { pk = generatePrivateKey(); setEnv('LISTER_PRIVATE_KEY', pk); console.log('Generated a test lister key (saved to demo-agents/.env)'); }
  const account = privateKeyToAccount(pk as `0x${string}`);
  console.log('Lister address:', account.address);

  const { nonce, message } = await api<{ nonce: string; message: string }>('/auth/nonce', { method: 'POST', body: JSON.stringify({ address: account.address }) });
  const signature = await account.signMessage({ message });
  const { token } = await api<{ token: string }>('/auth/verify', { method: 'POST', body: JSON.stringify({ address: account.address, nonce, signature }) });
  console.log('Logged in');

  const defs = [
    {
      prefix: 'SOLIDITY_BUILDER', name: 'Solidity Builder', capabilities: ['solidity-build'],
      description: 'Writes small, self-contained Solidity contracts from written requirements using the NVIDIA API, then hires the Static Auditor to review its own work.',
      url: process.env.SOLIDITY_BUILDER_URL ?? 'http://localhost:4101', price: process.env.SOLIDITY_BUILDER_PRICE_TINYBAR ?? '1000000000', repo: process.env.SOLIDITY_BUILDER_REPO,
    },
    {
      prefix: 'STATIC_AUDITOR', name: 'Static Auditor', capabilities: ['static-audit'],
      description: 'Reviews Solidity source code and returns a structured security review with severities, using the NVIDIA API.',
      url: process.env.STATIC_AUDITOR_URL ?? 'http://localhost:4102', price: process.env.STATIC_AUDITOR_PRICE_TINYBAR ?? '200000000', repo: process.env.STATIC_AUDITOR_REPO,
    },
  ];

  for (const d of defs) {
    if (process.env[`${d.prefix}_AGENT_ID`] && process.env[`${d.prefix}_API_KEY`]) { console.log(`${d.name}: already registered, skipping`); continue; }
    const body: Record<string, unknown> = { name: d.name, description: d.description, capabilities: d.capabilities, endpointUrl: d.url, priceTinybar: d.price };
    if (d.repo) body.repoUrl = d.repo; // blocked on: human (publish the repo), then set *_REPO and re-run after clearing the agent id
    const r = await api<{ agent: { id: string; status: string }; apiKey: string }>('/agents', { method: 'POST', token, body: JSON.stringify(body) });
    setEnv(`${d.prefix}_AGENT_ID`, r.agent.id);
    setEnv(`${d.prefix}_API_KEY`, r.apiKey); // shown once by the API; written to .env only, not printed
    console.log(`${d.name}: created ${r.agent.id} (status ${r.agent.status}); API key saved to demo-agents/.env`);
  }
  console.log('Next: run the benchmark for each agent (needs a public repoUrl) so status becomes listed.');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
