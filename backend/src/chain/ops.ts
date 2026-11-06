// Orchestration between the database, the Solidity agent and the chain. Money states (funded/released/refunded) are
// never set here; only the indexer sets them, after it reads the on-chain event.
import { eq } from 'drizzle-orm';
import { keccak256, toBytes, type Address, type Hex } from 'viem';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { buildAgentStats } from '../designer/dossier.js';
import { agentHeaders } from '../agents/dispatch.js';
import { requestDeploy, requestDesign } from '../designer/client.js';
import { accountIdOf, contractIdOf } from './mirror.js';
import {
  addSubLegOnChain, ChainError, readEscrowState, readTaskTerms, refundOnChain, releaseOnChain, retryIdempotent, signSubLeg, signVerdict, submitOnChain,
} from './client.js';
import { EscrowState } from './abi.js';

export const payoutUrl = (agreementId: string, legId: number) => `${env.GATEWAY_PUBLIC_URL}/x402/settle/${agreementId}/${legId}`;
export const fundUrl = (agreementId: string) => `${env.GATEWAY_PUBLIC_URL}/x402/fund/${agreementId}`;

/** Load everything the designer needs about a quote: request, agent, client and the agent's track record. */
export async function loadDesignInputs(quoteId: string) {
  const [quote] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, quoteId)).limit(1);
  if (!quote) throw new ChainError('Quote not found');
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, quote.requestId)).limit(1);
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, quote.agentId)).limit(1);
  const [client] = await db.select().from(schema.users).where(eq(schema.users.id, request.clientUserId)).limit(1);
  const stats = await buildAgentStats(agent.id);
  return {
    quote, request, agent, client,
    designInput: {
      request: { requirements: request.requirements, budgetTinybar: String(request.budgetTinybar), checksRequested: request.checksRequested },
      agent: { name: agent.name, description: agent.description, capabilities: agent.capabilities, stats },
      quotePriceTinybar: String(quote.priceTinybar),
    },
  };
}

/** Design the terms and deploy the task contract for an agreement, through the Solidity agent. Safe to call repeatedly. */
export async function ensureTask(agreementId: string): Promise<string> {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  if (!agreement) throw new ChainError('Agreement not found');
  if (agreement.escrowAddress && agreement.taskAccountId) return agreement.escrowAddress;

  const { agent, client, designInput } = await loadDesignInputs(agreement.quoteId);
  const design = await requestDesign(designInput);
  const deployed = await requestDeploy({ agreementId, client: client.address, agent: agent.payoutAddress, spec: design.spec });
  const task = deployed.task.toLowerCase();
  const taskAccountId = await contractIdOf(task);

  await db.update(schema.agreements).set({ escrowAddress: task, taskAccountId }).where(eq(schema.agreements.id, agreementId));
  const existing = await db.select({ id: schema.contractSpecs.id }).from(schema.contractSpecs).where(eq(schema.contractSpecs.agreementId, agreementId)).limit(1);
  if (!existing.length) {
    await db.insert(schema.contractSpecs).values({
      quoteId: agreement.quoteId, agreementId, kind: 'root', spec: design.spec, specHash: design.specHash,
      trustScore: String(design.spec.trustScore), source: design.source, deployTx: deployed.txHash,
    });
  }
  return task;
}

/** Make sure the task is in the Submitted state on-chain (records the deliverable hash). Idempotent. */
export async function ensureSubmittedOnChain(agreementId: string): Promise<void> {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  const [submission] = await db.select().from(schema.submissions).where(eq(schema.submissions.agreementId, agreementId)).limit(1);
  if (!agreement?.escrowAddress) throw new ChainError('Agreement has no task contract');
  if (!submission) throw new ChainError('No submission');
  const task = agreement.escrowAddress as Address;
  const state = await readEscrowState(task);
  if (state === EscrowState.Funded) {
    await retryIdempotent(() => submitOnChain(task, `0x${submission.deliverableHash}` as Hex), async () => (await readEscrowState(task)) >= EscrowState.Submitted);
  }
  else if (state === EscrowState.Created) throw new ChainError('Task contract is not funded on-chain yet');
}

/** Sign the verdict and send release (PASS) or refund (FAIL). The indexer flips the status and records the payment. */
export async function settle(agreementId: string): Promise<{ txHash: string; result: string } | { already: true }> {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  const [verdict] = await db.select().from(schema.verdicts).where(eq(schema.verdicts.agreementId, agreementId)).limit(1);
  if (!agreement?.escrowAddress) throw new ChainError('Agreement has no task contract');
  if (!verdict) throw new ChainError('No verdict yet');
  const task = agreement.escrowAddress as Address;

  const state = await readEscrowState(task);
  if (state === EscrowState.Released || state === EscrowState.Refunded) return { already: true };
  if (state !== EscrowState.Submitted) throw new ChainError(`Task is in state ${state}, expected Submitted`);

  const pass = verdict.result === 'PASS';
  try {
    const out = await retryIdempotent(async () => {
      const { sig, nonce } = await signVerdict(task, agreementId, pass); // fresh nonce per attempt
      const { hash } = await (pass ? releaseOnChain(task, nonce, sig) : refundOnChain(task, nonce, sig));
      await db.update(schema.verdicts).set({ verifierSig: sig, nonce, settleTxHash: hash, settleError: null }).where(eq(schema.verdicts.id, verdict.id));
      return hash;
    }, async () => (await readEscrowState(task)) >= EscrowState.Released);
    if (out === 'already') { await db.update(schema.verdicts).set({ settleError: null }).where(eq(schema.verdicts.id, verdict.id)); return { already: true }; }
    return { txHash: out, result: verdict.result };
  } catch (e) {
    await db.update(schema.verdicts).set({ settleError: (e as Error).message }).where(eq(schema.verdicts.id, verdict.id));
    throw e;
  }
}

