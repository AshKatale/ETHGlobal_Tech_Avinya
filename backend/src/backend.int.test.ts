// Integration tests against the shared Neon DB (skipped without backend/.env). Rows are tagged [qa] and removed in afterAll.
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool, schema } from './db/index.js';
import { Fixtures, HAS_DB } from './test.int.helpers.js';
import { dispatchAgreement, solicitQuotes, type Fetcher } from './lib/agentClient.js';
import { reserveA2aCall } from './lib/a2aReserve.js';
import { latestSubmission } from './lib/submissions.js';
import { applyDelegated } from './chain/indexer.js';
import { buildServer } from './server.js';

const fx = new Fixtures();
afterAll(async () => { if (HAS_DB) await fx.cleanup(); await pool.end(); });

const ok = (status = 202, text = '{"accepted":true}') => ({ status, ok: status >= 200 && status < 300, text });
const agreementRow = async (id: string) => (await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)))[0];

describe.skipIf(!HAS_DB)('agent dispatch', () => {
  it('calls POST /tasks once for a funded agreement and sets dispatched_at', async () => {
    const u = await fx.user();
    const ag = await fx.agent(u.id, { endpointUrl: 'http://qa-agent.example' });
    const agreement = await fx.agreement(u.id, ag.id);
    const calls: { url: string; body: string }[] = [];
    const fetcher: Fetcher = async (url, init) => { calls.push({ url, body: init.body }); return ok(); };

    expect(await dispatchAgreement(agreement.id, { fetcher })).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://qa-agent.example/tasks');
    expect(JSON.parse(calls[0].body)).toEqual({ agreementId: agreement.id, requirements: '[qa] requirements text' });
    expect((await agreementRow(agreement.id)).dispatchedAt).not.toBeNull();

    expect(await dispatchAgreement(agreement.id, { fetcher })).toEqual({ skipped: 'already dispatched' });
    expect(calls).toHaveLength(1);
  });

  it('concurrent dispatches call the agent once', async () => {
    const u = await fx.user();
    const ag = await fx.agent(u.id, { endpointUrl: 'http://qa-agent.example' });
    const agreement = await fx.agreement(u.id, ag.id);
    let n = 0;
    const fetcher: Fetcher = async () => { n++; await new Promise((r) => setTimeout(r, 50)); return ok(); };
    await Promise.all([dispatchAgreement(agreement.id, { fetcher }), dispatchAgreement(agreement.id, { fetcher })]);
    expect(n).toBe(1);
  });

  it('stores a failure, never throws, and a later retry succeeds', async () => {
    const u = await fx.user();
    const ag = await fx.agent(u.id, { endpointUrl: 'http://qa-agent.example' });
    const agreement = await fx.agreement(u.id, ag.id);
    let n = 0;
    const down: Fetcher = async () => { n++; throw new Error('ECONNREFUSED'); };
    expect(await dispatchAgreement(agreement.id, { fetcher: down, backoffMs: [1, 1, 1] })).toMatchObject({ ok: false });
    expect(n).toBe(4);
    let row = await agreementRow(agreement.id);
    expect(row.dispatchedAt).toBeNull();
    expect(row.dispatchError).toContain('ECONNREFUSED');

    expect(await dispatchAgreement(agreement.id, { fetcher: async () => ok() })).toEqual({ ok: true });
    row = await agreementRow(agreement.id);
    expect(row.dispatchedAt).not.toBeNull();
    expect(row.dispatchError).toBeNull();
  });

  it('does not retry a 4xx, and skips agreements that are not funded', async () => {
    const u = await fx.user();
    const ag = await fx.agent(u.id, { endpointUrl: 'http://qa-agent.example' });
    const agreement = await fx.agreement(u.id, ag.id);
    let n = 0;
    expect(await dispatchAgreement(agreement.id, { fetcher: async () => { n++; return ok(400, 'bad'); }, backoffMs: [1, 1, 1] })).toMatchObject({ ok: false });
    expect(n).toBe(1);
    const agreed = await fx.agreement(u.id, ag.id, { status: 'agreed' });
    expect(await dispatchAgreement(agreed.id, { fetcher: async () => ok() })).toEqual({ skipped: 'status is agreed' });
  });

  it('the SSRF guard refuses a loopback endpoint with the real fetcher (stored as an error)', async () => {
    const u = await fx.user();
    const ag = await fx.agent(u.id, { endpointUrl: 'http://127.0.0.1:4101' });
    const agreement = await fx.agreement(u.id, ag.id);
    expect(await dispatchAgreement(agreement.id)).toMatchObject({ ok: false });
    expect((await agreementRow(agreement.id)).dispatchError).toMatch(/Blocked address/);
  });
});

