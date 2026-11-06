// Shared helpers for the QA e2e scripts. Never prints secrets. All test data is tagged "[qa]".
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createPublicClient, createWalletClient, defineChain, http, type Hex, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import pg from 'pg';
import { readFileSync } from 'node:fs';

export const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
export const API = process.env.API_URL ?? 'http://localhost:4010';
export const MIRROR = 'https://testnet.mirrornode.hedera.com';
export const RPC = process.env.QA_RPC ?? 'https://testnet.hashio.io/api';
export const escrowAbi = JSON.parse(readFileSync(`${ROOT}/contracts/abi/JobEscrow.json`, 'utf8'));
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hederaTestnet = defineChain({ id: 296, name: 'Hedera Testnet', nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
export const publicClient = createPublicClient({ chain: hederaTestnet, transport: http(RPC, { timeout: 60_000 }) });
export const wallet = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain: hederaTestnet, transport: http(RPC, { timeout: 60_000 }) });
export const toWei = (tinybar: bigint) => tinybar * 10_000_000_000n;

// ---------- results ----------
mkdirSync(`${ROOT}/e2e/.state`, { recursive: true });
export function record(test: string, verdict: 'PASS' | 'FAIL' | 'PARTIAL' | 'NOT RUN', evidence: string, tx: string[] = []) {
  console.log(`\n[${verdict}] ${test}\n   ${evidence}${tx.length ? `\n   tx: ${tx.join(' ')}` : ''}`);
  appendFileSync(`${ROOT}/e2e/.state/results.jsonl`, JSON.stringify({ at: new Date().toISOString(), test, verdict, evidence, tx }) + '\n');
}
export const log = (s: string) => console.log(`-- ${s}`);

// ---------- http ----------
export async function http2(method: string, path: string, o: { token?: string; agentKey?: string; body?: unknown; base?: string } = {}) {
  const res = await fetch((o.base ?? API) + path, {
    method,
    headers: { 'content-type': 'application/json', ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.agentKey ? { 'x-agent-key': o.agentKey } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json: json as any };
}
export async function ok(method: string, path: string, o: Parameters<typeof http2>[2] = {}) {
  const r = await http2(method, path, o);
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}
export async function waitFor<T>(label: string, fn: () => Promise<T | null | false | undefined>, tries = 60, ms = 3000): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); }
  throw new Error(`Timed out waiting for ${label}`);
}

// ---------- db ----------
let _db: pg.Client | null = null;
export async function db() {
  if (!_db) { _db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await _db.connect(); }
  return _db;
}
export async function q(sql: string, params: unknown[] = []) { return (await (await db()).query(sql, params)).rows as any[]; }
export async function closeDb() { if (_db) { await _db.end(); _db = null; } }

// ---------- accounts ----------
export async function login(tag = '[qa]') {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const { nonce, message } = await ok('POST', '/auth/nonce', { body: { address: account.address } });
  const signature = await account.signMessage({ message });
  const v = await ok('POST', '/auth/verify', { body: { address: account.address, nonce, signature } });
  await q('update users set display_name=$1 where id=$2', [tag, v.user.id]);
  return { account, key, token: v.token as string, userId: v.user.id as string };
}

/** Create an agent through the API, then (test setup only) mark it listed and set its endpoint in SQL. Benchmark gate BYPASSED. */
export async function makeListedAgent(token: string, name: string, priceTinybar: bigint, endpointUrl: string | null, caps: string[], payout?: Address) {
  const { agent, apiKey } = await ok('POST', '/agents', { token, body: { name: `[qa] ${name}`, description: '[qa] test agent', capabilities: caps, priceTinybar: priceTinybar.toString(), ...(payout ? { payoutAddress: payout } : {}) } });
  await q("update agents set status='listed', endpoint_url=$1 where id=$2", [endpointUrl, agent.id]);
  return { agent, apiKey: apiKey as string };
}

