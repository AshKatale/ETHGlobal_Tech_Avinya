// END-TO-END on Hedera testnet with real HBAR and real x402 payments, through every component:
//   backend API + Solidity agent (designs/deploys the task contract) + x402 gateway + indexer.
//
//   client logs in -> terms previewed -> quote accepted (agent deploys the single task contract) -> client funds by x402
//   -> agent A hires sub-agent B (leg added to the SAME contract) -> A submits -> verified PASS -> contract pays A
//   -> A pays B by x402 -> receipt recorded on-chain.
//
// Needs running: the backend (API + gateway) and the solidity-agent. Roles (testnet accounts from .env):
//   client = relayer account | agent A payout = verifier account | sub-agent B payout = designer account.
// Run: API_URL=http://localhost:4000 GATEWAY_URL=http://localhost:4402 REPO_URL=https://github.com/owner/repo npm run flow
import 'dotenv/config';
import { createServer } from 'node:http';
import { PrivateKey } from '@hiero-ledger/sdk';
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { createClientHederaSigner } from '@x402/hedera';
import { ExactHederaScheme as ClientScheme } from '@x402/hedera/exact/client';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { accountIdOf, balanceTinybar } from '../src/chain/mirror.js';
import { readLegStatus } from '../src/chain/client.js';
import { LegStatus } from '../src/chain/abi.js';

const API = process.env.API_URL ?? 'http://localhost:4000';
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:4402';
const REPO_URL = process.env.REPO_URL;
if (!REPO_URL) throw new Error('Set REPO_URL to a public GitHub repo to benchmark');
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} missing in .env`); return v.replace(/^0x/, ''); };
const relayerKey = need('RELAYER_PRIVATE_KEY'), verifierKey = need('VERIFIER_PRIVATE_KEY'), designerKey = need('DESIGNER_PRIVATE_KEY');
const acct = (k: string) => privateKeyToAccount(`0x${k}`);
const clientWallet = acct(relayerKey), agentAWallet = acct(verifierKey), agentBWallet = acct(designerKey);

const A_PRICE = 5_000_000n; // 0.05 HBAR (tinybar)
const B_PRICE = 800_000n;   // 0.008 HBAR: 16% of A's price, inside any cap the designer sets for a new agent
const NETWORK = 'hedera:testnet';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (s: string) => console.log(`\n== ${s}`);
const hashscan = (tx: string) => `https://hashscan.io/testnet/transaction/${tx.replace('@', '-').replace(/\.(\d+)\.(\d+)$/, '-$1-$2')}`;

async function call<T = any>(method: string, path: string, o: { token?: string; agentKey?: string; body?: unknown; allow?: number[] } = {}): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.agentKey ? { 'x-agent-key': o.agentKey } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok && !o.allow?.includes(res.status)) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return json as T;
}
async function login(account = privateKeyToAccount(generatePrivateKey())) {
  const { nonce, message } = await call('POST', '/auth/nonce', { body: { address: account.address } });
  const signature = await account.signMessage({ message });
  const { token } = await call('POST', '/auth/verify', { body: { address: account.address, nonce, signature } });
  return token as string;
}
async function waitFor<T>(label: string, fn: () => Promise<T | null | false>, tries = 60, ms = 3000): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await fn().catch(() => null); if (v) return v; await sleep(ms); }
  throw new Error(`Timed out waiting for ${label}`);
}

/** An agent's own x402 client: autonomous, with a spend control (HBAR only, at most 1 HBAR per payment). */
const payer = (accountId: string, key: string) => wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: 'hedera:*', client: new ClientScheme(createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(key), { network: NETWORK })) }],
  spendControls: { allowedAssets: [{ network: NETWORK, asset: '0.0.0', maxAmountPerPayment: '100000000' }] },
});
const settlementOf = (res: Response) => decodePaymentResponseHeader((res.headers.get('payment-response') ?? res.headers.get('x-payment-response'))!) as { success: boolean; transaction: string; payer: string };

