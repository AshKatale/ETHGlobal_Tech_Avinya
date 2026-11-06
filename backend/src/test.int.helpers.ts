// Fixtures for integration tests against the shared Neon DB. Everything is tagged "[qa]" and isSeeded, and cleanup()
// deletes only the rows created through this instance (by id).
import { randomBytes } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import { sha256 } from './lib/auth.js';

export const HAS_DB = process.env.HAS_REAL_DB === '1';
const rand = () => randomBytes(8).toString('hex');

export class Fixtures {
  userIds: string[] = [];
  agentIds: string[] = [];
  requestIds: string[] = [];
  quoteIds: string[] = [];
  agreementIds: string[] = [];
  sessionIds: string[] = [];

  async user() {
    const [u] = await db.insert(schema.users).values({ address: `0x${rand()}${rand()}${rand()}${rand()}${rand()}`.slice(0, 42).toLowerCase(), displayName: '[qa]' }).returning();
    this.userIds.push(u.id);
    const token = rand() + rand();
    await db.insert(schema.sessions).values({ id: token, userId: u.id, expiresAt: new Date(Date.now() + 3600_000) });
    this.sessionIds.push(token);
    return { ...u, token };
  }

  async agent(ownerUserId: string, o: Partial<typeof schema.agents.$inferInsert> = {}) {
    const key = `afk_qa_${rand()}`;
    const [a] = await db.insert(schema.agents).values({
      ownerUserId, name: `[qa] agent ${rand()}`, description: '[qa]', capabilities: ['qa'], payoutAddress: `0x${'1'.repeat(40)}`,
      priceTinybar: '100', apiKeyHash: sha256(key), isSeeded: true, ...o,
    }).returning();
    this.agentIds.push(a.id);
    return { ...a, key };
  }

  async request(clientUserId: string, o: { budget?: string; requirements?: string } = {}) {
    const [r] = await db.insert(schema.requests).values({ clientUserId, title: '[qa] request', requirements: o.requirements ?? '[qa] requirements text', budgetTinybar: o.budget ?? '1000', isSeeded: true }).returning();
    this.requestIds.push(r.id);
    return r;
  }

  async agreement(clientUserId: string, agentId: string, o: { price?: string; status?: string } = {}) {
    const r = await this.request(clientUserId, { budget: o.price });
    const [q] = await db.insert(schema.quotes).values({ requestId: r.id, agentId, priceTinybar: o.price ?? '1000' }).returning();
    this.quoteIds.push(q.id);
    const [ag] = await db.insert(schema.agreements).values({ requestId: r.id, quoteId: q.id, clientUserId, agentId, priceTinybar: o.price ?? '1000', status: o.status ?? 'funded' }).returning();
    this.agreementIds.push(ag.id);
    return ag;
  }

  async cleanup() {
    const A = this.agreementIds;
    if (A.length) {
      await db.delete(schema.a2aCalls).where(inArray(schema.a2aCalls.agreementId, A));
      await db.delete(schema.payments).where(inArray(schema.payments.agreementId, A));
      await db.delete(schema.submissions).where(inArray(schema.submissions.agreementId, A));
      await db.delete(schema.verifications).where(inArray(schema.verifications.agreementId, A));
      await db.delete(schema.verdicts).where(inArray(schema.verdicts.agreementId, A));
      await db.delete(schema.agreements).where(inArray(schema.agreements.id, A));
    }
    if (this.requestIds.length) await db.delete(schema.quotes).where(inArray(schema.quotes.requestId, this.requestIds));
    if (this.agentIds.length) await db.delete(schema.quotes).where(inArray(schema.quotes.agentId, this.agentIds));
    if (this.requestIds.length) await db.delete(schema.requests).where(inArray(schema.requests.id, this.requestIds));
    if (this.agentIds.length) await db.delete(schema.agents).where(inArray(schema.agents.id, this.agentIds));
    for (const t of this.sessionIds) await db.delete(schema.sessions).where(eq(schema.sessions.id, t));
    if (this.userIds.length) await db.delete(schema.users).where(inArray(schema.users.id, this.userIds));
  }
}
