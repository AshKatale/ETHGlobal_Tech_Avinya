// Second-pass integration tests. The chain module is stubbed: no transaction is ever sent from here.
// Rows are tagged [qa] and removed in afterAll.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const chain = vi.hoisted(() => ({
  sent: [] as string[],
  state: 2,
  delay: 0,
  refundInfo: null as null | { state: number; submittedAt: bigint; reviewWindow: bigint; nowSec: bigint },
  createEscrowOnChain: vi.fn(),
}));

vi.mock('./chain/client.js', async () => {
  const actual = await vi.importActual<typeof import('./chain/client.js')>('./chain/client.js');
  return {
    ...actual,
    createEscrowOnChain: async (a: { agreementId: string }) => {
      chain.sent.push(`create:${a.agreementId}`);
      return { escrow: `0x${'ab'.repeat(20)}`, txHash: '0xcreate' };
    },
    readEscrowState: async () => chain.state,
    readRefundTimeoutInfo: async () => chain.refundInfo,
    refundIfNoVerdictOnChain: async () => { chain.sent.push('refund-timeout'); await new Promise((r) => setTimeout(r, chain.delay)); return { hash: `0x${'a1'.repeat(32)}`, receipt: {} }; },
    signVerdict: async () => ({ sig: `0x${'11'.repeat(65)}`, nonce: BigInt(Date.now()) }),
    releaseOnChain: async () => { chain.sent.push('release'); await new Promise((r) => setTimeout(r, chain.delay)); return { hash: `0x${'cd'.repeat(32)}`, receipt: {} }; },
    refundOnChain: async () => { chain.sent.push('refund'); await new Promise((r) => setTimeout(r, chain.delay)); return { hash: `0x${'ef'.repeat(32)}`, receipt: {} }; },
  };
});

import { db, pool, schema } from './db/index.js';
import { Fixtures, HAS_DB } from './test.int.helpers.js';
import { buildServer } from './server.js';

