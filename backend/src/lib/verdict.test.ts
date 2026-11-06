import { describe, expect, it } from 'vitest';
import { decideVerdict } from './analyzer.js';
import type { CheckItem } from './customChecks.js';
import { quoteReplySchema } from '../agents/dispatch.js';

const criteria = (passed: number, total: number): CheckItem[] =>
  Array.from({ length: total }, (_, i) => ({ name: `c${i}`, passed: i < passed, detail: '', kind: 'criterion' as const }));
const check = (name: string, passed: boolean): CheckItem => ({ name, passed, detail: '', kind: 'check' });

describe('verdict uses the designed pass threshold', () => {
  it('a 90% threshold allows one miss in ten, a 100% threshold does not', () => {
    expect(decideVerdict(criteria(9, 10), 90).passed).toBe(true);
    expect(decideVerdict(criteria(8, 10), 90).passed).toBe(false);
    expect(decideVerdict(criteria(9, 10), 100).passed).toBe(false);
    expect(decideVerdict(criteria(10, 10), 100).passed).toBe(true);
  });
  it('a failed hard check fails the task whatever the checklist rate', () => {
    const d = decideVerdict([...criteria(10, 10), check('secrets_scan', false), check('lint_rules', true)], 90);
    expect(d.passed).toBe(false);
    expect(d.failedChecks).toEqual(['secrets_scan']);
  });
  it('passing every check and meeting the threshold passes', () => {
    expect(decideVerdict([...criteria(19, 20), check('security_review', true)], 95).passed).toBe(true);
  });
  it('a verdict with no criteria never passes', () => {
    expect(decideVerdict([check('security_review', true)], 90).passed).toBe(false);
  });
  it('reports the checklist rate', () => {
    const d = decideVerdict(criteria(7, 8), 80);
    expect(d.checklistRate).toBe(87.5);
    expect(d.criteriaPassed).toBe(7);
    expect(d.criteriaTotal).toBe(8);
  });
});

describe('agent quote replies', () => {
  it('accepts a price or a refusal and rejects junk', () => {
    expect(quoteReplySchema.parse({ priceTinybar: '500000', etaHours: 2 }).priceTinybar).toBe('500000');
    expect(quoteReplySchema.parse({ decline: true }).decline).toBe(true);
    expect(() => quoteReplySchema.parse({ priceTinybar: '1.5' })).toThrow();
    expect(() => quoteReplySchema.parse({ priceTinybar: '-5' })).toThrow();
    expect(() => quoteReplySchema.parse({ etaHours: 0 })).toThrow();
  });
});

import { agentHeaders } from '../agents/dispatch.js';
import { env } from '../env.js';
describe('platform -> agent calls', () => {
  it('send the backend secret only when one is configured', () => {
    const h = agentHeaders();
    expect(h['content-type']).toBe('application/json');
    expect('x-backend-secret' in h).toBe(Boolean(env.BACKEND_SECRET));
  });
});
