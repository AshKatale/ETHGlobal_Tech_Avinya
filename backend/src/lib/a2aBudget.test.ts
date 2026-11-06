import { describe, expect, it } from 'vitest';
import { canDelegateInStatus, remainingBudget, selfHireReason, withinBudget } from './a2aBudget.js';

describe('a2a budget', () => {
  const jobPrice = 1_000_000_000n; // 10 HBAR
  it('allows spend up to the cap and blocks above it', () => {
    expect(withinBudget({ jobPrice, alreadySpent: 0n, price: 300_000_000n, maxPercent: 30 })).toBe(true);
    expect(withinBudget({ jobPrice, alreadySpent: 0n, price: 300_000_001n, maxPercent: 30 })).toBe(false);
    expect(withinBudget({ jobPrice, alreadySpent: 200_000_000n, price: 150_000_000n, maxPercent: 30 })).toBe(false);
  });
  it('computes remaining budget', () => {
    expect(remainingBudget({ jobPrice, alreadySpent: 100_000_000n, maxPercent: 30 })).toBe(200_000_000n);
    expect(remainingBudget({ jobPrice, alreadySpent: 400_000_000n, maxPercent: 30 })).toBe(0n);
  });
  it('delegates only while funded (V2 rule)', () => {
    expect(canDelegateInStatus('funded')).toBe(true);
    for (const s of ['agreed', 'submitted', 'verifying', 'released', 'refunded']) expect(canDelegateInStatus(s), s).toBe(false);
  });
  it('self-hire: same id always; same owner or payout only when enabled', () => {
    const a = { id: 'a', ownerUserId: 'u1', payoutAddress: '0xAA' };
    expect(selfHireReason(a, a, false)).toMatch(/itself/);
    expect(selfHireReason(a, { id: 'b', ownerUserId: 'u1', payoutAddress: '0xbb' }, false)).toBeNull();
    expect(selfHireReason(a, { id: 'b', ownerUserId: 'u1', payoutAddress: '0xbb' }, true)).toMatch(/same owner/);
    expect(selfHireReason(a, { id: 'b', ownerUserId: 'u2', payoutAddress: '0xaa' }, true)).toMatch(/payout/);
    expect(selfHireReason(a, { id: 'b', ownerUserId: 'u2', payoutAddress: '0xbb' }, true)).toBeNull();
  });
});