describe.skipIf(!HAS_DB)('quote solicitation', () => {
  it('stores valid quotes, ignores failing or invalid agents', async () => {
    const u = await fx.user();
    const good = await fx.agent(u.id, { endpointUrl: 'http://good.example', status: 'listed' });
    await fx.agent(u.id, { endpointUrl: 'http://bad.example', status: 'listed' });
    await fx.agent(u.id, { endpointUrl: 'http://junk.example', status: 'listed' });
    await fx.agent(u.id, { status: 'listed' });
    const request = await fx.request(u.id, { budget: '500', requirements: '[qa] need a thing done' });

    const fetcher: Fetcher = async (url) => {
      if (url.startsWith('http://good.example')) return ok(200, '{"priceTinybar":"250","etaHours":4}');
      if (url.startsWith('http://junk.example')) return ok(200, '{"priceTinybar":"1.5"}');
      throw new Error('ECONNREFUSED');
    };
    await solicitQuotes(request.id, fetcher);
    const quotes = await db.select().from(schema.quotes).where(eq(schema.quotes.requestId, request.id));
    expect(quotes.map((q) => q.agentId)).toEqual([good.id]);
    expect(quotes[0].priceTinybar).toBe('250');
    expect(quotes[0].etaHours).toBe(4);
    await solicitQuotes(request.id, fetcher); // idempotent
    expect(await db.select().from(schema.quotes).where(eq(schema.quotes.requestId, request.id))).toHaveLength(1);
  });
});

describe.skipIf(!HAS_DB)('A2A reservation race', () => {
  it('two simultaneous calls cannot overspend the 30% cap', async () => {
    const u = await fx.user();
    const caller = await fx.agent(u.id);
    const callee = await fx.agent(u.id, { priceTinybar: '200' });
    const agreement = await fx.agreement(u.id, caller.id, { price: '1000' }); // cap 300, each call 200
    const mk = async () => (await db.insert(schema.a2aCalls).values({
      agreementId: agreement.id, callerAgentId: caller.id, calleeAgentId: callee.id, priceTinybar: '200', status: 'quoted',
    }).returning())[0];
    const [c1, c2] = [await mk(), await mk()];

    const results = await Promise.all([reserveA2aCall(c1.id, caller.id, 30), reserveA2aCall(c2.id, caller.id, 30)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, code: 403, error: 'Budget exceeded' });
    const rows = await db.select().from(schema.a2aCalls).where(eq(schema.a2aCalls.agreementId, agreement.id));
    expect(rows.filter((r) => r.status === 'paid')).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'blocked')).toHaveLength(1);

    const paid = rows.find((r) => r.status === 'paid')!;
    expect(await reserveA2aCall(paid.id, caller.id, 30)).toMatchObject({ ok: false, code: 409 });
  });

  it('6 parallel calls (each 100, cap 300) pay exactly 3', async () => {
    const u = await fx.user();
    const caller = await fx.agent(u.id);
    const callee = await fx.agent(u.id);
    const agreement = await fx.agreement(u.id, caller.id, { price: '1000' });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const [c] = await db.insert(schema.a2aCalls).values({ agreementId: agreement.id, callerAgentId: caller.id, calleeAgentId: callee.id, priceTinybar: '100', status: 'quoted' }).returning();
      ids.push(c.id);
    }
    const results = await Promise.all(ids.map((id) => reserveA2aCall(id, caller.id, 30)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
  });
});

describe.skipIf(!HAS_DB)('A2A single-use call id', () => {
  it('10 concurrent reservations on one callId pay once; a paid row keeps counting', async () => {
    const u = await fx.user();
    const caller = await fx.agent(u.id);
    const callee = await fx.agent(u.id);
    const agreement = await fx.agreement(u.id, caller.id, { price: '1000' });
    const [c] = await db.insert(schema.a2aCalls).values({ agreementId: agreement.id, callerAgentId: caller.id, calleeAgentId: callee.id, priceTinybar: '200', status: 'quoted' }).returning();
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveA2aCall(c.id, caller.id, 30)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === 409)).toHaveLength(9);

    // S-01: the callee failing afterwards leaves the row 'paid'; a new 200 call then no longer fits under the 300 cap
    const [c2] = await db.insert(schema.a2aCalls).values({ agreementId: agreement.id, callerAgentId: caller.id, calleeAgentId: callee.id, priceTinybar: '200', status: 'quoted' }).returning();
    expect(await reserveA2aCall(c2.id, caller.id, 30)).toMatchObject({ ok: false, code: 403 });
  });
});

