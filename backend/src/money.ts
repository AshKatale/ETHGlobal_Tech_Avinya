// All money in this codebase is tinybar (1 HBAR = 10^8 tinybar) as bigint.
// Only toRpcValue() converts to weibar (18 decimals) for JSON-RPC transaction values.

const TINYBAR_PER_HBAR = 100_000_000n;
const WEIBAR_PER_TINYBAR = 10_000_000_000n;

/** "1.5" -> 150000000n. Accepts up to 8 decimals. Throws on anything else. No floats. */
export function hbarToTinybar(input: string): bigint {
  const s = input.trim();
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(s);
  if (!m) throw new Error(`Invalid HBAR amount: "${input}"`);
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? '').padEnd(8, '0') || '0');
  return whole * TINYBAR_PER_HBAR + frac;
}

/** 150000000n -> "1.5" (trailing zeros trimmed). */
export function tinybarToHbar(tinybar: bigint): string {
  if (tinybar < 0n) throw new Error('Negative amount');
  const whole = tinybar / TINYBAR_PER_HBAR;
  const frac = (tinybar % TINYBAR_PER_HBAR).toString().padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Tinybar -> weibar. The value viem/ethers/wallets send over JSON-RPC. */
export function toRpcValue(tinybar: bigint): bigint {
  return tinybar * WEIBAR_PER_TINYBAR;
}

/** Parse a decimal-string tinybar amount from JSON/DB. Rejects non-integers and negatives. */
export function parseTinybar(input: string | number | bigint): bigint {
  if (typeof input === 'bigint') {
    if (input < 0n) throw new Error('Negative amount');
    return input;
  }
  const s = String(input).trim();
  if (!/^\d+$/.test(s)) throw new Error(`Invalid tinybar amount: "${input}"`);
  return BigInt(s);
}
