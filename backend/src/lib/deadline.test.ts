import { describe, expect, it } from 'vitest';
import { DEFAULT_DEADLINE_MS, MIN_DEADLINE_MS, deadlineError, defaultDeadline } from './deadline.js';

describe('deadline policy', () => {
  const now = 1_800_000_000_000;
  it('rejects a past deadline and one under 15 minutes', () => {
    expect(deadlineError(new Date(now - 1000), now)).toMatch(/15 minutes/);
    expect(deadlineError(new Date(now + MIN_DEADLINE_MS - 1), now)).toMatch(/15 minutes/);
  });
  it('accepts exactly 15 minutes and later', () => {
    expect(deadlineError(new Date(now + MIN_DEADLINE_MS), now)).toBeNull();
    expect(deadlineError(new Date(now + 3600_000), now)).toBeNull();
  });
  it('defaults to 7 days', () => {
    expect(defaultDeadline(now).getTime() - now).toBe(DEFAULT_DEADLINE_MS);
    expect(DEFAULT_DEADLINE_MS).toBe(7 * 24 * 3600 * 1000);
  });
});