const fx = new Fixtures();
afterAll(async () => { if (HAS_DB) await fx.cleanup(); await pool.end(); });
beforeEach(() => { chain.sent.length = 0; chain.state = 2; chain.delay = 0; chain.refundInfo = null; });

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe.skipIf(!HAS_DB)('S-14 double accept', () => {
  it('10 concurrent accepts of the same quote and of two quotes create exactly one agreement', async () => {
    const app = await buildServer();
    const client = await fx.user();
    const a1 = await fx.agent(client.id);
    const a2 = await fx.agent(client.id);
    const req = await fx.request(client.id);
    const [q1] = await db.insert(schema.quotes).values({ requestId: req.id, agentId: a1.id, priceTinybar: '100' }).returning();
    const [q2] = await db.insert(schema.quotes).values({ requestId: req.id, agentId: a2.id, priceTinybar: '100' }).returning();
    fx.quoteIds.push(q1.id, q2.id);

    const go = (q: string) => app.inject({ method: 'POST', url: `/quotes/${q}/accept`, headers: auth(client.token) });
    const res = await Promise.all([...Array.from({ length: 6 }, () => go(q1.id)), ...Array.from({ length: 4 }, () => go(q2.id))]);
    expect(res.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(res.filter((r) => r.statusCode === 409)).toHaveLength(9);

    const agreements = await db.select().from(schema.agreements).where(eq(schema.agreements.requestId, req.id));
    fx.agreementIds.push(...agreements.map((a) => a.id));
    expect(agreements).toHaveLength(1);
    expect(chain.sent.filter((s) => s.startsWith('create:'))).toHaveLength(1); // one escrow only
    await app.close();
  });
});

describe.skipIf(!HAS_DB)('S-15 deadlines', () => {
  const body = (extra: object) => ({ title: '[qa] deadline', requirements: '[qa] requirements text', budgetTinybar: '1000', ...extra });

  it('rejects a deadline under 15 minutes (400), accepts 20 minutes, defaults to 7 days', async () => {
    const app = await buildServer();
    const u = await fx.user();
    const post = (payload: object) => app.inject({ method: 'POST', url: '/requests', headers: auth(u.token), payload: body(payload) });

    expect((await post({ deadlineAt: new Date(Date.now() - 3600_000).toISOString() })).statusCode).toBe(400);
    const short = await post({ deadlineAt: new Date(Date.now() + 5 * 60_000).toISOString() });
    expect(short.statusCode).toBe(400);
    expect(short.json().error).toMatch(/15 minutes/);

    const ok = await post({ deadlineAt: new Date(Date.now() + 20 * 60_000).toISOString() });
    expect(ok.statusCode).toBe(201);
    fx.requestIds.push(ok.json().id);

    const def = await post({});
    expect(def.statusCode).toBe(201);
    fx.requestIds.push(def.json().id);
    const diff = new Date(def.json().deadlineAt).getTime() - Date.now();
    expect(Math.abs(diff - 7 * 24 * 3600_000)).toBeLessThan(60_000);
    await app.close();
  });
});

describe.skipIf(!HAS_DB)('S-09 data exposure', () => {
  it('anonymous and strangers get metadata only; client, owner and agent key get the content', async () => {
    const app = await buildServer();
    const client = await fx.user();
    const owner = await fx.user();
    const stranger = await fx.user();
    const callee = await fx.agent(owner.id);
    const ag = await fx.agent(owner.id);
    const agreement = await fx.agreement(client.id, ag.id, { status: 'submitted' });
    await db.update(schema.agreements).set({ dispatchError: 'ECONNREFUSED 10.1.2.3' }).where(eq(schema.agreements.id, agreement.id));
    await db.insert(schema.submissions).values({ agreementId: agreement.id, content: 'TOP-SECRET-WORK', deliverableHash: 'abc123' });
    await db.insert(schema.verifications).values({ agreementId: agreement.id, result: 'ERROR', error: 'upstream exploded at 10.9.9.9' });
    await db.insert(schema.verdicts).values({ agreementId: agreement.id, result: 'PASS', verifierSig: '0xsig', nonce: 7n, settleTxHash: '0xsettle', settleError: 'viem raw error' });
    await db.insert(schema.a2aCalls).values({ agreementId: agreement.id, callerAgentId: ag.id, calleeAgentId: callee.id, priceTinybar: '10', status: 'failed', blockedReason: 'callee responded 500: internal-host' });

    const urls = [`/agreements/${agreement.id}`, `/agreements/${agreement.id}/verification`, `/agreements/${agreement.id}/a2a`];
    const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers });
    const leaks = /TOP-SECRET|10\.1\.2\.3|10\.9\.9\.9|viem raw error|internal-host/;

    for (const headers of [{}, auth(stranger.token), { authorization: 'Bearer garbage' }]) {
      for (const url of urls) {
        const res = await get(url, headers);
        expect(res.statusCode).toBe(200);
        expect(res.body, url).not.toMatch(leaks);
      }
    }
    const pub = (await get(urls[0])).json();
    expect(pub.viewerAccess).toBe('public');
    expect(pub.submission).toMatchObject({ deliverableHash: 'abc123', kind: 'text' });
    expect(pub.verdict).toMatchObject({ result: 'PASS', verifierSig: '0xsig', nonce: '7', settleTxHash: '0xsettle' });
    expect((await get(urls[1])).json().verdict.settleTxHash).toBe('0xsettle');

    for (const headers of [auth(client.token), auth(owner.token), { 'x-agent-key': ag.key }]) {
      const full = (await get(urls[0], headers)).json();
      expect(full.viewerAccess).toBe('full');
      expect(full.submission.content).toBe('TOP-SECRET-WORK');
      expect((await get(urls[1], headers)).body).toMatch(/upstream exploded/);
      expect((await get(urls[2], headers)).body).toMatch(/internal-host/);
    }
    // another agent's key is not a participant
    expect((await get(urls[0], { 'x-agent-key': callee.key })).json().viewerAccess).toBe('public');
    await app.close();
  });
});

describe.skipIf(!HAS_DB)('S-21 stuck verification recovery', () => {
  it('resets old verifying rows to submitted with an ERROR row, once, never FAIL; leaves fresh and settled ones', async () => {
    const { recoverStuckVerifying, STUCK_MESSAGE } = await import('./lib/recovery.js');
    const u = await fx.user();
    const ag = await fx.agent(u.id);
    const stuck = await fx.agreement(u.id, ag.id, { status: 'verifying' });
    const fresh = await fx.agreement(u.id, ag.id, { status: 'verifying' });
    const settling = await fx.agreement(u.id, ag.id, { status: 'verifying' });
    const legacy = await fx.agreement(u.id, ag.id, { status: 'verifying' }); // no verifying_since: falls back to the submission time
    const set = (id: string, mins: number) => db.update(schema.agreements).set({ verifyingSince: new Date(Date.now() - mins * 60_000) }).where(eq(schema.agreements.id, id));
    await set(stuck.id, 11); await set(fresh.id, 3); await set(settling.id, 30);
    await db.insert(schema.verdicts).values({ agreementId: settling.id, result: 'PASS' });
    await db.insert(schema.submissions).values({ agreementId: legacy.id, content: 'x', deliverableHash: 'h', submittedAt: new Date(Date.now() - 20 * 60_000) });

    const first = await recoverStuckVerifying();
    expect(first).toContain(stuck.id);
    expect(first).toContain(legacy.id);
    expect(first).not.toContain(fresh.id);
    expect(first).not.toContain(settling.id);
    expect(await recoverStuckVerifying()).not.toContain(stuck.id); // idempotent

    const row = async (id: string) => (await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)))[0];
    expect((await row(stuck.id)).status).toBe('submitted');
    expect((await row(fresh.id)).status).toBe('verifying');
    expect((await row(settling.id)).status).toBe('verifying');
    const runs = await db.select().from(schema.verifications).where(eq(schema.verifications.agreementId, stuck.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ result: 'ERROR', error: STUCK_MESSAGE });
    expect(runs.some((r) => r.result === 'FAIL')).toBe(false);
  });
});

