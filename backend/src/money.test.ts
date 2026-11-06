import { describe, expect, it } from 'vitest';
import { hbarToTinybar, tinybarToHbar, toRpcValue, parseTinybar } from './money.js';

describe('money', () => {
  it('converts HBAR strings to tinybar without floats', () => {
    expect(hbarToTinybar('1.5')).toBe(150000000n);
    expect(hbarToTinybar('0.00000001')).toBe(1n);
    expect(hbarToTinybar('10')).toBe(1000000000n);
  });
  it('rejects bad input', () => {
    expect(() => hbarToTinybar('1.123456789')).toThrow();
    expect(() => hbarToTinybar('-1')).toThrow();
    expect(() => hbarToTinybar('abc')).toThrow();
  });
  it('formats tinybar as HBAR', () => {
    expect(tinybarToHbar(150000000n)).toBe('1.5');
    expect(tinybarToHbar(100000000n)).toBe('1');
    expect(tinybarToHbar(1n)).toBe('0.00000001');
  });
  it('converts tinybar to weibar only in toRpcValue', () => {
    expect(toRpcValue(1n)).toBe(10_000_000_000n);
    expect(toRpcValue(hbarToTinybar('1'))).toBe(10n ** 18n);
  });
  it('parses tinybar strings strictly', () => {
    expect(parseTinybar('123')).toBe(123n);
    expect(() => parseTinybar('1.5')).toThrow();
  });
});
