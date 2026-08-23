import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// ── Module mocks ──────────────────────────────────────────────────────────────
// vi.mock calls are hoisted by Vitest and run before any imports.

vi.mock("pdf-parse", () => ({ PDFParse: vi.fn() }));
vi.mock("@/src/db", () => ({ getDb: vi.fn() }));
vi.mock("@/src/lib/active-company", () => ({
  getActiveCompanyFromRequest: vi.fn().mockResolvedValue({ id: 1, baseCurrency: "EUR" }),
}));
vi.mock("@/src/lib/ai-provider", () => ({ getAiProviderCandidates: vi.fn() }));
vi.mock("@/src/lib/document-storage", () => ({
  readDocument: vi.fn(),
  DocumentNotFoundError: class DocumentNotFoundError extends Error {},
}));
// The byte-level pipeline is mocked so these tests can prove the AI route
// never invokes deterministic layout extraction at all.
vi.mock("@/src/lib/experimental/layout-line-extraction", async (importActual) => {
  const actual =
    await importActual<typeof import("@/src/lib/experimental/layout-line-extraction")>();
  return { ...actual, extractDeterministicLayoutInvoiceLines: vi.fn() };
});

// ── Imports after mocks ───────────────────────────────────────────────────────
import { PDFParse } from "pdf-parse";
import { getDb } from "@/src/db";
import { getAiProviderCandidates } from "@/src/lib/ai-provider";
import { readDocument } from "@/src/lib/document-storage";
import {
  LAYOUT_LINE_EXTRACTOR_VERSION,
  extractDeterministicLayoutInvoiceLines,
  type DeterministicInvoiceLine,
  type LayoutLineExtractionResult,
} from "@/src/lib/experimental/layout-line-extraction";
import { POST } from "@/app/api/invoices/[id]/extract/route";

const MockPDFParse = vi.mocked(PDFParse);
const mockGetDb = vi.mocked(getDb);
const mockGetAiProviderCandidates = vi.mocked(getAiProviderCandidates);
const mockReadDocument = vi.mocked(readDocument);
const mockExtractLayout = vi.mocked(extractDeterministicLayoutInvoiceLines);

// ── Helpers ───────────────────────────────────────────────────────────────────

interface AiLineFixture {
  lineNumber: string | null;
  descriptionOriginal: string | null;
  description: string | null;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  netAmount: string | null;
  vatRate: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  sourcePage: number | null;
}

const AI_LINE: AiLineFixture = {
  lineNumber: "1",
  descriptionOriginal: "AI description",
  description: "English description",
  quantity: "99",
  unit: "pcs",
  unitPrice: "0.01",
  netAmount: "999.99",
  vatRate: "5",
  vatAmount: "1.11",
  grossAmount: "1000.00",
  sourcePage: 2,
};

function aiExtractionWithLines(
  lines: AiLineFixture[],
  header: { netAmount: string | null; vatAmount: string | null; grossAmount: string | null } = {
    netAmount: null,
    vatAmount: null,
    grossAmount: null,
  },
) {
  return JSON.stringify({
    vendorOriginal: "Acme Ltd",
    vendorNormalized: "Acme Ltd",
    vendorTaxId: null,
    invoiceNumber: "INV-001",
    invoiceDate: "2024-01-15",
    dueDate: null,
    currency: "USD",
    ...header,
    lines,
  });
}

function aiOkResponse(
  lines: AiLineFixture[],
  header?: { netAmount: string | null; vatAmount: string | null; grossAmount: string | null },
) {
  return Promise.resolve(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: aiExtractionWithLines(lines, header) } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
}

// currencyType "crypto" keeps reconcileAiInvoiceExtraction a pass-through so
// the response carries exactly the AI lines returned above.
function makeDbWithDigitalPdf(currencyType: "fiat" | "crypto" = "crypto") {
  const document = {
    mimeType: "application/pdf",
    storagePath: "/uploads/invoice.pdf",
    extractedText: "ACME Corp\nInvoice: INV-001",
    currencyType,
  };
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([document]),
          }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof getDb>;
}

function providerConfig() {
  return {
    provider: "legacy-openai-compatible" as const,
    model: "gpt-4o",
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: "sk-test",
    fallbackLevel: 0 as const,
  };
}

function makeRequest(invoiceId: number, mode?: "image") {
  return new Request(
    `http://localhost/api/invoices/${invoiceId}/extract${mode ? `?mode=${mode}` : ""}`,
    { method: "POST" },
  );
}

