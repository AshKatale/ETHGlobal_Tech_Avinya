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
