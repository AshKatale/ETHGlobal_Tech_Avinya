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
