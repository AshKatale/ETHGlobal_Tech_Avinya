import { describe, expect, it } from 'vitest';
import { publicBlockedReason, publicSubmission, publicVerdict, publicVerification } from './access.js';

describe('S-09 public views', () => {
  it('submission keeps hash and kind, drops content', () => {
    const p = publicSubmission({ id: 'i', agreementId: 'a', content: 'SECRET WORK', kind: 'text', deliverableHash: 'h', submittedAt: new Date(0) });
    expect(JSON.stringify(p)).not.toContain('SECRET');
    expect(p).toMatchObject({ deliverableHash: 'h', kind: 'text' });
    expect(publicSubmission(undefined)).toBeNull();
  });
  it('verdict keeps signature, nonce, tx hash and drops the raw settle error', () => {
    const p = publicVerdict({ id: 'v', agreementId: 'a', result: 'PASS', verifierSig: '0xsig', nonce: 5n, settleTxHash: '0xtx', settleError: 'viem: secret rpc url', createdAt: new Date(0) });
    expect(p).toMatchObject({ verifierSig: '0xsig', nonce: 5n, settleTxHash: '0xtx', settleError: null });
  });
  it('verification drops error, summary and item detail but keeps result and report root', () => {
    const p = publicVerification({ id: 'x', agreementId: 'a', result: 'ERROR', items: [{ name: 'n', passed: true, detail: 'quotes the secret' }], summary: 's', error: 'ECONNREFUSED 10.0.0.5', reportRoot: '0xroot', createdAt: new Date(0) });
    expect(JSON.stringify(p)).not.toMatch(/secret|ECONNREFUSED/);
    expect(p).toMatchObject({ result: 'ERROR', reportRoot: '0xroot', items: [{ name: 'n', passed: true, detail: '' }] });
  });
  it('blocked reason: our fixed strings stay, upstream text goes', () => {
    expect(publicBlockedReason('Would exceed the 30% A2A budget for this job')).toMatch(/Would exceed/);
    expect(publicBlockedReason('Callee failed after payment')).not.toBeNull();
    expect(publicBlockedReason('callee responded 500: <html>internal 10.0.0.1</html>')).toBeNull();
    expect(publicBlockedReason(null)).toBeNull();
  });
});
