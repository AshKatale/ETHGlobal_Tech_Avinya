// SSRF guard for every outbound call to a lister-supplied endpointUrl (quote, tasks, a2a).
// http/https only; the host is resolved and refused if ANY address is private, loopback, link-local or otherwise internal,
// unless ALLOW_LOCAL_AGENTS=true (demo agents on localhost). Redirects are never followed. Timeout and response size cap enforced.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { env } from '../env.js';

export class SsrfError extends Error {}

export const DEFAULT_MAX_BYTES = 1_000_000;

function ipv4Blocked(ip: string, allowLocal: boolean): boolean {
  const [a, b] = ip.split('.').map(Number);
  const loopback = a === 127;
  const privateRange = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  if (allowLocal && (loopback || privateRange)) return false;
  if (loopback || privateRange) return true;
  if (a === 0) return true; // "this" network, 0.0.0.0
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 and 192.0.2.0/24 (reserved/test)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

export function isBlockedAddress(ip: string, allowLocal = env.ALLOW_LOCAL_AGENTS === 'true'): boolean {
  const v = isIP(ip);
  if (v === 4) return ipv4Blocked(ip, allowLocal);
  if (v === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipv4Blocked(mapped[1], allowLocal);
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
      return ipv4Blocked(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, allowLocal);
    }
    if (lower === '::1') return !allowLocal;
    if (lower === '::') return true;
    if (/^f[cd]/.test(lower)) return !allowLocal; // unique local fc00::/7
    if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
    if (/^ff/.test(lower)) return true; // multicast
    return false;
  }
  return true; // not an IP at all
}

type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

/** Throws SsrfError unless the URL is safe to call. Returns the parsed URL. */
export async function assertSafeUrl(raw: string, resolve: Resolver = defaultResolver, allowLocal = env.ALLOW_LOCAL_AGENTS === 'true'): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new SsrfError('Invalid URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfError(`Blocked protocol ${url.protocol}`);
  if (url.username || url.password) throw new SsrfError('Credentials in URL are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addrs: string[];
  if (isIP(host)) addrs = [host];
  else {
    try { addrs = await resolve(host); } catch { throw new SsrfError(`Cannot resolve host ${host}`); }
    if (addrs.length === 0) throw new SsrfError(`Cannot resolve host ${host}`);
  }
  for (const a of addrs) {
    if (isBlockedAddress(a, allowLocal)) throw new SsrfError(`Blocked address ${a} for host ${host}`);
  }
  return url;
}

export type SafeResponse = { status: number; ok: boolean; text: string };

/** fetch() for lister-supplied URLs: guarded, no redirects, timeout, capped body. */
export async function safeFetch(
  raw: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  opts: { timeoutMs?: number; maxBytes?: number; allowLocal?: boolean } = {},
): Promise<SafeResponse> {
  const url = await assertSafeUrl(raw, defaultResolver, opts.allowLocal ?? env.ALLOW_LOCAL_AGENTS === 'true');
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const res = await fetch(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  if (res.status >= 300 && res.status < 400) throw new SsrfError(`Refusing to follow redirect (${res.status})`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) { void res.body?.cancel(); throw new SsrfError(`Response too large (${declared} bytes)`); }
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { void reader.cancel(); throw new SsrfError(`Response exceeded ${maxBytes} bytes`); }
      chunks.push(value);
    }
  }
  return { status: res.status, ok: res.ok, text: Buffer.concat(chunks).toString('utf8') };
}
