import { describe, expect, it } from 'vitest';
import { remainingBudget, withinBudget } from './a2aBudget.js';

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
});
