import { describe, expect, it } from 'vitest';
import { splitSubmission } from './submissionFiles.js';

describe('splitSubmission', () => {
  it('keeps unmarked text as one file', () => {
    expect(splitSubmission('contract A {}')).toEqual({ 'submission.txt': 'contract A {}' });
  });
  it('splits files by FILE markers and strips the marker lines', () => {
    const f = splitSubmission('// FILE: src/A.sol\ncontract A {}\n// FILE: .solhint.json\n{"extends":"solhint:recommended"}\n');
    expect(Object.keys(f)).toEqual(['src/A.sol', '.solhint.json']);
    expect(f['src/A.sol']).toBe('contract A {}\n');
  });
  it('ignores path tricks and keeps the text', () => {
    expect(Object.keys(splitSubmission('// FILE: ../../etc/passwd\nx'))).toEqual(['submission.txt']);
  });
  it('keeps text written before the first marker', () => {
    const f = splitSubmission('intro\n// FILE: a.txt\nbody');
    expect(Object.keys(f)).toEqual(['submission.txt', 'a.txt']);
  });
});
