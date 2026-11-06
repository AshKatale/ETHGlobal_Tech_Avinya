export const shorten = (v: string, head = 6, tail = 4) =>
  v.length > head + tail + 3 ? `${v.slice(0, head)}...${v.slice(-tail)}` : v;

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "n/a");

export const scoreText = (s: string | null) => {
  if (s == null) return "n/a";
  const n = Number.parseFloat(s); // display only, never money
  return Number.isFinite(n) ? `${Math.round(n)}` : "n/a";
};

/** Convert a user-typed HBAR string to a tinybar string; returns null if invalid. */
export function parseHbarInput(v: string): string | null {
  const t = v.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return (BigInt(w) * 100_000_000n + BigInt(f.padEnd(8, "0"))).toString();
}

export interface CheckItem {
  name: string;
  passed: boolean | null;
  detail: string | null;
}
/** items shape is not documented in api.md; read defensively ([VERIFY] {name, passed, detail}). */
export function toItems(items: unknown): CheckItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((it, i) => {
    const o = (it ?? {}) as Record<string, unknown>;
    const name = String(o.name ?? o.check ?? o.id ?? `Check ${i + 1}`);
    const passedRaw = o.passed ?? o.pass ?? (o.result != null ? String(o.result).toUpperCase() === "PASS" : null);
    const detail = o.detail ?? o.details ?? o.message ?? o.reason;
    return { name, passed: typeof passedRaw === "boolean" ? passedRaw : null, detail: detail != null ? String(detail) : null };
  });
}

/** Countdown text for a number of seconds, e.g. 90061 -> "1 d 1 h 1 min". Never negative. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d ? `${d} d` : "", h ? `${h} h` : "", `${m} min`].filter(Boolean).join(" ");
}

/** Cap percent from the API (agreement, then /config); null when unknown. */
export function pickCapPercent(...candidates: (number | null | undefined)[]): number | null {
  for (const c of candidates) if (typeof c === "number" && Number.isFinite(c) && c >= 0) return c;
  return null;
}

/** Cap in tinybar (bigint) for a percent; no floats. Integer percents only; fractions are floored. */
export function capTinybar(priceTinybar: string, percent: number): bigint {
  return (BigInt(priceTinybar) * BigInt(Math.floor(percent))) / 100n;
}

/** Remaining seconds from a 409 refund-timeout body, or null. */
export function remainingSecondsFrom(body: Record<string, unknown> | undefined): number | null {
  const v = body?.remainingSeconds;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Audit entry display: amount for a delegation is tinybar (caller formats it); verdict is PASS/FAIL. */
export function isTinybarString(v: string): boolean {
  return /^\d+$/.test(v);
}
