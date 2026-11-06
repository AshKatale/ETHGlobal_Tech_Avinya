import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { assertSafeUrl, isBlockedAddress, safeFetch, SsrfError } from './ssrf.js';

const fake = (addrs: string[]) => async () => addrs;

describe('isBlockedAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '64:ff9b::7f00:1', '2002:7f00:1::1'])(
    'blocks %s', (ip) => expect(isBlockedAddress(ip, false)).toBe(true));
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111'])('allows public %s', (ip) => expect(isBlockedAddress(ip, false)).toBe(false));
  it('allows loopback/private only with allowLocal, never link-local', () => {
    expect(isBlockedAddress('127.0.0.1', true)).toBe(false);
    expect(isBlockedAddress('::1', true)).toBe(false);
    expect(isBlockedAddress('10.0.0.5', true)).toBe(false);
    expect(isBlockedAddress('169.254.169.254', true)).toBe(true);
  });
});

describe('assertSafeUrl', () => {
  it('rejects non-http schemes', async () => {
    for (const u of ['file:///etc/passwd', 'ftp://x.com/', 'gopher://x', 'javascript:alert(1)']) {
      await expect(assertSafeUrl(u, fake(['8.8.8.8']), false)).rejects.toThrow(SsrfError);
    }
  });
  it('rejects hosts resolving to private addresses, including mixed answers', async () => {
    await expect(assertSafeUrl('http://evil.example/', fake(['127.0.0.1']), false)).rejects.toThrow(/Blocked address/);
    await expect(assertSafeUrl('http://evil.example/', fake(['8.8.8.8', '10.0.0.1']), false)).rejects.toThrow(/Blocked address/);
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data', fake([]), false)).rejects.toThrow(/Blocked address/);
    await expect(assertSafeUrl('http://[::1]:4101/', fake([]), false)).rejects.toThrow(/Blocked address/);
    await expect(assertSafeUrl('http://2130706433/', fake(['127.0.0.1']), false)).rejects.toThrow(/Blocked address/); // decimal-encoded loopback
  });
  it('rejects credentials in the URL and unresolvable hosts', async () => {
    await expect(assertSafeUrl('http://u:p@x.example/', fake(['8.8.8.8']), false)).rejects.toThrow(/Credentials/);
    await expect(assertSafeUrl('http://x.example/', async () => { throw new Error('ENOTFOUND'); }, false)).rejects.toThrow(/Cannot resolve/);
  });
  it('accepts a public host, and loopback when allowLocal', async () => {
    await expect(assertSafeUrl('https://agent.example/x', fake(['93.184.216.34']), false)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeUrl('http://localhost:4101', fake(['127.0.0.1']), true)).resolves.toBeInstanceOf(URL);
  });
});

describe('safeFetch (default config: ALLOW_LOCAL_AGENTS off)', () => {
  it('refuses a real loopback server', async () => {
    const srv = createServer((_q, r) => r.end('secret'));
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = (srv.address() as AddressInfo).port;
    try {
      await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(SsrfError);
      await expect(safeFetch(`http://localhost:${port}/`)).rejects.toThrow(SsrfError);
    } finally { srv.close(); }
  });
});

describe('safeFetch limits (allowLocal for a loopback test server)', () => {
  const serve = async (h: Parameters<typeof createServer>[1]) => {
    const srv = createServer(h);
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    return { srv, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/` };
  };
  it('returns small bodies', async () => {
    const { srv, url } = await serve((_q, r) => r.end('{"ok":1}'));
    try { expect((await safeFetch(url, {}, { allowLocal: true })).text).toBe('{"ok":1}'); } finally { srv.close(); }
  });
  it('caps response size', async () => {
    const { srv, url } = await serve((_q, r) => { r.write('x'.repeat(5000)); r.end('y'.repeat(5000)); });
    try { await expect(safeFetch(url, {}, { allowLocal: true, maxBytes: 1000 })).rejects.toThrow(/too large|exceeded/); } finally { srv.close(); }
  });
  it('refuses redirects (e.g. to metadata)', async () => {
    const { srv, url } = await serve((_q, r) => { r.statusCode = 302; r.setHeader('location', 'http://169.254.169.254/'); r.end(); });
    try { await expect(safeFetch(url, {}, { allowLocal: true })).rejects.toThrow(/redirect/); } finally { srv.close(); }
  });
  it('times out', async () => {
    const { srv, url } = await serve(() => { /* never answers */ });
    try { await expect(safeFetch(url, {}, { allowLocal: true, timeoutMs: 150 })).rejects.toThrow(); } finally { srv.closeAllConnections(); srv.close(); }
  });
});

describe('safeFetch DNS pinning', () => {
  it('refuses a hostname that resolves to loopback at connect time (localhost, default config)', async () => {
    const srv = createServer((_q, r) => r.end('x'));
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = (srv.address() as AddressInfo).port;
    try {
      // allowLocal=false via opts: the connect-time lookup itself must reject, even if the first check were bypassed
      await expect(safeFetch(`http://localhost:${port}/`, {}, { allowLocal: false })).rejects.toThrow(SsrfError);
    } finally { srv.close(); }
  });
});
