// Second-pass integration tests. The chain module is stubbed: no transaction is ever sent from here.
// Rows are tagged [qa] and removed in afterAll.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const chain = vi.hoisted(() => ({
  sent: [] as string[],
  state: 2,
  delay: 0,
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
beforeEach(() => { chain.sent.length = 0; chain.state = 2; chain.delay = 0; });

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
