import { describe, expect, it } from 'vitest';
import { createThrottle, hashPassword, passwordProblem, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const h = await hashPassword('correct horse 9');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain('correct horse');
    expect(await verifyPassword('correct horse 9', h)).toBe(true);
    expect(await verifyPassword('correct horse 8', h)).toBe(false);
  });
  it('salts: the same password hashes differently each time', async () => {
    expect(await hashPassword('same-pass-1')).not.toBe(await hashPassword('same-pass-1'));
  });
  it('rejects a malformed stored hash instead of throwing', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('password policy', () => {
  it('requires length, a letter and a number', () => {
    expect(passwordProblem('short1')).toMatch(/8/);
    expect(passwordProblem('onlyletters')).toMatch(/number/);
    expect(passwordProblem('12345678')).toMatch(/letter/);
    expect(passwordProblem('long enough 1')).toBeNull();
  });
});

describe('login throttle', () => {
  it('blocks after 5 failures, clears on success, and expires', () => {
    let t = 0;
    const th = createThrottle(() => t);
    for (let i = 0; i < 4; i++) th.fail('a');
    expect(th.blockedFor('a')).toBe(0);
    th.fail('a');
    expect(th.blockedFor('a')).toBeGreaterThan(0);
    expect(th.blockedFor('b')).toBe(0);
    t += 16 * 60 * 1000;
    expect(th.blockedFor('a')).toBe(0);
    th.fail('a'); th.clear('a');
    expect(th.blockedFor('a')).toBe(0);
  });
});
