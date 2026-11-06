import { describe, expect, it } from 'vitest';
import { benchmarkChecks, dependencyCheck, secretsScan, buildConfig } from './customChecks.js';
import { extractJson } from './nvidia.js';
import { parseRepoUrl } from './github.js';

describe('custom checks', () => {
  it('flags a leaked private key and passes clean code', () => {
    expect(secretsScan({ 'a.ts': 'const privateKey = "0x' + 'a'.repeat(64) + '"' }).passed).toBe(false);
    expect(secretsScan({ 'a.ts': 'export const x = 1' }).passed).toBe(true);
  });
  it('flags unpinned dependencies', () => {
    expect(dependencyCheck({ 'package.json': '{"dependencies":{"foo":"*"}}' }).passed).toBe(false);
    expect(dependencyCheck({ 'package.json': '{"dependencies":{"foo":"^1.2.3"}}' }).passed).toBe(true);
  });
  it('checks build config', () => {
    expect(buildConfig({ 'package.json': '{"scripts":{"build":"tsc"}}' }).passed).toBe(true);
    expect(buildConfig({ 'index.ts': '' }).passed).toBe(false);
  });
  it('scores a decent repo on benchmark checks', () => {
    const readme = 'Solidity builder agent. '.repeat(20);
    const items = benchmarkChecks(
      { 'README.md': readme, 'package.json': '{"name":"x"}', 'src/agent.ts': 'solidity builder' },
      ['solidity-build'],
    );
    expect(items.every((i) => i.passed)).toBe(true);
  });
});

describe('extractJson', () => {
  it('handles fenced and chatty output', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
    expect(() => extractJson('no json here')).toThrow();
    // trailing text containing braces must not break parsing
    expect(extractJson('{"a":"x}y"} and then {not json}')).toEqual({ a: 'x}y' });
  });
});

describe('parseRepoUrl', () => {
  it('parses common GitHub URLs', () => {
    expect(parseRepoUrl('https://github.com/foo/bar')).toEqual({ owner: 'foo', repo: 'bar' });
    expect(parseRepoUrl('https://github.com/foo/bar.git')).toEqual({ owner: 'foo', repo: 'bar' });
    expect(parseRepoUrl('https://github.com/foo/bar/tree/main/x')).toEqual({ owner: 'foo', repo: 'bar' });
    expect(() => parseRepoUrl('https://example.com/foo/bar')).toThrow();
  });
});

import { githubErrorMessage } from './github.js';
describe('github errors', () => {
  it('explains each failure', () => {
    expect(githubErrorMessage(404, false)).toMatch(/connect GitHub/);
    expect(githubErrorMessage(404, true)).toMatch(/cannot access/);
    expect(githubErrorMessage(403, false, '0')).toMatch(/rate limit/);
    expect(githubErrorMessage(401, true)).toMatch(/reconnect/);
    expect(githubErrorMessage(500, true)).toBe('GitHub error 500');
  });
});