describe.skipIf(!HAS_DB)('submit, settle and latest submission', () => {
  it('submit requires status exactly funded', async () => {
    const app = await buildServer();
    const u = await fx.user();
    const ag = await fx.agent(u.id);
    for (const status of ['verifying', 'submitted', 'agreed', 'released']) {
      const agreement = await fx.agreement(u.id, ag.id, { status });
      const res = await app.inject({ method: 'POST', url: `/agreements/${agreement.id}/submit`, headers: { 'x-agent-key': ag.key }, payload: { content: 'work' } });
      expect(res.statusCode, status).toBe(409);
    }
    await app.close();
  });

  it('two racing submits on a funded agreement: one 202, one 409, one row', async () => {
    const app = await buildServer();
    const u = await fx.user();
    const ag = await fx.agent(u.id);
    const agreement = await fx.agreement(u.id, ag.id);
    const go = () => app.inject({ method: 'POST', url: `/agreements/${agreement.id}/submit`, headers: { 'x-agent-key': ag.key }, payload: { content: 'work' } });
    const [a, b] = await Promise.all([go(), go()]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([202, 409]);
    expect(await db.select().from(schema.submissions).where(eq(schema.submissions.agreementId, agreement.id))).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 2000)); // let the background verification finish before cleanup
    await app.close();
  });

  it('latestSubmission and GET /agreements/:id return the newest submission', async () => {
    const u = await fx.user();
    const ag = await fx.agent(u.id);
    const agreement = await fx.agreement(u.id, ag.id);
    await db.insert(schema.submissions).values({ agreementId: agreement.id, content: 'old', deliverableHash: 'a', submittedAt: new Date(Date.now() - 60_000) });
    await db.insert(schema.submissions).values({ agreementId: agreement.id, content: 'new', deliverableHash: 'b', submittedAt: new Date() });
    await db.insert(schema.submissions).values({ agreementId: agreement.id, content: 'older', deliverableHash: 'c', submittedAt: new Date(Date.now() - 120_000) });
    expect((await latestSubmission(agreement.id))?.content).toBe('new');
    const app = await buildServer();
    // submission content is visible to the client only (S-09), so read it with the client session
    const res = await app.inject({ method: 'GET', url: `/agreements/${agreement.id}`, headers: { authorization: `Bearer ${u.token}` } });
    expect(res.json().submission.content).toBe('new');
    await app.close();
  });

  it('settle: stranger 403, client and agent owner pass auth, anonymous 401', async () => {
    const app = await buildServer();
    const client = await fx.user();
    const owner = await fx.user();
    const stranger = await fx.user();
    const ag = await fx.agent(owner.id);
    const agreement = await fx.agreement(client.id, ag.id); // no escrow: authorised callers reach settle() and get a chain 502
    const call = (token: string) => app.inject({ method: 'POST', url: `/agreements/${agreement.id}/settle`, headers: { authorization: `Bearer ${token}` } });
    expect((await call(stranger.token)).statusCode).toBe(403);
    expect((await call(client.token)).statusCode).toBe(502);
    expect((await call(owner.token)).statusCode).toBe(502);
    expect((await app.inject({ method: 'POST', url: `/agreements/${agreement.id}/settle` })).statusCode).toBe(401);
    await app.close();
  });
});

describe.skipIf(!HAS_DB)('Delegated indexing', () => {
  it('records one a2a payment per tx, never double-counts, and heals a call marked failed', async () => {
    const u = await fx.user();
    const caller = await fx.agent(u.id);
    const subAgent = `0x${'2'.repeat(40)}`;
    const callee = await fx.agent(u.id, { payoutAddress: subAgent });
    const agreement = await fx.agreement(u.id, caller.id);
    const tx = `0xqa${Math.random().toString(16).slice(2)}`;

    // the route recorded the payment first, then the indexer sees the event (twice)
    await db.insert(schema.payments).values({ agreementId: agreement.id, kind: 'a2a', amountTinybar: '200', txHash: tx, status: 'confirmed' }).onConflictDoNothing();
    await applyDelegated(agreement, subAgent, '200', tx);
    await applyDelegated(agreement, subAgent, '200', tx);
    expect(await db.select().from(schema.payments).where(eq(schema.payments.txHash, tx))).toHaveLength(1);

    // the indexer saw it first, then the route records the same tx
    const tx2 = `${tx}b`;
    await applyDelegated(agreement, subAgent, '300', tx2);
    await db.insert(schema.payments).values({ agreementId: agreement.id, kind: 'a2a', amountTinybar: '300', txHash: tx2, status: 'confirmed' }).onConflictDoNothing();
    const rows = await db.select().from(schema.payments).where(eq(schema.payments.txHash, tx2));
    expect(rows).toHaveLength(1);
    expect(rows[0].amountTinybar).toBe('300');

    // a call the route marked failed although the tx landed
    const [failed] = await db.insert(schema.a2aCalls).values({
      agreementId: agreement.id, callerAgentId: caller.id, calleeAgentId: callee.id, priceTinybar: '400', status: 'failed', blockedReason: 'Payment failed: timeout',
    }).returning();
    await applyDelegated(agreement, subAgent, '400', `${tx}c`);
    const [healed] = await db.select().from(schema.a2aCalls).where(eq(schema.a2aCalls.id, failed.id));
    expect(healed.status).toBe('paid');
  });
});