function params(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function detLine(overrides: Partial<DeterministicInvoiceLine> = {}): DeterministicInvoiceLine {
  return {
    lineNumber: null,
    descriptionOriginal: "Consulting",
    quantity: "2",
    unit: null,
    unitPrice: "100",
    netAmount: "200",
    vatRate: null,
    vatAmount: null,
    grossAmount: null,
    sourcePage: 1,
    sourceCandidateId: "cand-1",
    sourceRowIndex: 1,
    rowEvidenceElementIds: ["pdf-text:p1-e000003"],
    fieldEvidenceElementIds: { netAmount: ["pdf-text:p1-e000005"] },
    ...overrides,
  };
}

function detResult(
  lines: DeterministicInvoiceLine[],
  useful = true,
): LayoutLineExtractionResult {
  return {
    extractorVersion: LAYOUT_LINE_EXTRACTOR_VERSION,
    logicalTableId: "logical-001",
    columnFields: { 1: "descriptionOriginal", 2: "quantity" },
    lines,
    diagnostics: {
      unmappedHeaderTexts: [],
      unsupportedHeaderTexts: [],
      conflictingFields: [],
      uncertainCellCount: 0,
    },
    useful,
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy = vi.spyOn(globalThis, "fetch");
  mockGetAiProviderCandidates.mockResolvedValue([providerConfig()]);
  mockGetDb.mockReturnValue(makeDbWithDigitalPdf());
  mockReadDocument.mockResolvedValue(Buffer.from("PDF bytes"));
});

// ── AI extraction independence ────────────────────────────────────────────────

describe("AI extraction independence from deterministic layout lines", () => {
  it("never invokes deterministic layout extraction and returns the AI lines unchanged", async () => {
    // Even a useful deterministic result must not leak into the AI preview.
    mockExtractLayout.mockResolvedValue(detResult([detLine()], true));
    fetchSpy.mockImplementation(() =>
      aiOkResponse([AI_LINE, { ...AI_LINE, lineNumber: "2" }]),
    );

    const res = await POST(makeRequest(1), params(1));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockExtractLayout).not.toHaveBeenCalled();
    // The digital text path no longer reads the document bytes at all.
    expect(mockReadDocument).not.toHaveBeenCalled();
    expect(body.extraction.lines).toEqual([AI_LINE, { ...AI_LINE, lineNumber: "2" }]);
    expect(body.extraction.invoiceNumber).toBe("INV-001");
  });

  it("reconciles the AI extraction itself", async () => {
    mockGetDb.mockReturnValue(makeDbWithDigitalPdf("fiat"));
    const sparseAiLine = {
      ...AI_LINE,
      netAmount: "200.00",
      vatRate: null,
      vatAmount: null,
      grossAmount: null,
    };
    fetchSpy.mockImplementation(() =>
      aiOkResponse(
        [sparseAiLine, { ...sparseAiLine, lineNumber: "2", netAmount: "50.00" }],
        { netAmount: "250.00", vatAmount: "0.00", grossAmount: "250.00" },
      ),
    );

    const res = await POST(makeRequest(1), params(1));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockExtractLayout).not.toHaveBeenCalled();
    // Reconciliation metadata describes the AI output: the AI line nets match
    // the AI header, so the header VAT is prorated across the AI lines.
    expect(body.reconciliation.kind).toBe("vat-prorated");
    expect(body.extraction.lines).toHaveLength(2);
    expect(body.extraction.lines[0].netAmount).toBe("200.00");
    expect(body.extraction.lines[0].vatAmount).toBe("0.00");
    expect(body.extraction.lines[0].grossAmount).toBe("200.00");
    expect(body.extraction.lines[1].netAmount).toBe("50.00");
    expect(body.extraction.lines[1].grossAmount).toBe("50.00");
  });
});

// ── Scanned / forced-image behavior unchanged ────────────────────────────────

describe("scanned and forced-image behavior", () => {
  function installPDFParseMock() {
    const getScreenshot = vi.fn().mockResolvedValue({
      pages: [
        {
          dataUrl: "data:image/png;base64,PAGE1",
          pageNumber: 1,
          data: new Uint8Array(0),
          width: 1600,
          height: 2000,
          scale: 1,
        },
      ],
      total: 1,
    });
    const destroy = vi.fn().mockResolvedValue(undefined);
    MockPDFParse.mockImplementation(function (this: unknown) {
      return { getScreenshot, destroy } as unknown as InstanceType<typeof PDFParse>;
    } as unknown as new (...args: unknown[]) => InstanceType<typeof PDFParse>);
  }

  it("never runs layout extraction when mode=image is requested", async () => {
    installPDFParseMock();
    fetchSpy.mockImplementation(() => aiOkResponse([AI_LINE]));

    const res = await POST(makeRequest(1, "image"), params(1));
    expect(res.status).toBe(200);
    expect(mockExtractLayout).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.extraction.lines).toEqual([AI_LINE]);
  });

  it("never runs layout extraction for PDFs without embedded text", async () => {
    mockGetDb.mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  mimeType: "application/pdf",
                  storagePath: "/uploads/scanned.pdf",
                  extractedText: null,
                  currencyType: "crypto",
                },
              ]),
            }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>);
    installPDFParseMock();
    fetchSpy.mockImplementation(() => aiOkResponse([AI_LINE]));

    const res = await POST(makeRequest(1), params(1));
    expect(res.status).toBe(200);
    expect(mockExtractLayout).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.extraction.lines).toEqual([AI_LINE]);
  });
});
