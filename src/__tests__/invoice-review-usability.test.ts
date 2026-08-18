import { describe, it, expect } from "vitest";
import { stripTrailingZeros } from "../lib/invoice-validation";
import { checkLineTotalsForApproval } from "../lib/invoice-lines";

// ── stripTrailingZeros ────────────────────────────────────────────────────────

describe("stripTrailingZeros", () => {
  it("removes all trailing zeros when decimal is a whole number", () => {
    expect(stripTrailingZeros("10.0000000000")).toBe("10");
    expect(stripTrailingZeros("1.0000000000")).toBe("1");
    expect(stripTrailingZeros("7000.00000000")).toBe("7000");
    expect(stripTrailingZeros("17.00000000")).toBe("17");
  });

  it("preserves meaningful decimal digits", () => {
    expect(stripTrailingZeros("17094.02000000")).toBe("17094.02");
    expect(stripTrailingZeros("1.25")).toBe("1.25");
    expect(stripTrailingZeros("17094.02")).toBe("17094.02");
  });

  it("preserves leading significant zeros after decimal point", () => {
    expect(stripTrailingZeros("0.00012300")).toBe("0.000123");
    expect(stripTrailingZeros("0.00012345")).toBe("0.00012345");
  });

  it("returns '0' for zero values", () => {
    expect(stripTrailingZeros("0.00000000")).toBe("0");
    expect(stripTrailingZeros("0")).toBe("0");
  });

  it("returns empty string for blank or null input", () => {
    expect(stripTrailingZeros("")).toBe("");
    expect(stripTrailingZeros("   ")).toBe("");
    expect(stripTrailingZeros(null)).toBe("");
    expect(stripTrailingZeros(undefined)).toBe("");
  });

  it("passes through integers unchanged", () => {
    expect(stripTrailingZeros("1234")).toBe("1234");
    expect(stripTrailingZeros("1000000")).toBe("1000000");
  });

  it("handles values without trailing zeros unchanged", () => {
    expect(stripTrailingZeros("1.5")).toBe("1.5");
    expect(stripTrailingZeros("3.14")).toBe("3.14");
  });
});

// ── checkLineTotalsForApproval ────────────────────────────────────────────────

describe("checkLineTotalsForApproval", () => {
  // Case A: all line VAT and gross are blank — only net is checked
  it("allows approval when line net sums match header and all line VAT/gross are blank", () => {
    const lines = [
      { netAmount: "7000", vatAmount: null, grossAmount: null },
      { netAmount: "7000", vatAmount: null, grossAmount: null },
    ];
    const header = { net: "14000", vat: "2520", gross: "16520" };
    expect(checkLineTotalsForApproval(lines, header, "fiat")).toBe("ok");
  });

  it("allows approval when vatAmount is empty string (blank treated as absent)", () => {
    const lines = [
      { netAmount: "7000", vatAmount: "", grossAmount: "" },
      { netAmount: "7000", vatAmount: "", grossAmount: "" },
    ];
    const header = { net: "14000", vat: "2520", gross: "16520" };
    expect(checkLineTotalsForApproval(lines, header, "fiat")).toBe("ok");
  });

  // Case C: line net mismatch — always blocks
  it("returns net-mismatch when line net sums do not match header net", () => {
    const lines = [
      { netAmount: "7000", vatAmount: null, grossAmount: null },
      { netAmount: "5000", vatAmount: null, grossAmount: null },
    ];
    const header = { net: "14000", vat: "2520", gross: "16520" };
    expect(checkLineTotalsForApproval(lines, header, "fiat")).toBe("net-mismatch");
  });

  // Case B: line VAT values present and sum mismatches header VAT — blocks
  it("returns vat-mismatch when line VAT is present but sums contradict header VAT", () => {
    const lines = [
      { netAmount: "7000", vatAmount: "1000", grossAmount: null },
      { netAmount: "7000", vatAmount: "1000", grossAmount: null },
    ];
    const header = { net: "14000", vat: "2520", gross: "16520" };
    expect(checkLineTotalsForApproval(lines, header, "fiat")).toBe("vat-mismatch");
  });

  // Case B: line gross values present and sum mismatches header gross — blocks
  it("returns gross-mismatch when line gross is present but sums contradict header gross", () => {
    const lines = [
      { netAmount: "7000", vatAmount: null, grossAmount: "7500" },
      { netAmount: "7000", vatAmount: null, grossAmount: "7500" },
    ];
    const header = { net: "14000", vat: "2520", gross: "16520" };
    expect(checkLineTotalsForApproval(lines, header, "fiat")).toBe("gross-mismatch");
  });

  // Full match — all fields present and consistent
  it("allows approval when all line net/VAT/gross sums match headers exactly", () => {
    const lines = [
      { netAmount: "7000", vatAmount: "1260", grossAmount: "8260" },
      { netAmount: "7000", vatAmount: "1260", grossAmount: "8260" },
    ];
    const header = { net: "14000", vat: "2520", gross: "16520" };
    expect(checkLineTotalsForApproval(lines, header, "fiat")).toBe("ok");
  });

  // Case D: mixed partial VAT — conservative (partial sum mismatch blocks)
  it("blocks when some lines have VAT but total does not match header VAT", () => {
    const lines = [
      { netAmount: "7000", vatAmount: "1260", grossAmount: null },
      { netAmount: "7000", vatAmount: null, grossAmount: null },
    ];
    const header = { net: "14000", vat: "2520", gross: "16520" };
    // anyLineVat = true, lineVat sum = 1260 ≠ 2520
    expect(checkLineTotalsForApproval(lines, header, "fiat")).toBe("vat-mismatch");
  });

  // No lines — always ok
  it("returns ok when there are no lines", () => {
    expect(checkLineTotalsForApproval([], { net: "14000", vat: "2520", gross: "16520" }, "fiat")).toBe("ok");
  });

  // Fiat tolerance: small rounding differences within 0.01 are accepted
  it("allows approval within fiat tolerance (0.01 rounding)", () => {
    const lines = [
      { netAmount: "7000.005", vatAmount: null, grossAmount: null },
      { netAmount: "6999.995", vatAmount: null, grossAmount: null },
    ];
    const header = { net: "14000", vat: "0", gross: "14000" };
    expect(checkLineTotalsForApproval(lines, header, "fiat")).toBe("ok");
  });
});
