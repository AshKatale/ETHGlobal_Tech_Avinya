import { describe, expect, it } from "vitest";
import { formatHbar, hbarToTinybar, tinybarToHbar, toRpcValue } from "./money";

describe("money", () => {
  it("150000000 tinybar is 1.5 HBAR", () => {
    expect(tinybarToHbar("150000000")).toBe("1.5");
    expect(formatHbar("150000000")).toBe("1.5 HBAR");
  });
  it("handles zero, whole and tiny amounts", () => {
    expect(tinybarToHbar("0")).toBe("0");
    expect(tinybarToHbar("100000000")).toBe("1");
    expect(tinybarToHbar("1")).toBe("0.00000001");
  });
  it("handles amounts beyond float precision", () => {
    expect(tinybarToHbar("9007199254740993123456789")).toBe("90071992547409931.23456789");
  });
  it("hbarToTinybar round-trips", () => {
    expect(hbarToTinybar("1.5")).toBe("150000000");
    expect(hbarToTinybar("2")).toBe("200000000");
    expect(hbarToTinybar("0.00000001")).toBe("1");
    expect(tinybarToHbar(hbarToTinybar("123.45678901"))).toBe("123.45678901");
  });
  it("rejects bad input", () => {
    expect(() => tinybarToHbar("1.5")).toThrow();
    expect(() => tinybarToHbar("-1")).toThrow();
    expect(() => hbarToTinybar("1.123456789")).toThrow();
    expect(() => hbarToTinybar("abc")).toThrow();
  });
  it("toRpcValue multiplies by 10^10", () => {
    expect(toRpcValue(150000000n)).toBe(1_500_000_000_000_000_000n);
    expect(toRpcValue(0n)).toBe(0n);
  });
});
