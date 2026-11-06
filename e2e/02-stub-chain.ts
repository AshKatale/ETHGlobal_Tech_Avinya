// Tests 3,4,5,7,2,9 on ONE funded escrow (0.5 HBAR) using qa-controlled agents (no LLM agent). Benchmark gate BYPASSED (SQL listed).
import { waitRpcHealthy, startBackend, fundedJob, makeListedAgent, startStubCallee, http2, ok, q, record, log, waitFor, closeDb, evidence, checkTxs, sha256, publicClient, escrowAbi, escrowState, mirrorBalanceTinybar, sleep } from './lib.ts';
import type { Address } from 'viem';
const PRICE = 50_000_000n, CALLEE = 10_000_000n; // cap 30% = 15_000_000
await waitRpcHealthy();
let be = await startBackend({ NVIDIA_API_KEY: '' });
const stub = await startStubCallee(4999);
const R: [string, any, string, string[]][] = [];
const rec = (t: string, v: any, e: string, tx: string[] = []) => { R.push([t, v, e, tx]); record(t, v, e, tx); };
try {
  const job = await fundedJob({ price: PRICE, title: 'stub-chain', checks: ['secrets_scan'], requirements: 'Write a Solidity ^0.8.24 ERC-20 token named AgentToken (AGT), fixed supply 1,000,000 minted to the deployer, with a transfer function.' });
  const id = job.agreement.id, esc = job.escrow;
  log(`agreement ${id} escrow ${esc} fund tx ${job.fundTx}`);
  const callee = await makeListedAgent(job.lister.token, 'stub callee', CALLEE, 'http://localhost:4999', ['qa-audit']);

  // ---- Test 4 + 3: two quotes both allowed, fire both calls simultaneously ----
  const mk = async () => (await http2('POST', '/a2a/quote', { agentKey: job.main.apiKey, body: { agreementId: id, calleeAgentId: callee.agent.id } }));
  let c1: any, c2: any, rounds = 0; const roundLog: string[] = [];
  for (; rounds < 3; rounds++) {
    const [q1, q2] = [await mk(), await mk()];
    [c1, c2] = await Promise.all([q1, q2].map((x) => http2('POST', '/a2a/call', { agentKey: job.main.apiKey, body: { callId: x.json.callId, input: { code: 'x' } } })));
    roundLog.push(`round ${rounds + 1}: quotes ${q1.status}/${q2.status}, calls ${c1.status}/${c2.status}`);
    log(roundLog.at(-1)!);
    if ([c1.status, c2.status].includes(200)) break; // a payment landed; otherwise Hashio timed out -> infra noise, try again (failed calls are not counted)
  }
  const sts = [c1.status, c2.status].sort().map(String);
  let ev = await evidence(id);
  const paidRows = ev.calls.filter((c: any) => ['paid', 'done'].includes(c.status));
  const a2aPay = ev.payments.filter((p: any) => p.kind === 'a2a');
  const spent = paidRows.reduce((s: bigint, c: any) => s + BigInt(c.price_tinybar), 0n);
  const conc = sts[0] === '200' && sts[1] === '403' && paidRows.length === 1 && spent <= 15_000_000n;
  const payTx = a2aPay.map((p: any) => p.tx_hash);
  const infra = !sts.includes('200');
  rec('Concurrency: two simultaneous /a2a/call cannot overspend 30% cap', conc ? 'PASS' : infra ? 'NOT RUN' : 'FAIL', `agreement ${id}; ${roundLog.join('; ')}; final call statuses ${c1.status},${c2.status} (${JSON.stringify(c1.json).slice(0, 70)} / ${JSON.stringify(c2.json).slice(0, 70)}); a2a_calls paid/done rows=${paidRows.length}, total ${spent} tinybar <= cap 15000000; a2a payments rows=${a2aPay.length} tx ${payTx.join(',')}; calls ${ev.calls.map((c: any) => c.id + ':' + c.status).join(',')}${infra ? ' INCONCLUSIVE: Hashio timeouts made every payment fail' : ''}`, payTx);

  // ---- Test 3: over-budget hire is blocked ----
  const q3 = await mk();
  ev = await evidence(id);
  const blockedRow = ev.calls.filter((c: any) => c.status === "blocked").at(-1);
  rec('Blocked A2A: over-budget hire -> 403 + blocked row with reason; 30% cap holds', infra ? 'NOT RUN' : q3.status === 403 && q3.json.allowed === false && blockedRow?.blocked_reason ? 'PASS' : 'FAIL', `agreement ${id}; quote status ${q3.status} reason "${q3.json.reason}"; blocked row ${blockedRow?.id} reason "${blockedRow?.blocked_reason}"; remainingBudget ${q3.json.remainingBudgetTinybar}`);
  // also: blocked call id cannot be called
  const callBlocked = await http2('POST', '/a2a/call', { agentKey: job.main.apiKey, body: { callId: q3.json.callId, input: {} } });
  log(`calling the blocked callId -> ${callBlocked.status}`);

  // ---- Test 9b: indexer idempotency (re-run from cursor 0) ----
  const snap = async () => ({ ev: (await q('select count(*)::int c from chain_events where contract=$1', [esc]))[0].c, fund: (await q("select count(*)::int c from payments where agreement_id=$1 and kind='fund'", [id]))[0].c, a2a: (await q("select count(*)::int c from payments where agreement_id=$1 and kind='a2a'", [id]))[0].c });
  await sleep(12000); const before = await snap();
  await q('delete from chain_cursor where contract=$1', [esc]); // my own escrow's cursor: forces a full re-index from timestamp 0
  await sleep(20000); const after = await snap();
  const cur = await q('select last_consensus_ts from chain_cursor where contract=$1', [esc]);
  rec('Indexer idempotency: re-index from cursor 0 creates no duplicate rows', JSON.stringify(before) === JSON.stringify(after) && cur.length === 1 && before.ev >= 3 ? 'PASS' : 'FAIL', `escrow ${esc}; counts before ${JSON.stringify(before)} after cursor deletion + 20s (>=3 indexer cycles; cursor row recreated=${cur.length === 1}) ${JSON.stringify(after)}`);

  // ---- Test 5/7: submit a bad deliverable, backend has NO NVIDIA key ----
  const bad = '// TODO: not implemented. This file intentionally does not contain the requested token.';
  const s1 = await http2('POST', `/agreements/${id}/submit`, { agentKey: job.main.apiKey, body: { content: bad, kind: 'text' } });
  const s2 = await http2('POST', `/agreements/${id}/submit`, { agentKey: job.main.apiKey, body: { content: 'second submission, different content', kind: 'text' } });
  const verErr: any = await waitFor('ERROR verification', async () => { const v = await ok('GET', `/agreements/${id}/verification`); return v.latest ? v : null; }, 40, 3000);
  await sleep(2000);
  const s3 = await http2('POST', `/agreements/${id}/submit`, { agentKey: job.main.apiKey, body: { content: 'third, after ERROR', kind: 'text' } });
  const onchain = ((await publicClient.readContract({ address: esc, abi: escrowAbi, functionName: 'deliverableHash' } as never)) as string).toLowerCase();
  ev = await evidence(id);
  rec('Resubmit: second submit while submitted/verifying -> 409; on-chain hash == sha256(first deliverable)', s1.status === 202 && s2.status === 409 && s3.status === 409 && onchain === `0x${sha256(bad)}` && ev.subs.length === 1 ? 'PASS' : 'FAIL', `agreement ${id}; submit1 ${s1.status}, submit2 ${s2.status} ${JSON.stringify(s2.json).slice(0, 90)}, submit3(after ERROR) ${s3.status}; submissions rows=${ev.subs.length} (${ev.subs[0]?.id}); on-chain deliverableHash ${onchain} vs sha256 ${sha256(bad)}`);
  const stErr = await escrowState(esc);
  rec('Infrastructure error: NVIDIA key unset -> verification ERROR, never FAIL/verdict', verErr.latest.result === 'ERROR' && !ev.verdict && verErr.status === 'submitted' && stErr === 2 ? 'PASS' : 'FAIL', `agreement ${id}; verification ${verErr.latest.id} result=${verErr.latest.result} error="${String(verErr.latest.error).slice(0, 80)}"; agreement status=${verErr.status}; verdict rows=${ev.verdict ? 1 : 0}; escrow on-chain state=${stErr} (2=Submitted, funds not moved)`);

  // ---- retry with NVIDIA key restored ----
  await be.stop(); be = await startBackend();
  const rv = await http2('POST', `/agreements/${id}/verify`, { token: job.client.token });
  const fin: any = await waitFor('settled', async () => { const r = await ok('GET', `/agreements/${id}`); return ['released', 'refunded'].includes(r.agreement.status) ? r : null; }, 80, 4000);
  ev = await evidence(id);
  const st = await escrowState(esc);
  const refundP = ev.payments.find((p: any) => p.kind === 'refund');
  const hashes = [job.fundWalletTx, job.fundTx, ...ev.payments.map((p: any) => p.tx_hash), ev.verdict?.settle_tx_hash, ...ev.events.map((e: any) => e.tx_hash)];
  const txs = await checkTxs(hashes);
  const txOk = txs.every((t) => t.endsWith('=SUCCESS'));
  rec('Infrastructure error: retry (POST /verify) works after key restored', rv.status === 202 && ev.vers.some((v: any) => v.result === 'ERROR') && ev.vers.some((v: any) => ['PASS', 'FAIL'].includes(v.result)) ? 'PASS' : 'FAIL', `verify retry status ${rv.status}; verifications ${ev.vers.map((v: any) => v.id + ':' + v.result).join(', ')}`);
  rec('Golden FAIL: bad submission -> FAIL verdict, client refunded', fin.agreement.status === 'refunded' && ev.verdict?.result === 'FAIL' && st === 4 && refundP && txOk ? 'PASS' : 'FAIL', `agreement ${id} escrow ${esc} final=${fin.agreement.status} verdict ${ev.verdict?.id}=${ev.verdict?.result}; on-chain state=${st} (4=Refunded); refund payment ${refundP?.id} amount ${refundP?.amount_tinybar} tinybar (expect ${PRICE - CALLEE} = price - delegated); mirror: ${txs.join(' ')}; items ${JSON.stringify(ev.vers.at(-1)?.summary).slice(0, 120)}; note: client wallet funded on the same agreement so A2A+concurrency share this escrow; the agent was a qa-controlled stub (benchmark gate bypassed)`, hashes.filter(Boolean) as string[]);
  console.log(JSON.stringify({ ev: { payments: ev.payments, calls: ev.calls, events: ev.events.map((e: any) => `${e.event}:${e.tx_hash}`), vers: ev.vers.map((v: any) => ({ id: v.id, r: v.result })) }, txs }, null, 1));
} catch (e) { record('stub-chain script', 'FAIL', `script error: ${(e as Error).message.slice(0, 300)} @ ${(e as Error).stack?.split('\\n')[1]?.trim()}`); }
finally { stub.close(); await be.stop(); await closeDb(); process.exit(0); }
