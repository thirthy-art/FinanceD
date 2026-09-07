import { describe, expect, it } from "vitest";
import { isValidDateOnly, validateDateRange } from "./validation";

describe("payment ledger date validation", () => {
  it.each(["2026-01-31", "2024-02-29"])("accepts real date %s", (date) => expect(isValidDateOnly(date)).toBe(true));
  it.each(["2026-99-99", "2026-02-29", "2026-02-30", "01-01-2026"])("rejects impossible or noncanonical date %s", (date) => expect(isValidDateOnly(date)).toBe(false));
  it("rejects backwards and impossible effective ranges", () => {
    expect(() => validateDateRange("2026-02-30", null)).toThrow(/real date/);
    expect(() => validateDateRange("2026-03-01", "2026-02-28")).toThrow(/on or after/);
  });
});
