import { describe, expect, it } from "vitest";
import { parseHbarInput, toItems } from "./format";

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
});