async function listAgent(token: string, name: string, price: bigint, payout: string, endpointUrl?: string) {
  const { agent, apiKey } = await call('POST', '/agents', {
    token, body: {
      name, description: process.env.AGENT_DESCRIPTION ?? 'Solidity smart contract developer agent',
      capabilities: (process.env.AGENT_CAPS ?? 'solidity,smart-contracts').split(','),
      priceTinybar: price.toString(), payoutAddress: payout, repoUrl: REPO_URL, endpointUrl,
    },
  });
  const { runId } = await call('POST', `/agents/${agent.id}/benchmark`, { token, body: {} });
  const run: any = await waitFor('benchmark', async () => { const r: any = await call('GET', `/agents/${agent.id}/benchmark/${runId}`); return r.status !== 'running' ? r : null; });
  console.log(`  ${name}: benchmark ${run.status}, score ${run.score}`);
  if (run.status !== 'passed') throw new Error(`${name} was not listed (benchmark ${run.status}). Use a stronger repo.`);
  return { agent, apiKey: apiKey as string };
}

// Each agent is a small HTTP service; these two stand in for real agent runtimes.
const receivedTasks: any[] = [];
function agentServer(port: number, handle: (path: string, body: any) => { status: number; json: unknown }) {
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const out = handle(req.url ?? '', raw ? JSON.parse(raw) : {});
      res.statusCode = out.status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out.json));
    });
  });
  return new Promise<ReturnType<typeof createServer>>((resolve) => server.listen(port, () => resolve(server)));
}
// Agent A: quotes when the platform asks, and is told to start work once the task is funded.
const aServer = await agentServer(4998, (path, body) => {
  if (path === '/quote') return { status: 200, json: { priceTinybar: A_PRICE.toString(), etaHours: 2 } };
  if (path === '/tasks') { receivedTasks.push(body); return { status: 202, json: { accepted: true } }; }
  return { status: 404, json: {} };
});
// Sub-agent B: a REAL agent if B_ENDPOINT is set (e.g. the Static Auditor on http://localhost:5002), otherwise a stub that
// declines the client's quote request (it only works for agents) and answers the sub-task.
const B_ENDPOINT = process.env.B_ENDPOINT;
const bServer = B_ENDPOINT ? null : await agentServer(4999, (path, body) => {
  if (path === '/quote') return { status: 200, json: { decline: true } };
  if (path === '/a2a') return { status: 200, json: { review: 'No critical issues found by the demo auditor.', received: body.input } };
  return { status: 404, json: {} };
});

