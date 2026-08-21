import { describe, expect, it } from "vitest";
import { reconcileAiInvoiceExtraction } from "@/src/lib/ai-invoice-reconciliation";
import type { AiInvoiceExtraction } from "@/src/lib/ai-extraction";

// Helper to build a minimal valid extraction
function makeExtraction(overrides: Partial<AiInvoiceExtraction> = {}): AiInvoiceExtraction {
  return {
    vendorOriginal: null,
    vendorNormalized: null,
    vendorTaxId: null,
    invoiceNumber: null,
    invoiceDate: null,
    dueDate: null,
    currency: null,
    netAmount: null,
    vatAmount: null,
    grossAmount: null,
    lines: [],
    ...overrides,
  };
}

function makeLine(overrides: Partial<AiInvoiceExtraction["lines"][number]> = {}): AiInvoiceExtraction["lines"][number] {
  return {
    lineNumber: null,
    descriptionOriginal: null,
    description: null,
    quantity: null,
    unit: null,
    unitPrice: null,
    netAmount: null,
    vatRate: null,
    vatAmount: null,
    grossAmount: null,
    sourcePage: null,
    ...overrides,
  };
}

// ── Test 1: Already correct ────────────────────────────────────────────────────
describe("Test 1 — already correct (matched)", () => {
  it("returns matched and leaves extraction unchanged when line sums already agree", () => {
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: "950",
      grossAmount: "5950",
      lines: [
        makeLine({ netAmount: "4000", vatAmount: "760", grossAmount: "4760" }),
        makeLine({ netAmount: "1000", vatAmount: "190", grossAmount: "1190" }),
      ],
    });

    const { extraction: out, reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");

    expect(reconciliation.kind).toBe("matched");
    expect(out.lines[0].netAmount).toBe("4000");
    expect(out.lines[0].vatAmount).toBe("760");
    expect(out.lines[0].grossAmount).toBe("4760");
    expect(out.lines[1].netAmount).toBe("1000");
    expect(out.lines[1].vatAmount).toBe("190");
    expect(out.lines[1].grossAmount).toBe("1190");
  });
});

// ── Test 2: Header-only VAT prorata ───────────────────────────────────────────
describe("Test 2 — header-only VAT prorata (vat-prorated)", () => {
  it("allocates header VAT proportionally across line nets", () => {
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: "950",
      grossAmount: "5950",
      lines: [
        makeLine({ netAmount: "4000" }),
        makeLine({ netAmount: "1000" }),
      ],
    });

    const { extraction: out, reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");

    expect(reconciliation.kind).toBe("vat-prorated");

    // Line A
    expect(out.lines[0].netAmount).toBe("4000");
    expect(out.lines[0].vatAmount).toBe("760.00");
    expect(out.lines[0].grossAmount).toBe("4760.00");

    // Line B
    expect(out.lines[1].netAmount).toBe("1000");
    expect(out.lines[1].vatAmount).toBe("190.00");
    expect(out.lines[1].grossAmount).toBe("1190.00");
  });

  it("does not modify non-monetary line fields", () => {
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: "950",
      grossAmount: "5950",
      lines: [
        makeLine({ netAmount: "4000", description: "Service A", lineNumber: "1" }),
        makeLine({ netAmount: "1000", description: "Service B", lineNumber: "2" }),
      ],
    });

    const { extraction: out } = reconcileAiInvoiceExtraction(extraction, "fiat");

    expect(out.lines[0].description).toBe("Service A");
    expect(out.lines[0].lineNumber).toBe("1");
    expect(out.lines[1].description).toBe("Service B");
  });
});

