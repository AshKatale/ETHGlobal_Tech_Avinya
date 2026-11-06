// ADR-003 audit log: one row per verifier signature. Stores the sha256 of the signature (the signature itself is public
// on-chain once used) and never any key material.
import { createHash } from 'node:crypto';
import { db, schema } from '../db/index.js';

export const sigSha256 = (sig: string) => createHash('sha256').update(sig).digest('hex');

export async function recordSignature(a: {
  kind: 'verdict' | 'delegation'; agreementId: string; escrow: string; signer: string; nonce: bigint; resultOrAmount: string; sig: string;
}) {
  await db.insert(schema.signatureAudit).values({
    kind: a.kind,
    agreementId: a.agreementId,
    escrowAddress: a.escrow.toLowerCase(),
    signerAddress: a.signer.toLowerCase(),
    nonce: a.nonce,
    resultOrAmount: a.resultOrAmount,
    sigSha256: sigSha256(a.sig),
  });
}
