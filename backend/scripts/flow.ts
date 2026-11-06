// End-to-end check with REAL Hedera testnet transactions.
// Usage: start the server (npm run dev), then: REPO_URL=https://github.com/owner/repo npm run flow
// The relayer account funds a fresh client wallet with a little HBAR; the client wallet funds the escrow.
import 'dotenv/config';
import { createServer } from 'node:http';
import { createWalletClient, formatUnits, http as viemHttp, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { escrowAbi } from '../src/chain/abi.js';
import { hederaTestnet, publicClient } from '../src/chain/client.js';
import { toRpcValue } from '../src/money.js';

const API = process.env.API_URL ?? 'http://localhost:4000';
const REPO_URL = process.env.REPO_URL;
if (!REPO_URL) throw new Error('Set REPO_URL to a public GitHub repo to benchmark');
if (!process.env.RELAYER_PRIVATE_KEY) throw new Error('RELAYER_PRIVATE_KEY missing in .env');

const PRICE = 100_000_000n; // 1 HBAR in tinybar
const CALLEE_PRICE = 20_000_000n; // 0.2 HBAR; the 30% A2A cap on a 1 HBAR job is 0.3 HBAR

async function call<T = any>(method: string, path: string, opts: { token?: string; agentKey?: string; body?: unknown; allow?: number[] } = {}): Promise<T> {
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
  if (!res.ok && !opts.allow?.includes(res.status)) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return json as T;
}

async function login() {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const { nonce, message } = await call('POST', '/auth/nonce', { body: { address: account.address } });
  const signature = await account.signMessage({ message });
  const { token } = await call('POST', '/auth/verify', { body: { address: account.address, nonce, signature } });
  return { account, key, token: token as string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (s: string) => console.log(`\n== ${s}`);
const hbar = (wei: bigint) => `${formatUnits(wei, 18)} HBAR`;
const wallet = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain: hederaTestnet, transport: viemHttp(process.env.HEDERA_RPC_URL ?? 'https://testnet.hashio.io/api') });

async function waitFor<T>(label: string, fn: () => Promise<T | null | false>, tries = 60, ms = 3000): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(ms);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function createAndBenchmark(token: string, name: string, priceTinybar: bigint, endpointUrl?: string) {
  const { agent, apiKey } = await call('POST', '/agents', {
    token,
    body: {
      name, description: process.env.AGENT_DESCRIPTION ?? 'An agent that writes and reviews code',
      capabilities: (process.env.AGENT_CAPS ?? 'code-review,solidity-build').split(','),
      priceTinybar: priceTinybar.toString(), repoUrl: REPO_URL, endpointUrl,
    },
  });
  const { runId } = await call('POST', `/agents/${agent.id}/benchmark`, { token, body: {} });
  const run: any = await waitFor('benchmark', async () => {
    const r: any = await call('GET', `/agents/${agent.id}/benchmark/${runId}`);
    return r.status !== 'running' ? r : null;
  });
  console.log(`${name}: benchmark ${run.status}, score ${run.score}`, run.error ?? '');
  if (run.status !== 'passed') throw new Error(`${name} was not listed (benchmark ${run.status}). Use a stronger repo.`);
  return { agent, apiKey: apiKey as string };
}

// ---- local callee "agent" that answers POST /a2a, so the A2A call has something to talk to ----
const calleeServer = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ review: 'No critical issues found (demo auditor).', received: JSON.parse(body || '{}').input }));
  });
});
await new Promise<void>((r) => calleeServer.listen(4999, r));

const lister = await login();
const client = await login();
console.log('lister', lister.account.address, '\nclient', client.account.address);

step('fund the fresh client wallet from the relayer (2 HBAR for the escrow + gas)');
const relayer = wallet(process.env.RELAYER_PRIVATE_KEY as Hex);
const fundHash = await relayer.sendTransaction({ to: client.account.address, value: toRpcValue(200_000_000n), type: 'legacy', gasPrice: await publicClient.getGasPrice(), gas: 1_500_000n } as never);
const fundReceipt = await publicClient.waitForTransactionReceipt({ hash: fundHash, timeout: 90_000 });
if (fundReceipt.status !== 'success') throw new Error(`Funding the client wallet failed: ${fundHash}`);
// A freshly funded address is auto-created on Hedera; the JSON-RPC relay needs a few seconds to see it.
await waitFor('client account to be visible on the relay', async () => {
  try { await publicClient.getTransactionCount({ address: client.account.address }); return true; } catch { return null; }
}, 30, 2000);
console.log('client balance', hbar(await publicClient.getBalance({ address: client.account.address })));

step('list two agents (benchmark each)');
const main = await createAndBenchmark(lister.token, 'Main Agent', PRICE);
const callee = await createAndBenchmark(lister.token, 'Auditor Agent', CALLEE_PRICE, 'http://localhost:4999');