describe.skipIf(!HAS_DB)('S-06 single-flight settle', () => {
  it('two and eight concurrent settles send one transaction; the others return the current state', async () => {
    const app = await buildServer();
    const client = await fx.user();
    const ag = await fx.agent(client.id);
    const agreement = await fx.agreement(client.id, ag.id, { status: 'verifying' });
    await db.update(schema.agreements).set({ escrowAddress: `0x${'cd'.repeat(20)}` }).where(eq(schema.agreements.id, agreement.id));
    await db.insert(schema.verdicts).values({ agreementId: agreement.id, result: 'PASS' });
    chain.delay = 3000; // keep the first settle in flight while the others arrive

    const go = () => app.inject({ method: 'POST', url: `/agreements/${agreement.id}/settle`, headers: auth(client.token) });
    const res = await Promise.all(Array.from({ length: 8 }, go));
    expect(res.every((r) => r.statusCode === 200)).toBe(true);
    expect(chain.sent.filter((s) => s === 'release')).toHaveLength(1);
    const bodies = res.map((r) => r.json());
    expect(bodies.filter((b) => b.txHash && !b.already)).toHaveLength(1);
    expect(bodies.filter((b) => b.inProgress === true)).toHaveLength(7);
    await app.close();
  });
});

describe.skipIf(!HAS_DB)('A2A only while funded', () => {
  it('quote and reserve are refused once the agreement is submitted', async () => {
    const { reserveA2aCall } = await import('./lib/a2aReserve.js');
    const app = await buildServer();
    const u = await fx.user();
    const caller = await fx.agent(u.id);
    const callee = await fx.agent(u.id, { status: 'listed', priceTinybar: '100' });
    const agreement = await fx.agreement(u.id, caller.id, { price: '1000', status: 'submitted' });

    const q = await app.inject({ method: 'POST', url: '/a2a/quote', headers: { 'x-agent-key': caller.key }, payload: { agreementId: agreement.id, calleeAgentId: callee.id } });
    expect(q.statusCode).toBe(400);
    expect(q.json().error).toMatch(/must be funded/);

    const [c] = await db.insert(schema.a2aCalls).values({ agreementId: agreement.id, callerAgentId: caller.id, calleeAgentId: callee.id, priceTinybar: '100', status: 'quoted' }).returning();
    expect(await reserveA2aCall(c.id, caller.id, 30)).toMatchObject({ ok: false, code: 409 });

    const funded = await fx.agreement(u.id, caller.id, { price: '1000', status: 'funded' });
    const ok = await app.inject({ method: 'POST', url: '/a2a/quote', headers: { 'x-agent-key': caller.key }, payload: { agreementId: funded.id, calleeAgentId: callee.id } });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });
});