// ── Test 3: VAT rounding residual ─────────────────────────────────────────────
describe("Test 3 — VAT rounding residual", () => {
  it("assigns residual to final line so Σ VAT = header VAT exactly", () => {
    // 3 equal lines: each 1/3 of net → fractional-cent allocation
    const extraction = makeExtraction({
      netAmount: "3",
      vatAmount: "1",
      grossAmount: "4",
      lines: [
        makeLine({ netAmount: "1" }),
        makeLine({ netAmount: "1" }),
        makeLine({ netAmount: "1" }),
      ],
    });

    const { extraction: out, reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");

    expect(reconciliation.kind).toBe("vat-prorated");

    const totalVat = out.lines.reduce((s, l) => {
      return s + parseFloat(l.vatAmount ?? "0");
    }, 0);
    // Must equal header VAT exactly
    expect(totalVat.toFixed(2)).toBe("1.00");

    const totalGross = out.lines.reduce((s, l) => {
      return s + parseFloat(l.grossAmount ?? "0");
    }, 0);
    expect(totalGross.toFixed(2)).toBe("4.00");
  });

  it("uses residual on the final line (deterministic assignment)", () => {
    // headerVat=10, 2 lines each with 1/3 of net: produces non-trivial residual
    const extraction = makeExtraction({
      netAmount: "3",
      vatAmount: "10",
      grossAmount: "13",
      lines: [
        makeLine({ netAmount: "1" }),
        makeLine({ netAmount: "2" }),
      ],
    });

    const { extraction: out } = reconcileAiInvoiceExtraction(extraction, "fiat");

    // Line 0: 10 * 1/3 = 3.33...  → rounds to 3.33
    expect(out.lines[0].vatAmount).toBe("3.33");
    // Line 1 (final): 10 - 3.33 = 6.67
    expect(out.lines[1].vatAmount).toBe("6.67");
  });
});

// ── Test 4: Mixed explicit VAT rates → no automatic proration ─────────────────
describe("Test 4 — mixed explicit VAT rates", () => {
  it("does not prorate when lines have distinct non-null VAT rates", () => {
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: "950",
      grossAmount: "5950",
      lines: [
        makeLine({ netAmount: "4000", vatRate: "0" }),
        makeLine({ netAmount: "1000", vatRate: "19" }),
      ],
    });

    const { extraction: out, reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");

    // Must NOT prorate
    expect(reconciliation.kind).not.toBe("vat-prorated");
    // Extraction unchanged
    expect(out.lines[0].vatAmount).toBeNull();
    expect(out.lines[1].vatAmount).toBeNull();
  });
});

// ── Test 5: Gross mistakenly stored as net (gross-reclassified) ────────────────
describe("Test 5 — gross-as-net reinterpretation", () => {
  it("detects and corrects HiTech-CarFix-style extraction", () => {
    // Header: net=5000, vat=950, gross=5950
    // AI lines: A netAmount=4760, B netAmount=1190 (those are actually gross values)
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: "950",
      grossAmount: "5950",
      lines: [
        makeLine({ netAmount: "4760" }),
        makeLine({ netAmount: "1190" }),
      ],
    });

    const { extraction: out, reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");

    expect(reconciliation.kind).toBe("gross-reclassified");

    // Line A: gross=4760, net=4760*5000/5950=4000, vat=760
    expect(out.lines[0].grossAmount).toBe("4760.00");
    expect(out.lines[0].netAmount).toBe("4000.00");
    expect(out.lines[0].vatAmount).toBe("760.00");

    // Line B: gross=1190, net=1190*5000/5950=1000, vat=190
    expect(out.lines[1].grossAmount).toBe("1190.00");
    expect(out.lines[1].netAmount).toBe("1000.00");
    expect(out.lines[1].vatAmount).toBe("190.00");
  });

  it("revalidation totals after gross-reclassified transformation", () => {
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: "950",
      grossAmount: "5950",
      lines: [
        makeLine({ netAmount: "4760" }),
        makeLine({ netAmount: "1190" }),
      ],
    });

    const { extraction: out } = reconcileAiInvoiceExtraction(extraction, "fiat");

    const sumNets = out.lines.reduce((s, l) => s + parseFloat(l.netAmount ?? "0"), 0);
    const sumVats = out.lines.reduce((s, l) => s + parseFloat(l.vatAmount ?? "0"), 0);
    const sumGrosses = out.lines.reduce((s, l) => s + parseFloat(l.grossAmount ?? "0"), 0);

    expect(Math.abs(sumNets - 5000)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(sumVats - 950)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(sumGrosses - 5950)).toBeLessThanOrEqual(0.01);
  });

  it("does not modify non-monetary fields", () => {
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: "950",
      grossAmount: "5950",
      lines: [
        makeLine({ netAmount: "4760", description: "Part A", quantity: "2" }),
        makeLine({ netAmount: "1190", description: "Part B" }),
      ],
    });

    const { extraction: out } = reconcileAiInvoiceExtraction(extraction, "fiat");

    expect(out.lines[0].description).toBe("Part A");
    expect(out.lines[0].quantity).toBe("2");
    expect(out.lines[0].unitPrice).toBeNull();
  });
});

// ── Test 6: Gross-as-net false-positive protection ────────────────────────────
describe("Test 6 — gross-as-net false-positive protection", () => {
  it("does NOT reinterpret line nets as gross when Σ net ≈ header net", () => {
    // If line nets sum to header net, do not treat them as gross
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: "950",
      grossAmount: "5950",
      lines: [
        makeLine({ netAmount: "4000" }),
        makeLine({ netAmount: "1000" }),
      ],
    });

    const { reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");

    expect(reconciliation.kind).not.toBe("gross-reclassified");
    // Should be vat-prorated, not gross-reclassified
    expect(reconciliation.kind).toBe("vat-prorated");
  });
});

