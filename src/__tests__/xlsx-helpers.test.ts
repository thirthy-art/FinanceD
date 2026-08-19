import { describe, expect, it } from "vitest";
import { decimalCellValue, excelDateFromString } from "@/src/lib/xlsx-helpers";

describe("decimalCellValue", () => {
  it("converts a normal fiat value to a JS number", () => {
    expect(decimalCellValue("1234.56")).toBe(1234.56);
  });

  it("converts a safe <= 15-significant-digit value to a JS number", () => {
    // 15 significant digits — stays within Excel precision limit
    const v = decimalCellValue("0.123456789012345");
    expect(typeof v).toBe("number");
    expect(v).toBe(0.123456789012345);
  });

  it("preserves a 16-significant-digit value as an exact string", () => {
    // 16 significant digits — exceeds the sd() <= 15 guard
    const v = decimalCellValue("0.1234567890123456");
    expect(typeof v).toBe("string");
    expect(v).toBe("0.1234567890123456");
  });

  it("preserves a high-precision crypto value as an exact string", () => {
    const v = decimalCellValue("0.123456789012345678");
    expect(typeof v).toBe("string");
    expect(v).toBe("0.123456789012345678");
  });

  it("returns null for null input", () => {
    expect(decimalCellValue(null)).toBeNull();
  });

  it("returns null for blank string", () => {
    expect(decimalCellValue("")).toBeNull();
    expect(decimalCellValue("   ")).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(decimalCellValue("not-a-number")).toBeNull();
    expect(decimalCellValue("abc")).toBeNull();
  });
});

describe("excelDateFromString", () => {
  it("converts a valid YYYY-MM-DD string to a UTC midnight Date", () => {
    const d = excelDateFromString("2026-08-15");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("returns null for null input", () => {
    expect(excelDateFromString(null)).toBeNull();
  });

  it("returns null for blank string", () => {
    expect(excelDateFromString("")).toBeNull();
  });

  it("returns null for a non-date string", () => {
    expect(excelDateFromString("not-a-date")).toBeNull();
    expect(excelDateFromString("2026-13-01")).toBeNull();
  });

  it("returns null for a partial date string", () => {
    expect(excelDateFromString("2026-08")).toBeNull();
    expect(excelDateFromString("2026")).toBeNull();
  });
});
