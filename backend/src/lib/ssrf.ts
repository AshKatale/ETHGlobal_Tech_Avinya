// SSRF guard for every outbound call to a lister-supplied endpointUrl (quote, tasks, a2a).
// http/https only; the host is resolved and refused if ANY address is private, loopback, link-local or otherwise internal,
// unless ALLOW_LOCAL_AGENTS=true (demo agents on localhost). Redirects are never followed. Timeout and response size cap enforced.
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
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
    if (lower.startsWith('64:ff9b:')) return true; // NAT64 can reach IPv4 internals
    if (lower.startsWith('2002:')) return true; // 6to4
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

/**
 * fetch() for lister-supplied URLs: guarded, no redirects, timeout, capped body.
 * Uses node:http(s) with a custom `lookup` that validates the address at connect time and connects to exactly
 * that address, so a DNS-rebinding answer cannot differ between check and use.
 */
export async function safeFetch(
  raw: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  opts: { timeoutMs?: number; maxBytes?: number; allowLocal?: boolean } = {},
): Promise<SafeResponse> {
  const allowLocal = opts.allowLocal ?? env.ALLOW_LOCAL_AGENTS === 'true';
  const url = await assertSafeUrl(raw, defaultResolver, allowLocal);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const doRequest = url.protocol === 'https:' ? httpsRequest : httpRequest;

  const pinnedLookup = ((hostname: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) => {
    lookup(hostname, { all: true, verbatim: true }).then((rows) => {
      const bad = rows.find((r) => isBlockedAddress(r.address, allowLocal));
      if (bad || rows.length === 0) return cb(new SsrfError(`Blocked address ${bad?.address ?? '(none)'} for host ${hostname}`));
      if (options.all) return cb(null, rows);
      cb(null, rows[0].address, rows[0].family);
    }, (e) => cb(e));
  }) as never;

  return new Promise<SafeResponse>((resolve, reject) => {
    const req = doRequest(url, { method: init.method ?? 'GET', headers: init.headers, lookup: pinnedLookup, timeout: timeoutMs }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { res.destroy(); return reject(new SsrfError(`Refusing to follow redirect (${status})`)); }
      const declared = Number(res.headers['content-length'] ?? 0);
      if (declared > maxBytes) { res.destroy(); return reject(new SsrfError(`Response too large (${declared} bytes)`)); }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (c: Buffer) => {
        total += c.length;
        if (total > maxBytes) { res.destroy(); reject(new SsrfError(`Response exceeded ${maxBytes} bytes`)); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status, ok: status >= 200 && status < 300, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`Timed out after ${timeoutMs} ms`)));
    req.on('error', reject);
    // Hard wall-clock cap in addition to the socket idle timeout.
    const wall = setTimeout(() => req.destroy(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
    req.on('close', () => clearTimeout(wall));
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}
