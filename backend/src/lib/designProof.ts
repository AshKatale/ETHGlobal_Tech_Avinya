// Compares the terms the designer decided with what the deployed contract actually holds. Pure: no network, easy to test.
export type DesignedTerms = { priceTinybar: string; deadlineHours: number; maxSubBps: number; maxSubLegs: number; payoutGraceSecs: number };
export type ChainTerms = { price: bigint; deadlineUnix: number; maxSubBps: number; maxSubLegs: number; payoutGrace: number };
export type ProofRow = { key: string; label: string; designed: string; onchain: string; match: boolean };

const HOUR = 3600;

/** One row per term. The deadline is stored as a timestamp on-chain, so it is compared as hours after the agreement was created (1h tolerance: the contract is deployed minutes later). */
export function compareTerms(spec: DesignedTerms, chain: ChainTerms, createdAtMs: number): ProofRow[] {
  const hoursOnChain = (chain.deadlineUnix * 1000 - createdAtMs) / (HOUR * 1000);
  return [
    { key: 'price', label: 'Price', designed: `${spec.priceTinybar} tinybar`, onchain: `${chain.price} tinybar`, match: String(chain.price) === spec.priceTinybar },
    { key: 'deadline', label: 'Deadline', designed: `${spec.deadlineHours}h after creation`, onchain: `${hoursOnChain.toFixed(1)}h after creation (${new Date(chain.deadlineUnix * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC)`, match: Math.abs(hoursOnChain - spec.deadlineHours) <= 1 },
    { key: 'maxSubBps', label: 'Sub-agent spending cap', designed: `${(spec.maxSubBps / 100).toFixed(2)}%`, onchain: `${(chain.maxSubBps / 100).toFixed(2)}%`, match: chain.maxSubBps === spec.maxSubBps },
    { key: 'maxSubLegs', label: 'Max sub-agents', designed: String(spec.maxSubLegs), onchain: String(chain.maxSubLegs), match: chain.maxSubLegs === spec.maxSubLegs },
    { key: 'payoutGrace', label: 'Payout grace', designed: `${spec.payoutGraceSecs / HOUR}h`, onchain: `${chain.payoutGrace / HOUR}h`, match: chain.payoutGrace === spec.payoutGraceSecs },
  ];
}

export const sameHash = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