describe.skipIf(!HAS_DB)('signature audit log', () => {
  it('signVerdict and signDelegation write one audit row each (sha256 of the signature only) and GET /audit serves them', async () => {
    const actual = await vi.importActual<typeof import('./chain/client.js')>('./chain/client.js');
    const { sigSha256 } = await import('./lib/signatureAudit.js');
    const { createHash } = await import('node:crypto');
    const app = await buildServer();
    const u = await fx.user();
    const ag = await fx.agent(u.id);
    const agreement = await fx.agreement(u.id, ag.id, { status: 'submitted' });
    const escrow = `0x${'ab'.repeat(20)}` as `0x${string}`;
    await db.insert(schema.submissions).values({ agreementId: agreement.id, content: 'work', deliverableHash: 'deadbeef' });
    await db.insert(schema.verifications).values({ agreementId: agreement.id, result: 'PASS', reportRoot: '0xroot' });

    let signed = true;
    let v: Awaited<ReturnType<typeof actual.signVerdict>> | undefined;
    let d: Awaited<ReturnType<typeof actual.signDelegation>> | undefined;
    try {
      v = await actual.signVerdict(escrow, agreement.id, true);
      d = await actual.signDelegation(escrow, agreement.id, `0x${'22'.repeat(20)}`, 250n);
    } catch (e) { if (/VERIFIER_PRIVATE_KEY/.test((e as Error).message)) signed = false; else throw e; }
    if (!signed || !v || !d) return; // no verifier key in this environment: local signing cannot run

    await db.insert(schema.verdicts).values({ agreementId: agreement.id, result: 'PASS', verifierSig: v.sig, nonce: v.nonce, settleTxHash: '0xsettle' });
    const res = await app.inject({ method: 'GET', url: `/agreements/${agreement.id}/audit` }); // public: no auth
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries.map((e: { kind: string }) => e.kind)).toEqual(['verdict', 'delegation']);
    expect(body.entries[0]).toMatchObject({ resultOrAmount: 'PASS', escrowAddress: escrow, sigSha256: sigSha256(v.sig), nonce: v.nonce.toString() });
    expect(body.entries[0].sigSha256).toBe(createHash('sha256').update(v.sig).digest('hex'));
    expect(body.entries[1]).toMatchObject({ resultOrAmount: '250', sigSha256: sigSha256(d.sig) });
    expect(res.body).not.toContain(d.sig); // delegation signature itself is not stored or served
    expect(body).toMatchObject({ settleTxHash: '0xsettle', reportRoot: '0xroot', deliverableHash: 'deadbeef', verdict: { result: 'PASS', settleTxHash: '0xsettle' } });
    expect((await app.inject({ method: 'GET', url: `/agreements/00000000-0000-4000-8000-000000000000/audit` })).statusCode).toBe(404);
    await app.close();
  });
});

describe.skipIf(!HAS_DB)('UI field additions', () => {
  it('latestScore, quote agent names, a2a names and txHash, timestamps, /config', async () => {
    const app = await buildServer();
    const u = await fx.user();
    const caller = await fx.agent(u.id, { status: 'listed' });
    const callee = await fx.agent(u.id, { status: 'listed' });
    const [bench] = await db.insert(schema.benchmarkRuns).values({ agentId: caller.id, repoUrl: 'https://github.com/x/y', status: 'passed', score: '91.50' }).returning();
    await db.update(schema.agents).set({ latestBenchmarkId: bench.id }).where(eq(schema.agents.id, caller.id));

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json() as { id: string; latestScore: string | null }[];
    expect(list.find((a) => a.id === caller.id)?.latestScore).toBe('91.50');
    expect(list.find((a) => a.id === callee.id)?.latestScore).toBeNull();
    expect((await app.inject({ method: 'GET', url: `/agents/${caller.id}` })).json().agent.latestScore).toBe('91.50');

    const agreement = await fx.agreement(u.id, caller.id, { price: '1000', status: 'funded' });
    const r = (await app.inject({ method: 'GET', url: `/requests/${agreement.requestId}` })).json();
    expect(r.quotes[0]).toMatchObject({ agentName: caller.name, latestScore: '91.50' });

    await db.insert(schema.a2aCalls).values({ agreementId: agreement.id, callerAgentId: caller.id, calleeAgentId: callee.id, priceTinybar: '200', status: 'done' });
    await db.insert(schema.payments).values({ agreementId: agreement.id, kind: 'a2a', amountTinybar: '200', txHash: '0xqa-a2a-tx', status: 'confirmed' });
    await db.insert(schema.submissions).values({ agreementId: agreement.id, content: 'w', deliverableHash: 'h' });
    await db.insert(schema.payments).values({ agreementId: agreement.id, kind: 'release', amountTinybar: '800', txHash: '0xrel', status: 'confirmed' });
    const calls = (await app.inject({ method: 'GET', url: `/agreements/${agreement.id}/a2a` })).json();
    expect(calls[0]).toMatchObject({ callerName: caller.name, calleeName: callee.name, txHash: '0xqa-a2a-tx' });

    const ag = (await app.inject({ method: 'GET', url: `/agreements/${agreement.id}` })).json();
    expect(ag.a2aMaxPercent).toBe(30);
    expect(ag.timestamps.submittedAt).toBeTruthy();
    expect(ag.timestamps.settledAt).toBeTruthy();
    expect(ag.timestamps).toHaveProperty('fundedAt');

    const cfg = (await app.inject({ method: 'GET', url: '/config' })).json();
    expect(cfg).toMatchObject({ a2aMaxPercent: 30, minDeadlineMinutes: 15, defaultDeadlineDays: 7 });

    const mine = (await app.inject({ method: 'GET', url: '/requests?mine=true', headers: auth(u.token) })).json() as { clientUserId: string }[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((x) => x.clientUserId === u.id)).toBe(true);
    await app.close();
  });
});

