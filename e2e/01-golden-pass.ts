// Test 1 (+ parts of 3 and 9): golden PASS with the REAL demo agents (builder 4101 hires auditor 4102 via A2A).
// SETUP BYPASS: agents are created via API, then SQL sets status=listed + endpoint_url. Benchmark-gated listing is NOT exercised.
import { waitRpcHealthy, acceptQuote, startBackend, startAgent, login, makeListedAgent, fundWalletFromRelayer, fundEscrow, ok, q, record, log, waitFor, closeDb, evidence, checkTxs, sha256, publicClient, escrowAbi, mirrorBalanceTinybar } from './lib.ts';
import type { Address } from 'viem';
const PRICE = 50_000_000n, AUD = 10_000_000n;
await waitRpcHealthy();
const be = await startBackend(); const procs = [be];
try {
  const lister = await login(); const client = await login();
  log('fund client wallet from relayer');
  const fundWalletTx = await fundWalletFromRelayer(client.account.address, 80_000_000n);
  const aud = await makeListedAgent(lister.token, 'golden auditor', AUD, 'http://localhost:4102', ['static-audit']);
  const bld = await makeListedAgent(lister.token, 'golden builder', PRICE, 'http://localhost:4101', ['solidity-build']);
  const common = { BACKEND_URL: 'http://localhost:4010' };
  procs.push(await startAgent('static-auditor', 4102, { ...common, STATIC_AUDITOR_API_KEY: aud.apiKey }));
  procs.push(await startAgent('solidity-builder', 4101, { ...common, SOLIDITY_BUILDER_API_KEY: bld.apiKey, STATIC_AUDITOR_AGENT_ID: aud.agent.id, SOLIDITY_BUILDER_PRICE_TINYBAR: PRICE.toString(), DEMO_OVERBUY: 'true' }));
  log(`builder ${bld.agent.id} auditor ${aud.agent.id}`);

  const request = await ok('POST', '/requests', { token: client.token, body: { title: '[qa] golden ERC-20', requirements: 'Write a Solidity ^0.8.24 ERC-20 token named AgentToken (AGT) with a fixed supply of 1,000,000 minted to the deployer, a transfer function with a zero-address check, and no owner-only mint function.', checksRequested: ['secrets_scan'], budgetTinybar: PRICE.toString() } });
  const quote = await waitFor('quote solicited from builder /quote', async () => (await ok('GET', `/requests/${request.id}`)).quotes.find((x: any) => x.agentId === bld.agent.id), 15, 2000);
  log(`quote ${quote.id} price ${quote.priceTinybar} (solicited by backend, not posted by us)`);
  const ag = await acceptQuote(client.token, quote.id);
  if (!ag.escrowAddress) throw new Error('no escrow: ' + ag.escrowError);
  log(`agreement ${ag.id} escrow ${ag.escrowAddress}`);
  const fundTx = await fundEscrow(client.key, ag.escrowAddress, PRICE);
  log(`fund tx ${fundTx}`);
  await waitFor('indexer flips to funded (no manual step)', async () => (await ok('GET', `/agreements/${ag.id}`)).agreement.status !== 'agreed', 30, 3000);
  const afterFund = (await ok('GET', `/agreements/${ag.id}`)).agreement;
  log(`status after funding: ${afterFund.status}`);
  await waitFor('dispatch', async () => (await ok('GET', `/agreements/${ag.id}`)).agreement.dispatchedAt, 20, 3000);
  log('dispatched to builder /tasks');
  const final = await waitFor('release/refund', async () => { const r = await ok('GET', `/agreements/${ag.id}`); return ['released', 'refunded'].includes(r.agreement.status) ? r : null; }, 120, 5000);
  const ev = await evidence(ag.id);
  const hashes = [fundWalletTx, fundTx, ...ev.payments.map((p: any) => p.tx_hash), ev.verdict?.settle_tx_hash, ...ev.events.map((e: any) => e.tx_hash)];
  const txs = await checkTxs(hashes);
  const sub = ev.subs[ev.subs.length - 1];
  const onchainHash = (await publicClient.readContract({ address: ag.escrowAddress as Address, abi: escrowAbi, functionName: 'deliverableHash' } as never)) as string;
  const hashMatch = sub && onchainHash.toLowerCase() === `0x${sub.deliverable_hash}`.toLowerCase();
  const paid = ev.calls.filter((c: any) => ['paid', 'done'].includes(c.status)).length, blocked = ev.calls.filter((c: any) => c.status === 'blocked').length;
  console.log(JSON.stringify({ agreement: ag.id, escrow: ag.escrowAddress, status: final.agreement.status, payments: ev.payments, calls: ev.calls, subs: ev.subs, vers: ev.vers.map((v: any) => ({ id: v.id, result: v.result, error: v.error })), verdict: ev.verdict, events: ev.events.map((e: any) => `${e.event}:${e.tx_hash}`), txs, onchainHash, hashMatch }, null, 1));
  const allOk = txs.every((t) => t.endsWith('=SUCCESS'));
  const payoutBal = await mirrorBalanceTinybar(bld.agent.payoutAddress);
  console.log('builder payout balance tinybar', payoutBal.toString(), 'auditor payout', (await mirrorBalanceTinybar(aud.agent.payoutAddress)).toString());
  const pass = final.agreement.status === 'released' && ev.verdict?.result === 'PASS' && paid === 1 && blocked >= 1 && hashMatch && allOk;
  record('Golden PASS (real demo agents, A2A hire, release)', pass ? 'PARTIAL' : 'FAIL',
    `agreement ${ag.id} escrow ${ag.escrowAddress} final=${final.agreement.status} verdict=${ev.verdict?.result} a2a paid/done=${paid} blocked=${blocked} onchain deliverableHash match=${hashMatch} agent payout balance=${payoutBal} tinybar; verification ids ${ev.vers.map((v: any) => v.id + ':' + v.result).join(',')}; PARTIAL because benchmark-gated listing bypassed (SQL status=listed on agents ${bld.agent.id}, ${aud.agent.id})`, hashes.filter(Boolean) as string[]);
  record('Indexer: funding flips agreement to funded with no manual step', afterFund.status !== 'agreed' && ev.events.some((e: any) => e.event === 'Funded') ? 'PASS' : 'FAIL', `agreement ${ag.id} status after Funded tx ${fundTx}: ${afterFund.status}; chain_events: ${ev.events.map((e: any) => e.event).join(',')}`, [fundTx]);
} catch (e) { record('Golden PASS', 'FAIL', `script error: ${(e as Error).message}`); }
finally { for (const p of procs.reverse()) await p.stop(); await closeDb(); process.exit(0); }
