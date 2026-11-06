// Orchestration between the database and the chain. Money states (funded/released/refunded) are
// never set here; only the indexer sets them, after it reads the on-chain event.
import { eq } from 'drizzle-orm';
import type { Address, Hex } from 'viem';
import { db, schema } from '../db/index.js';
import {
  ChainError, createEscrowOnChain, readEscrowState, readRefundTimeoutInfo, refundIfNoVerdictOnChain, refundOnChain, releaseOnChain, signVerdict, submitOnChain,
} from './client.js';
import { EscrowState } from './abi.js';
import { latestSubmission } from '../lib/submissions.js';
import { evaluateRefundTimeout } from '../lib/refundTimeout.js';
import { singleFlight } from '../lib/singleFlight.js';

const DEFAULT_DEADLINE_SECS = 7 * 24 * 3600;

/** Create the JobEscrow for an agreement if it does not exist yet. Safe to call repeatedly. */
export async function ensureEscrow(agreementId: string): Promise<string> {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  if (!agreement) throw new ChainError('Agreement not found');
  if (agreement.escrowAddress) return agreement.escrowAddress;

  const [client] = await db.select().from(schema.users).where(eq(schema.users.id, agreement.clientUserId)).limit(1);
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agreement.agentId)).limit(1);
  const deadline = agreement.deadlineAt
    ? BigInt(Math.floor(agreement.deadlineAt.getTime() / 1000))
    : BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECS);

  const { escrow } = await createEscrowOnChain({
    agreementId,
    client: client.address as Address,
    agent: agent.payoutAddress as Address,
    priceTinybar: BigInt(agreement.priceTinybar),
    deadlineUnix: deadline,
  });
  await db.update(schema.agreements).set({ escrowAddress: escrow }).where(eq(schema.agreements.id, agreementId));
  return escrow;
}

/** Make sure the escrow is in the Submitted state on-chain (records the deliverable hash). Idempotent. */
export async function ensureSubmittedOnChain(agreementId: string): Promise<void> {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  const submission = await latestSubmission(agreementId);
  if (!agreement?.escrowAddress) throw new ChainError('Agreement has no escrow');
  if (!submission) throw new ChainError('No submission');
  const escrow = agreement.escrowAddress as Address;
  const state = await readEscrowState(escrow);
  if (state === EscrowState.Funded) {
    await submitOnChain(escrow, `0x${submission.deliverableHash}` as Hex);
  } else if (state === EscrowState.Created) {
    throw new ChainError('Escrow is not funded on-chain yet');
  } // Submitted/Released/Refunded: nothing to do
}

export type SettleResult = { txHash: string; result: string } | { already: true; inProgress?: true; txHash?: string | null };

/**
 * Sign the verdict and send release (PASS) or refund (FAIL). Records the tx; the indexer flips the status.
 * Single-flight per agreement (S-06): if another settle holds the lock, return the current state instead of sending again.
 */
export async function settle(agreementId: string): Promise<SettleResult> {
  const r = await singleFlight(`settle:${agreementId}`, () => settleLocked(agreementId));
  if (!r.busy) return r.value;
  const [verdict] = await db.select().from(schema.verdicts).where(eq(schema.verdicts.agreementId, agreementId)).limit(1);
  return { already: true, inProgress: true, txHash: verdict?.settleTxHash ?? null };
}

async function settleLocked(agreementId: string): Promise<{ txHash: string; result: string } | { already: true }> {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  const [verdict] = await db.select().from(schema.verdicts).where(eq(schema.verdicts.agreementId, agreementId)).limit(1);
  if (!agreement?.escrowAddress) throw new ChainError('Agreement has no escrow');
  if (!verdict) throw new ChainError('No verdict yet');
  const escrow = agreement.escrowAddress as Address;

  const state = await readEscrowState(escrow);
  if (state === EscrowState.Released || state === EscrowState.Refunded) return { already: true };
  if (state !== EscrowState.Submitted) throw new ChainError(`Escrow is in state ${state}, expected Submitted`);

  const pass = verdict.result === 'PASS';
  try {
    const { sig, nonce } = await signVerdict(escrow, agreementId, pass);
    const { hash } = await (pass ? releaseOnChain(escrow, nonce, sig) : refundOnChain(escrow, nonce, sig));

    // The release/refund payment row is written by the indexer from the on-chain event (with the exact amount).
    await db.update(schema.verdicts).set({ verifierSig: sig, nonce, settleTxHash: hash, settleError: null }).where(eq(schema.verdicts.id, verdict.id));
    return { txHash: hash, result: verdict.result };
  } catch (e) {
    await db.update(schema.verdicts).set({ settleError: (e as Error).message }).where(eq(schema.verdicts.id, verdict.id));
    throw e;
  }
}

export type RefundTimeoutResult =
  | { kind: 'sent'; txHash: string }
  | { kind: 'v1' }
  | { kind: 'too_early'; remainingSeconds: number }
  | { kind: 'wrong_state'; state: number }
  | { kind: 'in_progress' };

/**
 * V2 exit from Submitted: refundIfNoVerdict() once the review window has passed. The chain is the authority: state and
 * window are read on chain. The indexer flips the agreement to refunded from the Refunded event.
 */
export async function refundTimeout(agreementId: string): Promise<RefundTimeoutResult> {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  if (!agreement?.escrowAddress) throw new ChainError('Agreement has no escrow');
  const escrow = agreement.escrowAddress as Address;
  const r = await singleFlight(`refund-timeout:${agreementId}`, async (): Promise<RefundTimeoutResult> => {
    const info = await readRefundTimeoutInfo(escrow);
    if (!info) return { kind: 'v1' };
    const verdict = evaluateRefundTimeout(info);
    if (!verdict.eligible) {
      return verdict.reason === 'too_early'
        ? { kind: 'too_early', remainingSeconds: verdict.remainingSeconds }
        : { kind: 'wrong_state', state: verdict.state };
    }
    const { hash } = await refundIfNoVerdictOnChain(escrow);
    return { kind: 'sent', txHash: hash };
  });
  return r.busy ? { kind: 'in_progress' } : r.value;
}
