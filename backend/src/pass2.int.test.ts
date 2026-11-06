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