/**
 * Add an A -> B leg to the task: check the on-chain caps, design the sub-terms, get the verifier's approval and let the
 * operator add the leg. B is paid later, by A over x402, after the whole task is released.
 */
export async function createSubLeg(args: { agreementId: string; calleeAgentId: string; subtask: string }) {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, args.agreementId)).limit(1);
  if (!agreement?.escrowAddress) throw new ChainError('Agreement has no task contract');
  const [callee] = await db.select().from(schema.agents).where(eq(schema.agents.id, args.calleeAgentId)).limit(1);
  if (!callee) throw new ChainError('Callee agent not found');
  if (callee.status !== 'listed') throw new ChainError('Callee agent is not listed');
  if (callee.id === agreement.agentId) throw new ChainError('An agent cannot hire itself');
  const price = BigInt(callee.priceTinybar);
  if (price <= 0n) throw new ChainError('Callee has no price');
  const task = agreement.escrowAddress as Address;

  // The contract enforces these too; checking first gives a clear reason instead of a reverted transaction.
  const t = await readTaskTerms(task);
  if (t.subLegCount >= t.maxSubLegs) throw new ChainError(`Sub-agent limit reached (${t.maxSubLegs})`);
  if ((t.subTotal + price) * 10_000n > t.price * BigInt(t.maxSubBps)) {
    throw new ChainError(`Would exceed the ${(t.maxSubBps / 100).toFixed(2)}% sub-agent spending cap for this task`);
  }

  // Terms for the sub-leg, designed from the callee's own record. If the designer is down the leg still gets a default terms hash.
  let termsHash: Hex;
  let spec: unknown;
  let source = 'default';
  let trustScore: string | null = null;
  try {
    const stats = await buildAgentStats(callee.id);
    const d = await requestDesign({
      request: { requirements: args.subtask.length >= 10 ? args.subtask : `${args.subtask} (sub-task)`, budgetTinybar: price.toString(), checksRequested: [] },
      agent: { name: callee.name, description: callee.description, capabilities: callee.capabilities, stats },
      quotePriceTinybar: price.toString(),
    });
    termsHash = d.specHash; spec = d.spec; source = d.source; trustScore = String(d.spec.trustScore);
  } catch {
    spec = { kind: 'sub-default', subtask: args.subtask, priceTinybar: price.toString() };
    termsHash = keccak256(toBytes(JSON.stringify(spec)));
  }

  const payeeAccountId = await accountIdOf(callee.payoutAddress);
  // If the relay times out but the leg was added, the contract's leg count tells us, so we never add the same hire twice.
  const legsBefore = t.subLegCount + 1;
  const added = await retryIdempotent(async () => {
    const { sig, nonce } = await signSubLeg(task, args.agreementId, callee.payoutAddress as Address, price, termsHash);
    return addSubLegOnChain({ task, subAgent: callee.payoutAddress as Address, priceTinybar: price, termsHash, nonce, sig });
  }, async () => (await readTaskTerms(task)).subLegCount + 1 > legsBefore);
  const txHash = added === 'already' ? null : added.txHash;
  const legId = added === 'already' ? legsBefore : added.legId;

  await db.insert(schema.contractSpecs).values({
    agreementId: args.agreementId, kind: 'sub', spec: spec as object, specHash: termsHash, trustScore, source, deployTx: txHash,
  });
  const [leg] = await db.insert(schema.subLegs).values({
    agreementId: args.agreementId, legId, calleeAgentId: callee.id, payeeAddress: callee.payoutAddress.toLowerCase(), payeeAccountId,
    priceTinybar: price.toString(), termsHash, addLegTx: txHash,
  }).returning();
  return { leg, callee, txHash };
}

/** Tell agent A (best effort) which sub-agents it now owes and where to pay them over x402. */
export async function notifyPayoutsDue(agreementId: string) {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  if (!agreement) return;
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agreement.agentId)).limit(1);
  const legs = (await db.select().from(schema.subLegs).where(eq(schema.subLegs.agreementId, agreementId))).filter((l) => l.status === 'pending');
  if (!agent?.endpointUrl || !legs.length) return;
  try {
    await fetch(`${agent.endpointUrl.replace(/\/$/, '')}/payouts-due`, {
      method: 'POST', headers: agentHeaders(),
      body: JSON.stringify({ agreementId, legs: legs.map((l) => ({ legId: l.legId, priceTinybar: String(l.priceTinybar), payeeAccountId: l.payeeAccountId, payUrl: payoutUrl(agreementId, l.legId) })) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { /* the agent can also read GET /agreements/:id/payouts */ }
}
