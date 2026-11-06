import { describe, expect, it } from 'vitest';
import { computeTrust, wilsonLowerBound, type AgentStats } from './trust.js';

const base: AgentStats = { benchmarkScore: 90, jobsCompleted: 0, jobsFailed: 0, payoutDefaults: 0, avgDeliveryRatio: null };

describe('trust', () => {
  it('wilson rewards volume over a lucky streak', () => {
    expect(wilsonLowerBound(1, 1)).toBeLessThan(wilsonLowerBound(18, 20));
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });
  it('a brand-new agent is capped even with a perfect benchmark', () => {
    const t = computeTrust({ ...base, benchmarkScore: 100 });
    expect(t.score).toBeLessThanOrEqual(60);
    expect(t.tier).not.toBe('trusted');
  });
  it('a track record beats a benchmark', () => {
    const newcomer = computeTrust(base);
    const veteran = computeTrust({ ...base, jobsCompleted: 25, jobsFailed: 1 });
    expect(veteran.score).toBeGreaterThan(newcomer.score);
    expect(veteran.tier).toBe('trusted');
  });
  it('unpaid sub-agent debts and lateness lower the score', () => {
    const good = computeTrust({ ...base, jobsCompleted: 25, jobsFailed: 1 });
    const bad = computeTrust({ ...base, jobsCompleted: 25, jobsFailed: 1, payoutDefaults: 2, avgDeliveryRatio: 1.5 });
    expect(bad.score).toBeLessThan(good.score - 20);
  });
  it('an agent with no benchmark and no history scores zero', () => {
    expect(computeTrust({ ...base, benchmarkScore: null }).score).toBe(0);
  });
  it('score stays within 0..100', () => {
    expect(computeTrust({ ...base, jobsCompleted: 0, jobsFailed: 30, payoutDefaults: 9, benchmarkScore: null }).score).toBeGreaterThanOrEqual(0);
    expect(computeTrust({ ...base, benchmarkScore: 100, jobsCompleted: 500 }).score).toBeLessThanOrEqual(100);
  });
});
