// End-to-end check of the backend flow with chain steps stubbed (dev endpoints).
// Usage: start the server (npm run dev), then: REPO_URL=https://github.com/owner/repo npm run flow
// Wallets are random and unfunded; nothing here touches a chain.
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const API = process.env.API_URL ?? 'http://localhost:4000';
const REPO_URL = process.env.REPO_URL;
if (!REPO_URL) throw new Error('Set REPO_URL to a public GitHub repo to benchmark');

async function call<T = any>(method: string, path: string, opts: { token?: string; agentKey?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.agentKey ? { 'x-agent-key': opts.agentKey } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return json as T;
}

async function login() {
  const account = privateKeyToAccount(generatePrivateKey());
  const { nonce, message } = await call('POST', '/auth/nonce', { body: { address: account.address } });
  const signature = await account.signMessage({ message });
  const { token } = await call('POST', '/auth/verify', { body: { address: account.address, nonce, signature } });
  return { account, token: token as string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (s: string) => console.log(`\n== ${s}`);

const lister = await login();
const client = await login();
console.log('lister', lister.account.address, '\nclient', client.account.address);

step('create agent');
const { agent, apiKey } = await call('POST', '/agents', {
  token: lister.token,
  body: {
    name: 'Flow Test Agent',
    description: process.env.AGENT_DESCRIPTION ?? 'An agent that writes and reviews code',
    capabilities: (process.env.AGENT_CAPS ?? 'code-review,solidity-build').split(','),
    priceTinybar: '100000000',
    repoUrl: REPO_URL,
  },
});
console.log('agent', agent.id);

step('benchmark');
const { runId } = await call('POST', `/agents/${agent.id}/benchmark`, { token: lister.token, body: {} });
let run: any;
for (let i = 0; i < 60; i++) {
  run = await call('GET', `/agents/${agent.id}/benchmark/${runId}`);
  if (run.status !== 'running') break;
  await sleep(3000);
}
console.log('benchmark', run.status, 'score', run.score, run.error ?? '');
console.log((run.reviewText ?? '').slice(0, 400));
if (run.status !== 'passed') {
  console.log('Agent was not listed; stopping. (Pick a stronger repo or change BENCHMARK_PASS_SCORE.)');
  process.exit(run.status === 'error' ? 1 : 0);
}

step('request -> quote -> accept');
const request = await call('POST', '/requests', {
  token: client.token,
  body: {
    title: 'Simple ERC-20 token',
    requirements: 'Write a Solidity ERC-20 token named AgentToken (AGT) with a fixed supply of 1,000,000 minted to the deployer, and no owner-only mint function.',
    checksRequested: ['secrets_scan', 'security_review'],
    budgetTinybar: '200000000',
  },
});
await call('POST', `/requests/${request.id}/quotes`, { token: lister.token, body: { agentId: agent.id, priceTinybar: '100000000', etaHours: 2 } });
const { quotes } = await call('GET', `/requests/${request.id}`);
const agreement = await call('POST', `/quotes/${quotes[0].id}/accept`, { token: client.token });
console.log('agreement', agreement.id, agreement.status);

step('mark funded (dev stub for the on-chain Funded event)');
console.log(await call('POST', `/dev/agreements/${agreement.id}/mark-funded`));

step('A2A: agent tries to hire itself -> blocked (rule check while escrow is funded)');
console.log(
  await call('POST', '/a2a/quote', { agentKey: apiKey, body: { agreementId: agreement.id, calleeAgentId: agent.id } }).catch((e) => e.message),
);

step('agent submits');
const contract = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract AgentToken {
  string public constant name = "AgentToken"; string public constant symbol = "AGT"; uint8 public constant decimals = 18;
  uint256 public constant totalSupply = 1_000_000 * 1e18;
  mapping(address => uint256) public balanceOf;
  event Transfer(address indexed from, address indexed to, uint256 value);
  constructor() { balanceOf[msg.sender] = totalSupply; emit Transfer(address(0), msg.sender, totalSupply); }
  function transfer(address to, uint256 v) external returns (bool) { require(balanceOf[msg.sender] >= v, "bal"); balanceOf[msg.sender] -= v; balanceOf[to] += v; emit Transfer(msg.sender, to, v); return true; }
}`;
console.log(await call('POST', `/agreements/${agreement.id}/submit`, { agentKey: apiKey, body: { content: contract, kind: 'text' } }));

step('wait for verification');
let v: any;
for (let i = 0; i < 60; i++) {
  v = await call('GET', `/agreements/${agreement.id}/verification`);
  if (v.latest) break;
  await sleep(3000);
}
console.log('result', v.latest?.result, v.latest?.error ?? '');
for (const it of v.latest?.items ?? []) console.log(` ${it.passed ? 'PASS' : 'FAIL'}  ${it.name} - ${it.detail}`);

if (v.latest?.result === 'PASS' || v.latest?.result === 'FAIL') {
  step('settle (dev stub for Released/Refunded)');
  console.log(await call('POST', `/dev/agreements/${agreement.id}/settle`));
}

console.log('\nFlow finished.');
