// Tests the LIVE demo agents (live-agents/) through the real platform, as a client would, with no stubs:
//   post a job -> agents quote by themselves -> accept (contract deployed) -> fund over x402 -> Solidity Smith writes the contract
//   (hiring Audit Hawk inside the same task) -> submit -> verified against the designed terms -> released -> Smith pays Hawk over x402.
// Needs running: backend, solidity-agent, live-agents (npm run all), seeded agents (npm run seed:agents).
// Run: API_URL=http://localhost:4001 GATEWAY_URL=http://localhost:4403 npm run live-flow
import 'dotenv/config';
import { PrivateKey } from '@hiero-ledger/sdk';
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { createClientHederaSigner } from '@x402/hedera';
import { ExactHederaScheme } from '@x402/hedera/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import { accountIdOf, balanceTinybar } from '../src/chain/mirror.js';

const API = process.env.API_URL ?? 'http://localhost:4000';
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:4402';
const NETWORK = 'hedera:testnet' as const;
const key = (process.env.RELAYER_PRIVATE_KEY ?? '').replace(/^0x/, '');
if (!key) throw new Error('RELAYER_PRIVATE_KEY missing in .env');
const client = privateKeyToAccount(`0x${key}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (s: string) => console.log(`\n== ${s}`);

async function call<T = any>(method: string, path: string, o: { token?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) }, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}
async function waitFor<T>(label: string, fn: () => Promise<T | null | false>, tries = 60, ms = 3000): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await fn().catch(() => null); if (v) return v; await sleep(ms); }
  throw new Error(`Timed out waiting for ${label}`);
}

step('log in as the client (the relayer testnet account)');
const { nonce, message } = await call('POST', '/auth/nonce', { body: { address: client.address } });
const { token } = await call('POST', '/auth/verify', { body: { address: client.address, nonce, signature: await client.signMessage({ message }) } });
const clientId = await accountIdOf(client.address);

step('post a job: the platform asks every listed agent for a quote');
const request = await call('POST', '/requests', { token, body: {
  title: 'Simple ERC-20 token',
  requirements: 'Write a Solidity ERC-20 token named AgentToken (AGT) with a fixed supply of 1,000,000 (18 decimals) minted to the deployer in the constructor, and no owner-only mint function.',
  checksRequested: ['secrets_scan', 'security_review'], budgetTinybar: '100000000',
} });
const { quotes } = await waitFor('quotes', async () => { const r: any = await call('GET', `/requests/${request.id}`); return r.quotes.length ? r : null; }, 30, 2000);
await sleep(4000); // let slower agents answer too
const all: any = await call('GET', `/requests/${request.id}`);
for (const q of all.quotes) console.log(`  quote: ${q.agent?.name ?? q.agentId} asks ${Number(q.priceTinybar) / 1e8} HBAR`);
const quote = all.quotes.find((q: any) => q.agent?.name === 'Solidity Smith');
if (!quote) throw new Error('Solidity Smith did not quote');
console.log(`  declined (not their kind of work): ${5 - all.quotes.length} of 5 agents`);

step('preview and accept the quote: the designer deploys the task contract');
const terms = await call('POST', `/quotes/${quote.id}/terms`, { token });
const s = terms.spec;
console.log(`  [${terms.source}] pass ${s.passThresholdPct}% | deadline ${s.deadlineHours}h | sub-agent cap ${s.maxSubBps / 100}% | max sub-agents ${s.maxSubLegs}`);
const agreement = await call('POST', `/quotes/${quote.id}/accept`, { token });
console.log(`  contract ${agreement.escrowAddress}`);

step('fund the job over x402');
const pay = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: 'hedera:*', client: new ExactHederaScheme(createClientHederaSigner(clientId, PrivateKey.fromStringECDSA(key), { network: NETWORK })) }],
  spendControls: { allowedAssets: [{ network: NETWORK, asset: '0.0.0', maxAmountPerPayment: '100000000' }] },
});
const fundRes = await pay(`${GATEWAY}/x402/fund/${agreement.id}`);
if (fundRes.status !== 200) throw new Error(`funding failed: ${fundRes.status} ${await fundRes.text()}`);
console.log(`  paid: ${(decodePaymentResponseHeader((fundRes.headers.get('payment-response') ?? fundRes.headers.get('x-payment-response'))!) as any).transaction}`);
await waitFor('funded', async () => (await call('GET', `/agreements/${agreement.id}`)).agreement.status === 'funded');
console.log('  status: funded (set by the indexer)');

step('Solidity Smith works on its own (writes the contract, may hire Audit Hawk), then submits');
const sub: any = await waitFor('the submission', async () => { const r: any = await call('GET', `/agreements/${agreement.id}`); return r.submission ?? (['submitted', 'verifying', 'released', 'refunded'].includes(r.agreement.status) ? r : null); }, 60, 5000);
const detail: any = await call('GET', `/agreements/${agreement.id}`);
console.log(`  status: ${detail.agreement.status} | dispatch: ${detail.agreement.taskDispatchStatus} | sub-agent legs: ${detail.subLegs.length}`);
const sublegs = detail.subLegs.map((l: any) => `${l.priceTinybar} tinybar -> ${l.payeeAccountId}`);
if (sublegs.length) console.log(`  hired: ${sublegs.join(', ')}`);

step('automatic verification against the designed terms');
let v: any = await waitFor('verification', async () => { const r: any = await call('GET', `/agreements/${agreement.id}/verification`); return r.latest ? r : null; }, 60, 4000);
if (v.latest.result === 'ERROR') { console.log(`  infrastructure error (not a FAIL): ${String(v.latest.error).slice(0, 100)}; retrying`); await call('POST', `/agreements/${agreement.id}/verify`, { token }); v = await waitFor('verification retry', async () => { const r: any = await call('GET', `/agreements/${agreement.id}/verification`); return r.latest && r.latest.result !== 'ERROR' ? r : null; }, 40, 4000); }
console.log(`  verdict: ${v.latest.result} | ${v.latest.summary}`);
for (const it of v.latest.items ?? []) console.log(`   ${it.passed ? 'PASS' : 'FAIL'}  [${it.kind}] ${it.name ?? it.label}`);

const final: any = await waitFor('release or refund', async () => { const r: any = await call('GET', `/agreements/${agreement.id}`); return ['released', 'refunded'].includes(r.agreement.status) ? r : null; }, 40, 3000);
console.log(`  final status: ${final.agreement.status}`);
if (final.agreement.status === 'released' && final.subLegs.length) {
  step('Solidity Smith pays Audit Hawk over x402 on its own');
  const done: any = await waitFor('sub-agent payout', async () => { const r: any = await call('GET', `/agreements/${agreement.id}`); return r.subLegs.every((l: any) => l.status === 'paid') ? r : null; }, 40, 4000);
  for (const l of done.subLegs) console.log(`  leg ${l.legId} paid (${l.payoutTx}); payee balance now ${Number(await balanceTinybar(l.payeeAccountId)) / 1e8} HBAR`);
}
console.log(`\nRESULT: ${final.agreement.status}  contract ${agreement.escrowAddress}  agreement ${agreement.id}`);
process.exit(0);
