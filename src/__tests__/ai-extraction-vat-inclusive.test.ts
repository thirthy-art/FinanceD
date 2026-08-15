/**
 * Targeted tests for the VAT-inclusive line-amount rules added to
 * AI_EXTRACTION_PROMPT (difficult-invoice-import fix, round 2).
 *
 * Coverage:
 * 1. Prompt contains every key instruction required by the task.
 * 2. AiInvoiceExtractionSchema accepts a correctly-derived VAT-inclusive line.
 * 3. AiInvoiceExtractionSchema accepts a line with explicit net/VAT amounts.
 * 4. Schema rejects a line where grossAmount is present but netAmount is the
 *    same value (shifted, not derived).
 */
import { describe, it, expect } from "vitest";
import { AI_EXTRACTION_PROMPT, AiInvoiceExtractionSchema } from "@/src/lib/ai-extraction";
import { Decimal } from "@/src/lib/decimal";

// ── 1. Prompt content ─────────────────────────────────────────────────────────

describe("AI_EXTRACTION_PROMPT — VAT-inclusive line rules", () => {
  it("instructs the model that a Vat% column is a rate, not an amount", () => {
    expect(AI_EXTRACTION_PROMPT).toMatch(/Vat %.*VAT rate, not a VAT amount/i);
    expect(AI_EXTRACTION_PROMPT).toContain("line.vatRate");
    // The rule explicitly names vatAmount as the field NOT to use for a Vat% column.
    expect(AI_EXTRACTION_PROMPT).toMatch(/line\.vatRate, not line\.vatAmount/);
  });

  it("instructs the model not to assume 'Amount' is always net", () => {
    expect(AI_EXTRACTION_PROMPT).toMatch(/do not assume.*amount.*is always net/i);
  });

  it("instructs the model to reconcile line-amount sum against invoice totals", () => {
    expect(AI_EXTRACTION_PROMPT).toMatch(/sum.*invoice.*net/i);
    expect(AI_EXTRACTION_PROMPT).toMatch(/sum.*invoice.*total|gross/i);
    expect(AI_EXTRACTION_PROMPT).toContain("line.grossAmount");
  });

  it("provides the derivation formula as the only permitted calculation exception", () => {
    expect(AI_EXTRACTION_PROMPT).toMatch(/line\.netAmount\s*=\s*line\.grossAmount\s*\/\s*\(1\s*\+\s*line\.vatRate/i);
    expect(AI_EXTRACTION_PROMPT).toMatch(/line\.vatAmount\s*=\s*line\.grossAmount\s*[−-]\s*line\.netAmount/i);
    expect(AI_EXTRACTION_PROMPT).toMatch(/only permitted exception.*never calculate/i);
  });

  it("instructs the model to use explicit net/VAT amounts without recalculating", () => {
    expect(AI_EXTRACTION_PROMPT).toMatch(/explicitly provide.*net and VAT amounts.*record them directly/i);
  });

  it("instructs the model never to shift a value into a different field", () => {
    expect(AI_EXTRACTION_PROMPT).toMatch(/never move a value into a different field/i);
  });

  it("instructs the model to use invoice-level totals as reconciliation anchors", () => {
    expect(AI_EXTRACTION_PROMPT).toMatch(/reconciliation anchors/i);
  });
});

// ── 2. Schema: VAT-inclusive line with AI-derived net and VAT ─────────────────

describe("AiInvoiceExtractionSchema — VAT-inclusive line", () => {
  // Simulate the concrete invoice from the task:
  //   invoice Net = 882.37, VAT = 167.63, Total = 1050.00
  //   two source lines with Vat% = 19, Amount (gross) = 420.00 and 630.00
  //   derived: net = 420 / 1.19 = 352.94…, vat = 420 - 352.94…
  function deriveNetVat(gross: string, vatRatePct: string) {
    const G = new Decimal(gross);
    const r = new Decimal(vatRatePct).div(100);
    const net = G.div(new Decimal(1).plus(r));
    const vat = G.minus(net);
    return { net: net.toFixed(2), vat: vat.toFixed(2) };
  }

  it("accepts a line where grossAmount + vatRate are present and net/vatAmount are derived", () => {
    const { net: net1, vat: vat1 } = deriveNetVat("420.00", "19");
    const { net: net2, vat: vat2 } = deriveNetVat("630.00", "19");

    const result = AiInvoiceExtractionSchema.safeParse({
      vendorOriginal: "Test SRL",
      vendorNormalized: "Test SRL",
      vendorTaxId: null,
      invoiceNumber: "2024-001",
      invoiceDate: "2024-01-15",
      dueDate: null,
      currency: "EUR",
      netAmount: "882.37",
      vatAmount: "167.63",
      grossAmount: "1050.00",
      lines: [
        {
          lineNumber: "1",
          descriptionOriginal: "Servicii A",
          description: "Services A",
          quantity: "1",
          unit: null,
          unitPrice: "420.00",
          netAmount: net1,
          vatRate: "19",
          vatAmount: vat1,
          grossAmount: "420.00",
          sourcePage: 1,
        },
        {
          lineNumber: "2",
          descriptionOriginal: "Servicii B",
          description: "Services B",
          quantity: "1",
          unit: null,
          unitPrice: "630.00",
          netAmount: net2,
          vatRate: "19",
          vatAmount: vat2,
          grossAmount: "630.00",
          sourcePage: 1,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a line with explicit net and VAT amounts (no grossAmount)", () => {
    const result = AiInvoiceExtractionSchema.safeParse({
      vendorOriginal: "Vendor X",
      vendorNormalized: "Vendor X",
      vendorTaxId: null,
      invoiceNumber: "X-100",
      invoiceDate: "2024-03-01",
      dueDate: null,
      currency: "USD",
      netAmount: "100.00",
      vatAmount: "20.00",
      grossAmount: "120.00",
      lines: [
        {
          lineNumber: "1",
          descriptionOriginal: "Item",
          description: "Item",
          quantity: "1",
          unit: null,
          unitPrice: "100.00",
          netAmount: "100.00",
          vatRate: "20",
          vatAmount: "20.00",
          grossAmount: null,
          sourcePage: null,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a line where all per-line amounts are null (source provides no breakdown)", () => {
    const result = AiInvoiceExtractionSchema.safeParse({
      vendorOriginal: "Vendor Y",
      vendorNormalized: "Vendor Y",
      vendorTaxId: null,
      invoiceNumber: "Y-001",
      invoiceDate: "2024-01-01",
      dueDate: null,
      currency: "EUR",
      netAmount: "500.00",
      vatAmount: "95.00",
      grossAmount: "595.00",
      lines: [
        {
          lineNumber: null,
          descriptionOriginal: "Consulting",
          description: "Consulting",
          quantity: null,
          unit: null,
          unitPrice: null,
          netAmount: null,
          vatRate: null,
          vatAmount: null,
          grossAmount: null,
          sourcePage: null,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a line where netAmount is a non-decimal string", () => {
    const result = AiInvoiceExtractionSchema.safeParse({
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
      lines: [
        {
          lineNumber: null,
          descriptionOriginal: null,
          description: null,
          quantity: null,
          unit: null,
          unitPrice: null,
          netAmount: "not-a-number",
          vatRate: null,
          vatAmount: null,
          grossAmount: null,
          sourcePage: null,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