export async function fundWalletFromRelayer(to: Address, tinybar: bigint) {
  const relayer = wallet(process.env.RELAYER_PRIVATE_KEY as Hex);
  let hash: Hex | undefined, lastErr: unknown;
  for (let i = 0; i < 5 && !hash; i++) {
    try {
      const h = await relayer.sendTransaction({ to, value: toWei(tinybar), type: 'legacy', gasPrice: await publicClient.getGasPrice(), gas: 1_500_000n } as never);
      const r = await publicClient.waitForTransactionReceipt({ hash: h, timeout: 90_000 });
      if (r.status !== 'success') throw new Error(`funding failed ${h}`);
      hash = h;
    } catch (e) { lastErr = e; console.log(`-- relayer funding attempt ${i + 1} failed: ${(e as Error).message.slice(0, 80).replace(/\n/g, ' ')}`); await sleep(10000); }
  }
  if (!hash) throw lastErr;
  await waitFor('account visible', async () => { try { await publicClient.getTransactionCount({ address: to }); return true; } catch { return null; } }, 30, 2000);
  return hash;
}
export async function fundEscrow(clientKey: Hex, escrow: Address, priceTinybar: bigint) {
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    // Retry only while the escrow is still Created (state 0): fund() on a funded escrow reverts, so no double spend is possible.
    const st = Number(await publicClient.readContract({ address: escrow, abi: escrowAbi, functionName: 'state' } as never));
    if (st !== 0) {
      if (st === 1 && lastErr) { // an earlier attempt timed out client-side but landed: recover its hash from the mirror node
        for (let k = 0; k < 10; k++) { const lg = await mirrorLogs(escrow); if (lg.length) { console.log('-- earlier fund attempt had landed; hash from mirror node'); return lg[0].transaction_hash as Hex; } await sleep(3000); }
      }
      throw new Error(`escrow state ${st}, refusing to resend (earlier attempt error: ${(lastErr as Error)?.message?.slice(0, 80)})`);
    }
    try {
      const hash = await wallet(clientKey).writeContract({ address: escrow, abi: escrowAbi, functionName: 'fund', value: toWei(priceTinybar), gas: 200_000n, type: 'legacy', gasPrice: await publicClient.getGasPrice() } as never);
      const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (r.status !== 'success') throw new Error(`fund reverted ${hash}`);
      return hash;
    } catch (e) { lastErr = e; console.log(`-- fund attempt ${i + 1} failed: ${(e as Error).message.slice(0, 100)}`); await sleep(8000); }
  }
  throw lastErr;
}

