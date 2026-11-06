// Budget rule for agent-to-agent spend. All bigint math, percent as basis points.

export function percentToBps(percent: number): bigint {
  return BigInt(Math.round(percent * 100));
}

/** Would `alreadySpent + price` stay within `maxPercent`% of the job price? */
export function withinBudget(args: { jobPrice: bigint; alreadySpent: bigint; price: bigint; maxPercent: number }): boolean {
  const bps = percentToBps(args.maxPercent);
  return (args.alreadySpent + args.price) * 10_000n <= args.jobPrice * bps;
}

export function remainingBudget(args: { jobPrice: bigint; alreadySpent: bigint; maxPercent: number }): bigint {
  const cap = (args.jobPrice * percentToBps(args.maxPercent)) / 10_000n;
  return cap > args.alreadySpent ? cap - args.alreadySpent : 0n;
}

/** V2 escrows allow delegate only in Funded (not after submit), so the backend refuses A2A spend in any other status. */
export const canDelegateInStatus = (status: string) => status === 'funded';

type Party = { id: string; ownerUserId: string; payoutAddress: string };
/**
 * S-17: why `caller` may not hire `callee`, or null. Hiring yourself (same agent id) is always refused. Hiring an agent with
 * the same owner or payout address is refused only when `blockSameOwner` is on (A2A_BLOCK_SAME_OWNER), because the demo
 * registers both demo agents from one lister wallet.
 */
export function selfHireReason(caller: Party, callee: Party, blockSameOwner: boolean): string | null {
  if (caller.id === callee.id) return 'An agent cannot hire itself';
  if (blockSameOwner && (caller.ownerUserId === callee.ownerUserId || caller.payoutAddress.toLowerCase() === callee.payoutAddress.toLowerCase())) {
    return 'An agent cannot hire an agent with the same owner or payout address';
  }
  return null;
}
