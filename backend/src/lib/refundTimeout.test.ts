import { describe, expect, it } from 'vitest';
import { evaluateRefundTimeout } from './refundTimeout.js';

const base = { state: 2, submittedAt: 1000n, reviewWindow: 259200n };
describe('refund-timeout eligibility', () => {
  it('too early reports the remaining seconds (contract needs now > submittedAt + window)', () => {
    expect(evaluateRefundTimeout({ ...base, nowSec: 1000n + 100n })).toEqual({ eligible: false, reason: 'too_early', remainingSeconds: 259200 - 100 + 1 });
    expect(evaluateRefundTimeout({ ...base, nowSec: 1000n + 259200n })).toEqual({ eligible: false, reason: 'too_early', remainingSeconds: 1 });
  });
  it('eligible strictly after the window', () => {
    expect(evaluateRefundTimeout({ ...base, nowSec: 1000n + 259201n })).toEqual({ eligible: true });
  });
  it('wrong state is not eligible regardless of time', () => {
    for (const state of [0, 1, 3, 4]) expect(evaluateRefundTimeout({ ...base, state, nowSec: 9_999_999n })).toEqual({ eligible: false, reason: 'wrong_state', state });
  });
});
