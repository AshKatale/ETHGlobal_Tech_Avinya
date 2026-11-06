// Eligibility for JobEscrowV2.refundIfNoVerdict(): state Submitted and block time past submittedAt + reviewWindow.
import { EscrowState } from '../chain/abi.js';

export type RefundEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'wrong_state'; state: number }
  | { eligible: false; reason: 'too_early'; remainingSeconds: number };

export function evaluateRefundTimeout(a: { state: number; submittedAt: bigint; reviewWindow: bigint; nowSec: bigint }): RefundEligibility {
  if (a.state !== EscrowState.Submitted) return { eligible: false, reason: 'wrong_state', state: a.state };
  const opensAt = a.submittedAt + a.reviewWindow;
  if (a.nowSec <= opensAt) return { eligible: false, reason: 'too_early', remainingSeconds: Number(opensAt - a.nowSec) + 1 }; // contract needs strictly greater
  return { eligible: true };
}
