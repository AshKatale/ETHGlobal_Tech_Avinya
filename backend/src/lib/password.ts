import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Passwords are hashed with scrypt (built into Node, so no extra dependency): a random salt per password,
// stored as "scrypt$N$r$p$salt$hash". The plain password is never stored or logged.
const N = 16384, R = 8, P = 1, KEYLEN = 64;

const derive = (password: string, salt: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((resolve, reject) => {
    const opts: ScryptOptions = { N: n, r, p, maxmem: 64 * 1024 * 1024 };
    scrypt(password, salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await derive(password, Buffer.from(saltHex, 'hex'), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Returns a readable problem, or null if the password is acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 128) return 'Use at most 128 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use at least one letter and one number.';
  return null;
}

// ---- failed-attempt limiter (in memory: resets on restart, fine for one server) ----
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

export function createThrottle(now: () => number = Date.now) {
  const fails = new Map<string, { n: number; since: number }>();
  const live = (key: string) => {
    const f = fails.get(key);
    if (f && now() - f.since > WINDOW_MS) { fails.delete(key); return undefined; }
    return f;
  };
  return {
    /** Seconds to wait, or 0 if another attempt is allowed. */
    blockedFor(key: string): number {
      const f = live(key);
      return f && f.n >= MAX_FAILS ? Math.ceil((f.since + WINDOW_MS - now()) / 1000) : 0;
    },
    fail(key: string) { const f = live(key); fails.set(key, { n: (f?.n ?? 0) + 1, since: f?.since ?? now() }); },
    clear(key: string) { fails.delete(key); },
  };
}

export const loginThrottle = createThrottle();
