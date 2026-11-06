import { describe, expect, it } from 'vitest';
import { canTransition } from './stateMachine.js';

describe('agreement state machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('agreed', 'funded')).toBe(true);
    expect(canTransition('funded', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'verifying')).toBe(true);
    expect(canTransition('verifying', 'released')).toBe(true);
    expect(canTransition('verifying', 'refunded')).toBe(true);
  });
  it('blocks skips and reversals', () => {
    expect(canTransition('agreed', 'released')).toBe(false);
    expect(canTransition('released', 'funded')).toBe(false);
    expect(canTransition('submitted', 'funded')).toBe(false);
  });
});
