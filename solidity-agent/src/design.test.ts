import { describe, expect, it } from 'vitest';
import { design, type DesignRequest } from './design.js';
import { extractJson } from './analyze.js';
import { canonicalJson, contractSpecSchema, heuristicAnalysis, specHash } from './spec.js';
import type { Analyzer } from './analyze.js';

const ONE_HBAR = 100_000_000n;
const fakeAi = (over: Partial<ReturnType<typeof heuristicAnalysis>> = {}): Analyzer => async () => ({
  analysis: { complexity: 3, effortHours: 6, risk: 'medium', summary: 'Moderate contract work.', suggestedChecks: ['lint_rules'], ...over },
  source: 'ai',
});

const reqFor = (stats: DesignRequest['agent']['stats'], price = 5n * ONE_HBAR): DesignRequest => ({
  request: { requirements: 'Write an ERC-20 token with a fixed supply and no mint function.', budgetTinybar: (10n * ONE_HBAR).toString(), checksRequested: ['secrets_scan'] },
  agent: { name: 'Builder', description: 'Writes contracts', capabilities: ['solidity'], stats },
  quotePriceTinybar: price.toString(),
});

const newcomer = { benchmarkScore: 85, jobsCompleted: 0, jobsFailed: 0, payoutDefaults: 0, avgDeliveryRatio: null };
const veteran = { benchmarkScore: 92, jobsCompleted: 30, jobsFailed: 1, payoutDefaults: 0, avgDeliveryRatio: 0.8 };
const flaky = { benchmarkScore: 92, jobsCompleted: 30, jobsFailed: 1, payoutDefaults: 3, avgDeliveryRatio: 1.6 };

describe('design: same job, different providers, different contracts', () => {
  it('a trusted agent gets more sub-agent room and a tighter deadline than a newcomer', async () => {
    const a = (await design(reqFor(newcomer), fakeAi())).spec;
    const b = (await design(reqFor(veteran), fakeAi())).spec;
    expect(b.maxSubBps).toBeGreaterThan(a.maxSubBps);
    expect(b.maxSubLegs).toBeGreaterThan(a.maxSubLegs);
    expect(b.deadlineHours).toBeLessThan(a.deadlineHours);
    expect(b.trustScore).toBeGreaterThan(a.trustScore);
  });
  it('an agent that skips sub-agent payments loses subcontracting room', async () => {
    const good = (await design(reqFor(veteran), fakeAi())).spec;
    const bad = (await design(reqFor(flaky), fakeAi())).spec;
    expect(bad.maxSubBps).toBeLessThan(good.maxSubBps);
    expect(bad.deadlineHours).toBeGreaterThan(good.deadlineHours);
  });
  it('a high-risk job caps sub-agent spending, demands 100% and adds a security review', async () => {
    const s = (await design(reqFor(veteran), fakeAi({ risk: 'high', complexity: 5 }))).spec;
    expect(s.maxSubBps).toBeLessThanOrEqual(2000);
    expect(s.passThresholdPct).toBe(100);
    expect(s.checks).toContain('security_review');
    expect(s.payoutGraceSecs).toBe(6 * 3600);
  });
  it('merges client-requested and suggested checks, dropping unknown ones', async () => {
    const s = (await design(reqFor(newcomer), fakeAi({ suggestedChecks: ['lint_rules', 'rm_rf_everything'] }))).spec;
    expect(s.checks).toEqual(expect.arrayContaining(['secrets_scan', 'lint_rules']));
    expect(s.checks).not.toContain('rm_rf_everything' as never);
  });
});

describe('guardrails: the model cannot push numbers past the bounds', () => {
  it('absurd effort is clamped to 720h and never produces an invalid spec', async () => {
    const s = (await design(reqFor(newcomer), fakeAi({ effortHours: 2000 }))).spec;
    expect(s.deadlineHours).toBe(720);
    expect(() => contractSpecSchema.parse(s)).not.toThrow();
  });
  it('tiny effort still gets at least 2h', async () => {
    expect((await design(reqFor(veteran), fakeAi({ effortHours: 0.25 }))).spec.deadlineHours).toBeGreaterThanOrEqual(2);
  });
  it('never exceeds the factory bounds (sub cap <= 40%, <= 3 legs)', async () => {
    const s = (await design(reqFor({ ...veteran, jobsCompleted: 1000 }), fakeAi({ risk: 'low' }))).spec;
    expect(s.maxSubBps).toBeLessThanOrEqual(4000);
    expect(s.maxSubLegs).toBeLessThanOrEqual(3);
  });
  it('warns when the quote is above the budget, but keeps the quoted price', async () => {
    const d = await design(reqFor(newcomer, 20n * ONE_HBAR), fakeAi());
    expect(d.spec.warnings.join(' ')).toMatch(/above the client budget/);
    expect(d.spec.priceTinybar).toBe((20n * ONE_HBAR).toString());
  });
  it('flags the fallback when the AI is unavailable', async () => {
    const d = await design(reqFor(newcomer), async (i) => ({ analysis: heuristicAnalysis(i.requirements), source: 'fallback' }));
    expect(d.source).toBe('fallback');
    expect(d.spec.warnings.join(' ')).toMatch(/AI analysis unavailable/);
  });
});

describe('hashing and parsing', () => {
  it('the spec hash is stable and changes when any term changes', async () => {
    const d1 = await design(reqFor(veteran), fakeAi());
    const d2 = await design(reqFor(veteran), fakeAi());
    expect(d1.specHash).toBe(d2.specHash);
    expect(specHash({ ...d1.spec, maxSubBps: d1.spec.maxSubBps - 1 })).not.toBe(d1.specHash);
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it('extractJson tolerates fences and trailing braces', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('{"a":"x}y"} then {not json}')).toEqual({ a: 'x}y' });
    expect(() => extractJson('nothing')).toThrow();
  });
});