// ---------- mirror node ----------
export async function mirrorTx(hash: string) {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${MIRROR}/api/v1/contracts/results/${hash}`);
    if (r.ok) { const j: any = await r.json(); return { result: j.result as string, from: j.from, to: j.to, amount: j.amount, timestamp: j.timestamp }; }
    await sleep(3000);
  }
  return null;
}
export async function mirrorBalanceTinybar(addr: string): Promise<bigint> {
  const r = await fetch(`${MIRROR}/api/v1/accounts/${addr}`);
  if (!r.ok) return 0n;
  return BigInt(((await r.json()) as any).balance.balance);
}
export async function mirrorLogs(escrow: string) {
  const r = await fetch(`${MIRROR}/api/v1/contracts/${escrow}/results/logs?order=asc&limit=100`);
  return ((await r.json()) as any).logs as { transaction_hash: string; topics: string[]; data: string }[];
}

// ---------- processes ----------
export type Proc = { child: ChildProcess; stop: () => Promise<void>; out: () => string };
export function startProc(cmdArgs: string[], cwd: string, env: Record<string, string>, readyUrl: string): Promise<Proc> {
  const child = spawn(process.execPath, cmdArgs, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  child.stdout?.on('data', (d) => { buf += d; if (buf.length > 200_000) buf = buf.slice(-100_000); });
  child.stderr?.on('data', (d) => { buf += d; if (buf.length > 200_000) buf = buf.slice(-100_000); });
  const p: Proc = { child, out: () => buf, stop: async () => { child.kill('SIGTERM'); await sleep(800); if (child.exitCode === null) child.kill('SIGKILL'); } };
  return waitFor(`ready ${readyUrl}`, async () => { try { return (await fetch(readyUrl)).ok ? p : null; } catch { return null; } }, 40, 750);
}
const TSX = `${ROOT}/backend/node_modules/tsx/dist/cli.mjs`;
export const startBackend = (env: Record<string, string> = {}, port = 4010) =>
  startProc([TSX, 'src/server.ts'], `${ROOT}/backend`, { PORT: String(port), ALLOW_LOCAL_AGENTS: 'true', ...(process.env.QA_RPC ? { HEDERA_RPC_URL: process.env.QA_RPC } : {}), ...env }, `http://localhost:${port}/health`);
export const startAgent = (dir: 'solidity-builder' | 'static-auditor', port: number, env: Record<string, string>) =>
  startProc([TSX, 'src/index.ts'], `${ROOT}/demo-agents/${dir}`, { PORT: String(port), ...env }, `http://localhost:${port}/health`);

/** Insert request+quote+agreement rows directly (no chain). For auth/negative tests only. */
export async function sqlAgreement(clientUserId: string, agentId: string, status: string, priceTinybar = '100000000', escrow: string | null = null) {
  const [r] = await q("insert into requests (client_user_id,title,requirements,budget_tinybar) values ($1,'[qa] sql request','[qa] requirements text here',$2) returning id", [clientUserId, priceTinybar]);
  const [qt] = await q('insert into quotes (request_id,agent_id,price_tinybar) values ($1,$2,$3) returning id', [r.id, agentId, priceTinybar]);
  const [a] = await q('insert into agreements (request_id,quote_id,client_user_id,agent_id,price_tinybar,status,escrow_address) values ($1,$2,$3,$4,$5,$6,$7) returning id', [r.id, qt.id, clientUserId, agentId, priceTinybar, status, escrow]);
  return { requestId: r.id as string, quoteId: qt.id as string, agreementId: a.id as string };
}

/** Gather DB + mirror evidence for one agreement. */
export async function evidence(agreementId: string) {
  const a = (await q('select * from agreements where id=$1', [agreementId]))[0];
  const payments = await q('select id,kind,amount_tinybar,tx_hash,status from payments where agreement_id=$1 order by created_at', [agreementId]);
  const calls = await q('select id,status,price_tinybar,blocked_reason,depth from a2a_calls where agreement_id=$1 order by created_at', [agreementId]);
  const subs = await q('select id,deliverable_hash,kind,length(content) as len from submissions where agreement_id=$1 order by submitted_at', [agreementId]);
  const vers = await q('select id,result,error,summary from verifications where agreement_id=$1 order by created_at', [agreementId]);
  const verdict = (await q('select id,result,settle_tx_hash,settle_error from verdicts where agreement_id=$1', [agreementId]))[0];
  const events = a?.escrow_address ? await q('select event,tx_hash,log_index,args from chain_events where contract=$1 order by consensus_ts', [a.escrow_address]) : [];
  return { a, payments, calls, subs, vers, verdict, events };
}
export async function checkTxs(hashes: string[]) {
  const out: string[] = [];
  for (const h of [...new Set(hashes.filter(Boolean))]) { const m = await mirrorTx(h); out.push(`${h}=${m?.result ?? 'NOT_FOUND'}`); }
  return out;
}

import { createServer } from 'node:http';
export function startStubCallee(port: number) {
  const s = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ review: 'qa stub auditor: no issues', callId: JSON.parse(b || '{}').callId })); }); });
  return new Promise<{ close: () => void }>((r) => s.listen(port, () => r({ close: () => s.close() })));
}
/** Fresh lister+client, agent (listed via SQL, benchmark gate bypassed), request, quote (posted by agent key), accept, fund, wait for the indexer. */
export async function fundedJob(o: { price: bigint; requirements: string; checks?: string[]; title: string; clientFundTinybar?: bigint }) {
  const lister = await login(); const client = await login();
  const fundWalletTx = await fundWalletFromRelayer(client.account.address, o.clientFundTinybar ?? o.price + 30_000_000n);
  const main = await makeListedAgent(lister.token, `${o.title} main`, o.price, null, ['qa-main']);
  const request = await ok('POST', '/requests', { token: client.token, body: { title: `[qa] ${o.title}`, requirements: o.requirements, checksRequested: o.checks ?? [], budgetTinybar: o.price.toString() } });
  const quote = await ok('POST', `/requests/${request.id}/quotes`, { agentKey: main.apiKey, body: { priceTinybar: o.price.toString(), etaHours: 1 } });
  const ag = await acceptQuote(client.token, quote.id);
  if (!ag.escrowAddress) throw new Error('no escrow: ' + ag.escrowError);
  const fundTx = await fundEscrow(client.key, ag.escrowAddress, o.price);
  await waitFor('indexer funded', async () => (await ok('GET', `/agreements/${ag.id}`)).agreement.status === 'funded', 30, 3000);
  return { lister, client, main, request, quote, agreement: ag, escrow: ag.escrowAddress as Address, fundTx, fundWalletTx };
}
export const escrowState = async (escrow: Address) => Number(await publicClient.readContract({ address: escrow, abi: escrowAbi, functionName: 'state' } as never));

/** accept a quote; if the chain call timed out (Hashio flake) use the documented retry route POST /agreements/:id/escrow, up to 4 times. */
export async function acceptQuote(token: string, quoteId: string) {
  const ag = await ok('POST', `/quotes/${quoteId}/accept`, { token });
  let tries = 0;
  while (!ag.escrowAddress && tries < 4) {
    tries++; console.log(`-- accept gave escrowError "${String(ag.escrowError).slice(0, 70)}"; retry ${tries} via POST /agreements/:id/escrow`);
    await sleep(8000);
    const r = await http2('POST', `/agreements/${ag.id}/escrow`, { token });
    console.log(`-- retry -> ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
    if (r.status === 200) ag.escrowAddress = r.json.escrowAddress;
  }
  ag.retries = tries;
  return ag;
}

export async function waitRpcHealthy() {
  for (let i = 0; i < 60; i++) {
    const t = Date.now(); let good = 0;
    for (let k = 0; k < 3; k++) { try { const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}', signal: AbortSignal.timeout(8000) }); if ((await r.json() as any).result) good++; } catch {} }
    if (good === 3) { console.log(`-- rpc healthy (3x in ${Date.now() - t} ms)`); return; }
    await sleep(10000);
  }
  console.log('-- rpc never became healthy; continuing anyway');
}
