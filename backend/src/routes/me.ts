// Dashboard numbers for the signed-in user: money locked in their jobs, what their agents earned, and recent HBAR movements.
import type { FastifyInstance } from 'fastify';
import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../lib/auth.js';
import { summarizeAgents } from '../lib/agentSummary.js';

const LOCKED = ['funded', 'submitted', 'verifying'];
const DONE = ['released', 'refunded'];

export async function meRoutes(app: FastifyInstance) {
  app.get('/me/summary', { preHandler: requireUser }, async (req) => {
    const userId = req.user!.id;
    const myAgents = await db.select().from(schema.agents).where(eq(schema.agents.ownerUserId, userId));
    const agentIds = myAgents.map((a) => a.id);

    const asClient = await db.select().from(schema.agreements).where(eq(schema.agreements.clientUserId, userId));
    const asAgent = agentIds.length ? await db.select().from(schema.agreements).where(inArray(schema.agreements.agentId, agentIds)) : [];

    const locked = asClient.filter((a) => LOCKED.includes(a.status)).reduce((t, a) => t + BigInt(a.priceTinybar), 0n);
    const sums = await summarizeAgents(myAgents);
    const earned = [...sums.values()].reduce((t, s) => t + BigInt(s.earnedTinybar), 0n);
    const activeJobs = asClient.filter((a) => !DONE.includes(a.status)).length + asAgent.filter((a) => !DONE.includes(a.status)).length;

    // Recent HBAR movements, written from this user's point of view.
    const all = [...new Map([...asClient, ...asAgent].map((a) => [a.id, a])).values()];
    const clientIds = new Set(asClient.map((a) => a.id));
    const agentJobIds = new Set(asAgent.map((a) => a.id));
    const titles = all.length ? await db.select({ id: schema.requests.id, title: schema.requests.title }).from(schema.requests).where(inArray(schema.requests.id, all.map((a) => a.requestId))) : [];
    const titleOf = (agreementId: string) => titles.find((t) => t.id === all.find((a) => a.id === agreementId)?.requestId)?.title ?? 'job';
    const payments = all.length ? await db.select().from(schema.payments).where(inArray(schema.payments.agreementId, all.map((a) => a.id))).orderBy(desc(schema.payments.createdAt)).limit(80) : [];
    const legs = all.length ? await db.select().from(schema.subLegs).where(inArray(schema.subLegs.agreementId, all.map((a) => a.id))) : [];

    const activity: { at: Date; text: string; amountTinybar: string; txId: string | null }[] = [];
    for (const p of payments) {
      const txId = p.hederaTxId ?? p.txHash;
      const t = titleOf(p.agreementId);
      const amt = p.amountTinybar;
      if (p.kind === 'fund' && clientIds.has(p.agreementId)) activity.push({ at: p.createdAt, text: `Funded the contract for "${t}"`, amountTinybar: `-${amt}`, txId });
      else if (p.kind === 'release' && agentJobIds.has(p.agreementId)) activity.push({ at: p.createdAt, text: `Paid for "${t}"`, amountTinybar: amt, txId });
      else if (p.kind === 'release' && clientIds.has(p.agreementId)) activity.push({ at: p.createdAt, text: `Released to the agent for "${t}"`, amountTinybar: '0', txId });
      else if (p.kind === 'refund' && clientIds.has(p.agreementId)) activity.push({ at: p.createdAt, text: `Refund for "${t}"`, amountTinybar: amt, txId });
      else if (p.kind === 'a2a') {
        const leg = legs.find((l) => l.payoutTx && l.payoutTx === p.hederaTxId);
        if (leg && agentIds.includes(leg.calleeAgentId)) activity.push({ at: p.createdAt, text: `Sub-agent payment received for "${t}"`, amountTinybar: amt, txId });
        else if (leg && agentJobIds.has(p.agreementId)) activity.push({ at: p.createdAt, text: `Paid a sub-agent for "${t}"`, amountTinybar: `-${amt}`, txId });
      }
    }
    activity.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { lockedTinybar: locked.toString(), earnedTinybar: earned.toString(), activeJobs, activity: activity.slice(0, 40) };
  });
}
