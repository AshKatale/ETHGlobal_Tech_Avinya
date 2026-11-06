import { describe, expect, it } from 'vitest';
import { consensusToDate, matchA2aTxHashes } from './enrich.js';

const t = (n: number) => new Date(1_800_000_000_000 + n * 1000);
describe('matchA2aTxHashes', () => {
  it('links paid calls to payments by amount in order, once each, and skips unpaid calls', () => {
    const calls = [
      { id: 'c1', priceTinybar: '100', status: 'done', createdAt: t(1) },
      { id: 'c2', priceTinybar: '100', status: 'paid', createdAt: t(2) },
      { id: 'c3', priceTinybar: '100', status: 'blocked', createdAt: t(3) },
      { id: 'c4', priceTinybar: '200', status: 'paid', createdAt: t(4) },
    ];
    const payments = [
      { kind: 'a2a', amountTinybar: '100', txHash: '0xb', createdAt: t(12) },
      { kind: 'a2a', amountTinybar: '100', txHash: '0xa', createdAt: t(11) },
      { kind: 'fund', amountTinybar: '1000', txHash: '0xf', createdAt: t(0) },
    ];
    const m = matchA2aTxHashes(calls, payments);
    expect(m.get('c1')).toBe('0xa');
    expect(m.get('c2')).toBe('0xb');
    expect(m.get('c3')).toBeNull();
    expect(m.get('c4')).toBeNull();
  });
  it('parses consensus timestamps', () => {
    expect(consensusToDate('1700000000.123456789').toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });
});