// ── Test 7: Existing explicit line gross/VAT protection ────────────────────────
describe("Test 7 — existing per-line gross/VAT protection", () => {
  it("does not overwrite meaningful nonzero line vat/gross with gross-as-net logic", () => {
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: "950",
      grossAmount: "5950",
      lines: [
        // Lines where extracted "net" would sum to header gross, but lines already have vatAmount
        makeLine({ netAmount: "4760", vatAmount: "760", grossAmount: "5520" }),
        makeLine({ netAmount: "1190", vatAmount: "190", grossAmount: "1380" }),
      ],
    });

    const { extraction: out, reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");

    // gross-as-net requires all line vat/gross to be null/zero; it must not fire here
    expect(reconciliation.kind).not.toBe("gross-reclassified");
    // Original values must be preserved
    expect(out.lines[0].vatAmount).toBe("760");
    expect(out.lines[1].vatAmount).toBe("190");
  });
});

// ── Test 8: Minor difference (< 1.00) ─────────────────────────────────────────
// Header: net=5000, vat=950, gross=5950
// Lines sum gross to 5949.73 → diff = -0.27 (sign: sum - header)
// Net diffs are trivially within tolerance (nets match exactly).
describe("Test 8 — minor difference", () => {
  // Line A: net=4000, vat=760, gross=4760
  // Line B: net=1000, vat=189.73, gross=1189.73
  // sumVats=949.73 (off -0.27), sumGrosses=5949.73 (off -0.27), sumNets=5000 (exact)
  const minorExtraction = makeExtraction({
    netAmount: "5000",
    vatAmount: "950",
    grossAmount: "5950",
    lines: [
      makeLine({ netAmount: "4000", vatAmount: "760", grossAmount: "4760" }),
      makeLine({ netAmount: "1000", vatAmount: "189.73", grossAmount: "1189.73" }),
    ],
  });

  it("returns minor-difference when line vat/gross sum differs by 0.27", () => {
    const { extraction: out, reconciliation } = reconcileAiInvoiceExtraction(minorExtraction, "fiat");

    expect(reconciliation.kind).toBe("minor-difference");
    // grossDifference should be negative (sum < header): 5949.73 - 5950 = -0.27
    expect(reconciliation.grossDifference).toBe("-0.27");
    const grossDiff = parseFloat(reconciliation.grossDifference!);
    expect(grossDiff).toBeLessThan(0);
    expect(Math.abs(grossDiff)).toBeLessThan(1.0);

    // Line values must be unchanged
    expect(out.lines[0].netAmount).toBe("4000");
    expect(out.lines[0].vatAmount).toBe("760");
    expect(out.lines[1].vatAmount).toBe("189.73");
  });

  it("sign convention: difference = sum(lines) - header", () => {
    const { reconciliation } = reconcileAiInvoiceExtraction(minorExtraction, "fiat");
    // sum(vats) - headerVat = 949.73 - 950 = -0.27
    expect(reconciliation.vatDifference).toBe("-0.27");
    // sum(grosses) - headerGross = 5949.73 - 5950 = -0.27
    expect(reconciliation.grossDifference).toBe("-0.27");
    // sum(nets) - headerNet = 5000 - 5000 = 0.00 (within trivial tolerance, still reported)
    expect(reconciliation.netDifference).toBe("0.00");
  });

  it("does not add any synthetic lines", () => {
    const { extraction: out, reconciliation } = reconcileAiInvoiceExtraction(minorExtraction, "fiat");

    expect(reconciliation.kind).toBe("minor-difference");
    expect(out.lines.length).toBe(2);
  });
});

// ── Test 9: Difference ≥ 1.00 is NOT minor ────────────────────────────────────
describe("Test 9 — difference exactly 1.00 or greater → review-required", () => {
  it("does not treat a 1.00 gross difference as minor", () => {
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: "950",
      grossAmount: "5950",
      lines: [
        makeLine({ netAmount: "3999", vatAmount: "759.81", grossAmount: "4758.81" }),
        makeLine({ netAmount: "1000", vatAmount: "190", grossAmount: "1190" }),
      ],
    });

    // gross sum = 4758.81 + 1190 = 5948.81, diff = -1.19 ≥ 1.00 → review-required
    const { reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");
    expect(reconciliation.kind).toBe("review-required");
  });

  it("treats exactly 1.00 difference as review-required (strictly < 1.00)", () => {
    // Craft a case where gross diff is exactly -1.00
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: "950",
      grossAmount: "5950",
      lines: [
        makeLine({ netAmount: "4000", vatAmount: "950", grossAmount: "4949" }),
        makeLine({ netAmount: "1000", vatAmount: "0", grossAmount: "1000" }),
      ],
    });

    // gross sum = 4949 + 1000 = 5949, diff = -1.00 (not strictly < 1.00)
    const { reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");
    expect(reconciliation.kind).toBe("review-required");
  });
});

