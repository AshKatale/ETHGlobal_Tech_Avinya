import { describe, expect, it } from 'vitest';
import { compareTerms, sameHash } from './designProof.js';

const created = Date.UTC(2026, 10, 6, 12, 0, 0);
const spec = { priceTinybar: '50000000', deadlineHours: 5, maxSubBps: 1000, maxSubLegs: 1, payoutGraceSecs: 7200 };
const chain = { price: 50_000_000n, deadlineUnix: Math.floor(created / 1000) + 5 * 3600 + 90, maxSubBps: 1000, maxSubLegs: 1, payoutGrace: 7200 };

describe('compareTerms', () => {
  it('matches when the contract holds exactly what was designed', () => {
    expect(compareTerms(spec, chain, created).every((r) => r.match)).toBe(true);
  });
  it('flags every term that differs', () => {
    const rows = compareTerms(spec, { ...chain, price: 1n, maxSubBps: 4000, maxSubLegs: 3, payoutGrace: 600, deadlineUnix: chain.deadlineUnix + 10 * 3600 }, created);
    expect(rows.filter((r) => !r.match).map((r) => r.key)).toEqual(['price', 'deadline', 'maxSubBps', 'maxSubLegs', 'payoutGrace']);
  });
});

describe('sameHash', () => {
  it('ignores case and rejects empty values', () => {
    expect(sameHash('0xAB', '0xab')).toBe(true);
    expect(sameHash(null, '0xab')).toBe(false);
  });
});
