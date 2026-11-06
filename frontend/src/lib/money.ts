// Money helpers. Backend amounts are tinybar strings (1 HBAR = 10^8 tinybar).
// The EVM JSON-RPC relay uses weibar (18 decimals): 1 tinybar = 10^10 weibar.
// No floats anywhere in this file.

const TINYBAR_PER_HBAR = 100_000_000n;
const HBAR_DECIMALS = 8;
const WEIBAR_PER_TINYBAR = 10n ** 10n;

/** "150000000" -> "1.5". Trailing zeros trimmed. Throws on non-integer input. */
export function tinybarToHbar(tinybar: string): string {
  if (!/^\d+$/.test(tinybar)) throw new Error(`Invalid tinybar amount: ${tinybar}`);
  const v = BigInt(tinybar);
  const whole = v / TINYBAR_PER_HBAR;
  const frac = (v % TINYBAR_PER_HBAR).toString().padStart(HBAR_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** "1.5" -> "150000000". Throws on bad input or more than 8 decimals. */
export function hbarToTinybar(hbar: string): string {
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(hbar.trim());
  if (!m) throw new Error(`Invalid HBAR amount: ${hbar}`);
  const frac = (m[2] ?? "").padEnd(HBAR_DECIMALS, "0");
  return (BigInt(m[1]) * TINYBAR_PER_HBAR + BigInt(frac)).toString();
}

/** Tinybar bigint -> weibar bigint, for a transaction `value` only. */
export function toRpcValue(tinybar: bigint): bigint {
  return tinybar * WEIBAR_PER_TINYBAR;
}

/** Display string, e.g. "1.5 HBAR". */
export function formatHbar(tinybar: string): string {
  return `${tinybarToHbar(tinybar)} HBAR`;
}