try {
  const clientId = await accountIdOf(clientWallet.address), agentAId = await accountIdOf(agentAWallet.address), agentBId = await accountIdOf(agentBWallet.address);
  console.log(`client ${clientId} | agent A ${agentAId} | sub-agent B ${agentBId}`);

  step('log in: the client uses the relayer account; the lister is a fresh wallet');
  const clientToken = await login(clientWallet);
  const listerToken = await login();

  step('list agent A and sub-agent B (each passes the benchmark; payouts go to funded testnet accounts)');
  const A = await listAgent(listerToken, 'Agent A', A_PRICE, agentAWallet.address, 'http://localhost:4998');
  const B = await listAgent(listerToken, 'Sub-agent B', B_PRICE, agentBWallet.address, B_ENDPOINT ?? 'http://localhost:4999');

  step('client posts a request: the platform asks the listed agents for quotes by itself');
  const request = await call('POST', '/requests', {
    token: clientToken, body: {
      title: 'Simple ERC-20 token',
      requirements: 'Write a Solidity ERC-20 token named AgentToken (AGT) with a fixed supply of 1,000,000 minted to the deployer, and no owner-only mint function.',
      checksRequested: ['secrets_scan', 'security_review'], budgetTinybar: '100000000',
    },
  });
  const { quotes } = await waitFor('the agents to answer the quote request', async () => {
    const r: any = await call('GET', `/requests/${request.id}`);
    return r.quotes.some((q: any) => q.agentId === A.agent.id) ? r : null;
  }, 30, 2000);
  const quoteA = quotes.find((q: any) => q.agentId === A.agent.id);
  console.log(`  agent A answered the quote request on its own: ${quoteA.priceTinybar} tinybar (${quotes.length} quote(s) in total; B declined)`);
  console.log('  the client previews the contract terms the Solidity agent designs:');
  const terms = await call('POST', `/quotes/${quoteA.id}/terms`, { token: clientToken });
  const s = terms.spec;
  console.log(`  designed terms [${terms.source}]: trust ${s.trustScore} (${s.trustTier}) | deadline ${s.deadlineHours}h | sub-agent cap ${s.maxSubBps / 100}% | max sub-agents ${s.maxSubLegs} | payout grace ${s.payoutGraceSecs / 3600}h | pass ${s.passThresholdPct}%`);

  step('accept the quote: the Solidity agent deploys the single task contract');
  const agreement = await call('POST', `/quotes/${quoteA.id}/accept`, { token: clientToken });
  if (!agreement.escrowAddress) throw new Error(`No task contract: ${agreement.escrowError}`);
  console.log(`  task contract ${agreement.escrowAddress}`);
  const funding = await call('GET', `/agreements/${agreement.id}/funding`);
  console.log(`  task account ${funding.taskAccountId} | x402 funding endpoint ${funding.x402.url}`);

  step('client funds the task over x402 (native HBAR transfer into the contract account, no human approving)');
  const fundRes = await payer(clientId, relayerKey)(`${GATEWAY}/x402/fund/${agreement.id}`);
  if (fundRes.status !== 200) throw new Error(`x402 funding failed: ${fundRes.status} ${await fundRes.text()}`);
  const fundTx = settlementOf(fundRes).transaction;
  console.log(`  paid -> ${fundRes.status}  ${fundTx}\n  ${hashscan(fundTx)}`);
  await waitFor('funded (set by the indexer from the on-chain Funded event)', async () => (await call('GET', `/agreements/${agreement.id}`)).agreement.status === 'funded');
  console.log('  status: funded');
  await waitFor('agent A to be told to start work', async () => receivedTasks.length > 0, 20, 1000);
  const task = receivedTasks[0];
  console.log(`  agent A was told to start work by the platform: "${task.title}" | deadline ${task.terms?.deadlineHours}h | pass threshold ${task.terms?.passThresholdPct}% | checks ${task.terms?.checks?.join(', ')}`);
  console.log(`  dispatch recorded on the agreement: ${(await call('GET', `/agreements/${agreement.id}`)).agreement.taskDispatchStatus}`);

  step('agent A hires sub-agent B inside the SAME contract');
  const quote = await call('POST', '/a2a/quote', { agentKey: A.apiKey, body: { agreementId: agreement.id, calleeAgentId: B.agent.id } });
  console.log(`  quote: allowed=${quote.allowed}, price ${quote.priceTinybar}, remaining sub-agent budget ${quote.remainingBudgetTinybar}`);
  const hired = await call('POST', '/a2a/call', { agentKey: A.apiKey, body: { callId: quote.callId, input: { code: 'contract AgentToken {}' } } });
  console.log(`  leg ${hired.legId} added to the contract; B answered: ${JSON.stringify(hired.output).slice(0, 80)}`);
  const quote2 = await call('POST', '/a2a/quote', { agentKey: A.apiKey, body: { agreementId: agreement.id, calleeAgentId: B.agent.id }, allow: [403] });
  console.log(`  hiring B again: allowed=${quote2.allowed}${quote2.reason ? ` (${quote2.reason})` : ''}`);

  step('agent A submits; the final result is verified; the contract pays A');
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
  const aBefore = await balanceTinybar(agentAId);
  await call('POST', `/agreements/${agreement.id}/submit`, { agentKey: A.apiKey, body: { content: contract, kind: 'text' } });
  let v: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const seen = attempt === 1 ? 0 : v.history.length; // wait for a NEW result after a retry
    v = await waitFor('verification', async () => { const r: any = await call('GET', `/agreements/${agreement.id}/verification`); return r.history.length > seen ? r : null; }, 90);
    console.log(`  verification: ${v.latest.result}${v.latest.error ? ` (${String(v.latest.error).split('\n')[0].slice(0, 90)})` : ''}`);
    if (v.latest.result !== 'ERROR') break;
    if (attempt === 3) throw new Error('Verification kept erroring (infrastructure)');
    console.log('  infrastructure error, not a FAIL: pressing "retry verification"');
    await call('POST', `/agreements/${agreement.id}/verify`, { token: clientToken });
  }
  console.log(`  verified against the DESIGNED terms: pass threshold ${v.terms?.passThresholdPct}%, checks ${v.terms?.checks?.join(', ')}`);
  console.log(`  ${v.latest.summary}`);
  for (const it of v.latest.items ?? []) console.log(`   ${it.passed ? 'PASS' : 'FAIL'}  [${it.kind}] ${it.name}`);
  const final: any = await waitFor('released/refunded event', async () => { const r: any = await call('GET', `/agreements/${agreement.id}`); return ['released', 'refunded'].includes(r.agreement.status) ? r : null; }, 60);
  console.log(`  status: ${final.agreement.status}`);
  if (final.agreement.status !== 'released') { console.log('  Not released (verdict FAIL): the client was refunded and no sub-agent is owed.'); process.exit(0); }
  await sleep(5000);
  console.log(`  agent A received ${(await balanceTinybar(agentAId)) - aBefore} tinybar (expected ${A_PRICE})`);

  step('agent A pays sub-agent B over x402 (autonomous; the contract only records the receipt)');
  const payouts = await call('GET', `/agreements/${agreement.id}/payouts`);
  console.log(`  owed: ${payouts.map((p: any) => `leg ${p.legId} ${p.priceTinybar} tinybar -> ${p.payeeAccountId}`).join(', ')}`);
  const bBefore = await balanceTinybar(agentBId);
  const payRes = await payer(agentAId, verifierKey)(payouts[0].payUrl);
  if (payRes.status !== 200) throw new Error(`x402 payout failed: ${payRes.status} ${await payRes.text()}`);
  const payTx = settlementOf(payRes).transaction;
  console.log(`  paid -> ${payRes.status}  ${payTx}\n  ${hashscan(payTx)}`);
  await sleep(6000);
  console.log(`  sub-agent B received ${(await balanceTinybar(agentBId)) - bBefore} tinybar (expected ${B_PRICE})`);
  const done: any = await waitFor('payout recorded', async () => { const r: any = await call('GET', `/agreements/${agreement.id}`); return r.subLegs.every((l: any) => l.status === 'paid') ? r : null; }, 30);
  console.log(`  database: ${done.subLegs.map((l: any) => `leg ${l.legId} ${l.status} (${l.payoutTx})`).join(', ')}`);
  for (const l of done.subLegs) {
    await waitFor(`leg ${l.legId} receipt on-chain`, async () => (await readLegStatus(agreement.escrowAddress, l.legId)) === LegStatus.Paid, 40, 3000);
    console.log(`  on-chain: leg ${l.legId} is Paid (PayoutRecorded with the x402 transaction id)`);
  }

  console.log('\nRESULT: client -> A -> B settled in one task contract, funded and paid over x402 on Hedera testnet.');
  console.log(`  task contract : ${agreement.escrowAddress}`);
  console.log(`  funding  (x402): ${fundTx}`);
  console.log(`  A pays B (x402): ${payTx}`);
} catch (e) {
  console.error('\nFLOW FAILED:', (e as Error).message);
  process.exitCode = 1;
} finally {
  aServer.close();
  bServer?.close();
  process.exit(process.exitCode ?? 0);
}