// ── Test 10: Bad header arithmetic ────────────────────────────────────────────
describe("Test 10 — bad header arithmetic", () => {
  it("returns review-required and leaves extraction unchanged when header does not reconcile", () => {
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: "999",   // net + vat = 5999 ≠ 5950 gross
      grossAmount: "5950",
      lines: [
        makeLine({ netAmount: "4000" }),
        makeLine({ netAmount: "1000" }),
      ],
    });

    const { extraction: out, reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");

    expect(reconciliation.kind).toBe("review-required");
    // Lines must be unchanged
    expect(out.lines[0].netAmount).toBe("4000");
    expect(out.lines[0].vatAmount).toBeNull();
  });

  it("returns review-required when any header amount is missing", () => {
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: null,    // missing
      grossAmount: "5950",
      lines: [makeLine({ netAmount: "5000" })],
    });

    const { reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");
    expect(reconciliation.kind).toBe("review-required");
  });
});

// ── Test 11: All-zero AI lines (must NOT be changed) ──────────────────────────
describe("Test 11 — all-zero AI lines regression", () => {
  it("does not assign invoice totals to lines with all-zero amounts", () => {
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: "950",
      grossAmount: "5950",
      lines: [
        makeLine({ description: "Service A", netAmount: "0", vatAmount: null, grossAmount: null }),
        makeLine({ description: "Service B", netAmount: "0", vatAmount: null, grossAmount: null }),
      ],
    });

    const { extraction: out, reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");

    // Must NOT prorate or reclassify
    expect(reconciliation.kind).not.toBe("vat-prorated");
    expect(reconciliation.kind).not.toBe("gross-reclassified");

    // Line amounts must be unchanged
    expect(out.lines[0].netAmount).toBe("0");
    expect(out.lines[0].vatAmount).toBeNull();
    expect(out.lines[1].netAmount).toBe("0");
    expect(out.lines[1].grossAmount).toBeNull();
  });

  it("does not assign invoice totals to lines with all-null amounts", () => {
    const extraction = makeExtraction({
      netAmount: "5000",
      vatAmount: "950",
      grossAmount: "5950",
      lines: [
        makeLine({ description: "Service A" }),
        makeLine({ description: "Service B" }),
      ],
    });

    const { extraction: out } = reconcileAiInvoiceExtraction(extraction, "fiat");

    expect(out.lines[0].netAmount).toBeNull();
    expect(out.lines[0].vatAmount).toBeNull();
    expect(out.lines[0].grossAmount).toBeNull();
    expect(out.lines[1].netAmount).toBeNull();
  });
});

// ── Test 12: Crypto → no fiat transformations ──────────────────────────────────
describe("Test 12 — crypto: no fiat reconciliation", () => {
  it("returns not-applicable and leaves extraction unchanged for crypto", () => {
    const extraction = makeExtraction({
      netAmount: "1.5",
      vatAmount: "0",
      grossAmount: "1.5",
      lines: [
        makeLine({ netAmount: "2.5" }), // would trigger gross-as-net if fiat
        makeLine({ netAmount: "1.0" }),
      ],
    });

    const { extraction: out, reconciliation } = reconcileAiInvoiceExtraction(extraction, "crypto");

    expect(reconciliation.kind).toBe("not-applicable");
    // Nothing changed
    expect(out.lines[0].netAmount).toBe("2.5");
    expect(out.lines[0].vatAmount).toBeNull();
    expect(out.lines[0].grossAmount).toBeNull();
  });
});

// ── Edge: single-line all-blank VAT rate → proration allowed ──────────────────
describe("VAT rate conflict logic", () => {
  it("allows proration when all lines have null vatRate", () => {
    const extraction = makeExtraction({
      netAmount: "1000",
      vatAmount: "190",
      grossAmount: "1190",
      lines: [
        makeLine({ netAmount: "600", vatRate: null }),
        makeLine({ netAmount: "400", vatRate: null }),
      ],
    });

    const { reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");
    expect(reconciliation.kind).toBe("vat-prorated");
  });

  it("allows proration when all lines share one common vatRate", () => {
    const extraction = makeExtraction({
      netAmount: "1000",
      vatAmount: "190",
      grossAmount: "1190",
      lines: [
        makeLine({ netAmount: "600", vatRate: "19" }),
        makeLine({ netAmount: "400", vatRate: "19" }),
      ],
    });

    const { reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");
    expect(reconciliation.kind).toBe("vat-prorated");
  });

  it("blocks proration when lines have distinct vatRates", () => {
    const extraction = makeExtraction({
      netAmount: "1000",
      vatAmount: "95",
      grossAmount: "1095",
      lines: [
        makeLine({ netAmount: "600", vatRate: "0" }),
        makeLine({ netAmount: "400", vatRate: "19" }),
      ],
    });

    const { reconciliation } = reconcileAiInvoiceExtraction(extraction, "fiat");
    expect(reconciliation.kind).not.toBe("vat-prorated");
  });
});