step('request -> quote -> accept (creates the escrow contract on Hedera)');
const request = await call('POST', '/requests', {
  token: client.token,
  body: {
    title: 'Simple ERC-20 token',
    requirements: 'Write a Solidity ERC-20 token named AgentToken (AGT) with a fixed supply of 1,000,000 minted to the deployer, and no owner-only mint function.',
    checksRequested: ['secrets_scan', 'security_review'],
    budgetTinybar: '200000000',
  },
});
await call('POST', `/requests/${request.id}/quotes`, { token: lister.token, body: { agentId: main.agent.id, priceTinybar: PRICE.toString(), etaHours: 2 } });
const { quotes } = await call('GET', `/requests/${request.id}`);
const agreement = await call('POST', `/quotes/${quotes[0].id}/accept`, { token: client.token });
if (!agreement.escrowAddress) throw new Error(`No escrow created: ${agreement.escrowError}`);
console.log('agreement', agreement.id, 'escrow', agreement.escrowAddress);

step('client funds the escrow from their wallet (1 HBAR)');
const fundTx = await wallet(client.key).writeContract({
  address: agreement.escrowAddress, abi: escrowAbi, functionName: 'fund', value: toRpcValue(PRICE),
  gas: 300_000n, type: 'legacy', gasPrice: await publicClient.getGasPrice(),
} as never);
const fundTxReceipt = await publicClient.waitForTransactionReceipt({ hash: fundTx, timeout: 90_000 });
if (fundTxReceipt.status !== 'success') throw new Error(`fund() reverted: ${fundTx}`);
console.log('fund tx', fundTx);
await waitFor('indexer to mark funded', async () => ((await call('GET', `/agreements/${agreement.id}`)).agreement.status === 'funded' ? true : null));
console.log('status: funded (set by the indexer from the on-chain event)');

step('A2A: agent hires the auditor, paid from the escrow');
const q = await call('POST', '/a2a/quote', { agentKey: main.apiKey, body: { agreementId: agreement.id, calleeAgentId: callee.agent.id } });
console.log('quote', q);
const paid = await call('POST', '/a2a/call', { agentKey: main.apiKey, body: { callId: q.callId, input: { code: 'contract X {}' } } });
console.log('a2a result', paid);
step('A2A: a second hire would exceed the 30% cap -> blocked');
const q2 = await call('POST', '/a2a/quote', { agentKey: main.apiKey, body: { agreementId: agreement.id, calleeAgentId: callee.agent.id }, allow: [403] });
console.log('second quote', q2);
console.log('auditor payout balance', hbar(await publicClient.getBalance({ address: callee.agent.payoutAddress })));

step('agent submits the work');
const contract = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract AgentToken {
  string public constant name = "AgentToken"; string public constant symbol = "AGT"; uint8 public constant decimals = 18;
  uint256 public constant totalSupply = 1_000_000 * 1e18;
  mapping(address => uint256) public balanceOf;
  event Transfer(address indexed from, address indexed to, uint256 value);
  constructor() { balanceOf[msg.sender] = totalSupply; emit Transfer(address(0), msg.sender, totalSupply); }
  function transfer(address to, uint256 v) external returns (bool) { require(to != address(0), "zero"); require(balanceOf[msg.sender] >= v, "bal"); balanceOf[msg.sender] -= v; balanceOf[to] += v; emit Transfer(msg.sender, to, v); return true; }
}`;
const before = await publicClient.getBalance({ address: main.agent.payoutAddress });
console.log(await call('POST', `/agreements/${agreement.id}/submit`, { agentKey: main.apiKey, body: { content: contract, kind: 'text' } }));

step('verification');
const v: any = await waitFor('verification', async () => {
  const r: any = await call('GET', `/agreements/${agreement.id}/verification`);
  return r.latest ? r : null;
}, 90);
console.log('result', v.latest.result, v.latest.error ?? '');
for (const it of v.latest.items ?? []) console.log(` ${it.passed ? 'PASS' : 'FAIL'}  ${it.name} - ${it.detail}`);
if (v.latest.result === 'ERROR') throw new Error('Verification errored; fix and retry (POST /agreements/:id/verify)');

step('settlement (release/refund on-chain, status set by the indexer)');
const final: any = await waitFor('release/refund event', async () => {
  const r: any = await call('GET', `/agreements/${agreement.id}`);
  return ['released', 'refunded'].includes(r.agreement.status) ? r : null;
}, 60);
console.log('final status', final.agreement.status);
console.log('payments', final.payments.map((p: any) => `${p.kind}:${p.amountTinybar}:${p.status}`).join(', '));
const after = await publicClient.getBalance({ address: main.agent.payoutAddress });
console.log('main agent payout balance change', hbar(after - before), '(expect +0.8 HBAR if PASS, after 0.2 went to the auditor)');
console.log('\nFlow finished.');
calleeServer.close();
process.exit(0);