describe.skipIf(!HAS_DB)('refund-timeout route (stubbed chain; NOT tested against a real V2 escrow)', () => {
  it('auth, V1 501, too early 409 with remaining seconds, wrong state 409, eligible sends exactly one tx', async () => {
    const app = await buildServer();
    const client = await fx.user();
    const owner = await fx.user();
    const stranger = await fx.user();
    const ag = await fx.agent(owner.id);
    const agreement = await fx.agreement(client.id, ag.id, { status: 'submitted' });
    await db.update(schema.agreements).set({ escrowAddress: `0x${'ee'.repeat(20)}` }).where(eq(schema.agreements.id, agreement.id));
    const go = (token?: string) => app.inject({ method: 'POST', url: `/agreements/${agreement.id}/refund-timeout`, headers: token ? auth(token) : {} });
    const now = BigInt(Math.floor(Date.now() / 1000));

    expect((await go()).statusCode).toBe(401);
    expect((await go(stranger.token)).statusCode).toBe(403);

    chain.refundInfo = null; // V1 escrow
    expect((await go(client.token)).statusCode).toBe(501);

    chain.refundInfo = { state: 2, submittedAt: now - 100n, reviewWindow: 3600n, nowSec: now };
    const early = await go(client.token);
    expect(early.statusCode).toBe(409);
    expect(early.json().remainingSeconds).toBe(3501);

    chain.refundInfo = { state: 1, submittedAt: 0n, reviewWindow: 3600n, nowSec: now };
    expect((await go(owner.token)).statusCode).toBe(409);
    expect(chain.sent).toHaveLength(0);

    chain.refundInfo = { state: 2, submittedAt: now - 7200n, reviewWindow: 3600n, nowSec: now };
    chain.delay = 5000; // DB round trips to Neon are slow; keep the first call in flight until the others have arrived
    const res = await Promise.all([go(client.token), go(owner.token), go(client.token)]);
    expect(chain.sent.filter((x) => x === 'refund-timeout')).toHaveLength(1);
    expect(res.filter((r) => r.json().txHash)).toHaveLength(1);
    await app.close();
  });
});

describe.skipIf(!HAS_DB)('S-19 / S-20 low items', () => {
  it('agent registration refuses non-http URLs and the zero payout address', async () => {
    const app = await buildServer();
    const u = await fx.user();
    const base = { name: '[qa] bad', description: '[qa]', capabilities: ['qa'], priceTinybar: '1' };
    const post = (extra: object) => app.inject({ method: 'POST', url: '/agents', headers: auth(u.token), payload: { ...base, ...extra } });
    expect((await post({ repoUrl: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect((await post({ endpointUrl: 'ftp://example.com' })).statusCode).toBe(400);
    expect((await post({ payoutAddress: '0x0000000000000000000000000000000000000000' })).statusCode).toBe(400);
    const ok = await post({ endpointUrl: 'https://agent.example', repoUrl: 'https://github.com/a/b' });
    expect(ok.statusCode).toBe(201);
    fx.agentIds.push(ok.json().agent.id);
    await app.close();
  });

  it('two parallel /auth/verify with one nonce create one session', async () => {
    const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
    const { loginMessage } = await import('./lib/auth.js');
    const app = await buildServer();
    const account = privateKeyToAccount(generatePrivateKey());
    const n = (await app.inject({ method: 'POST', url: '/auth/nonce', payload: { address: account.address } })).json();
    const signature = await account.signMessage({ message: loginMessage(account.address, n.nonce) });
    const go = () => app.inject({ method: 'POST', url: '/auth/verify', payload: { address: account.address, nonce: n.nonce, signature } });
    const res = await Promise.all([go(), go(), go()]);
    expect(res.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(res.filter((r) => r.statusCode === 400)).toHaveLength(2);
    const token = res.find((r) => r.statusCode === 200)!.json();
    // tidy: this user was created by the login flow, not by Fixtures
    await db.delete(schema.sessions).where(eq(schema.sessions.id, token.token));
    await db.delete(schema.users).where(eq(schema.users.id, token.user.id));
    await app.close();
  });
});
