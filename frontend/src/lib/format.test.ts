import { describe, expect, it } from "vitest";
import { capTinybar, formatCountdown, isTinybarString, parseHbarInput, pickCapPercent, remainingSecondsFrom, toItems } from "./format";

describe("format", () => {
  it("parses HBAR input without floats", () => {
    expect(parseHbarInput("1.5")).toBe("150000000");
    expect(parseHbarInput("5")).toBe("500000000");
    expect(parseHbarInput("1.123456789")).toBeNull();
    expect(parseHbarInput("-1")).toBeNull();
    expect(parseHbarInput("")).toBeNull();
  });
  it("reads items defensively", () => {
    expect(toItems(null)).toEqual([]);
    expect(toItems([{ name: "a", passed: true, detail: "ok" }, { x: 1 }])).toEqual([
      { name: "a", passed: true, detail: "ok" },
      { name: "Check 2", passed: null, detail: null },
    ]);
  });
  it("formats countdowns", () => {
    expect(formatCountdown(45)).toBe("45 s");
    expect(formatCountdown(90061)).toBe("1 d 1 h 1 min");
    expect(formatCountdown(-5)).toBe("0 s");
    expect(formatCountdown(3600)).toBe("1 h 0 min");
  });
  it("picks the first valid cap percent", () => {
    expect(pickCapPercent(undefined, 30)).toBe(30);
    expect(pickCapPercent(25, 30)).toBe(25);
    expect(pickCapPercent(null, undefined)).toBeNull();
    expect(pickCapPercent(Number.NaN, 10)).toBe(10);
  });
  it("computes the cap without floats", () => {
    expect(capTinybar("100000000", 30)).toBe(30000000n);
    expect(capTinybar("150000000", 30)).toBe(45000000n);
  });
  it("reads remainingSeconds", () => {
    expect(remainingSecondsFrom({ remainingSeconds: 120 })).toBe(120);
    expect(remainingSecondsFrom({ remainingSeconds: "x" })).toBeNull();
    expect(remainingSecondsFrom(undefined)).toBeNull();
  });
  it("detects tinybar strings", () => {
    expect(isTinybarString("100000")).toBe(true);
    expect(isTinybarString("PASS")).toBe(false);
  });
});
