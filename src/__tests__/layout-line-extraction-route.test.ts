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
// The byte-level pipeline is mocked, but the real merge semantics are kept so
// these tests exercise the actual deterministic-vs-AI precedence rules.
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
// the deterministic merge operates on exactly the AI lines returned above.
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

// ── Deterministic line precedence ─────────────────────────────────────────────

describe("deterministic layout lines over born-digital PDFs", () => {
  it("lets confident deterministic values win and AI fill only unresolved fields", async () => {
    mockExtractLayout.mockResolvedValue(
      detResult([
        detLine(),
        detLine({ descriptionOriginal: "Support", netAmount: "50", sourceRowIndex: 2 }),
      ]),
    );
    fetchSpy.mockImplementation(() =>
      aiOkResponse([AI_LINE, { ...AI_LINE, lineNumber: "2" }]),
    );

    const res = await POST(makeRequest(1), params(1));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockReadDocument).toHaveBeenCalledWith("/uploads/invoice.pdf");
    expect(body.extraction.lines).toHaveLength(2);
    const line = body.extraction.lines[0];
    // Deterministic non-null values win over conflicting AI values.
    expect(line.descriptionOriginal).toBe("Consulting");
    expect(line.quantity).toBe("2");
    expect(line.unitPrice).toBe("100");
    expect(line.netAmount).toBe("200");
    expect(line.sourcePage).toBe(1);
    // Null deterministic fields are filled from the aligned AI line.
    expect(line.lineNumber).toBe("1");
    expect(line.unit).toBe("pcs");
    expect(line.vatRate).toBe("5");
    expect(line.vatAmount).toBe("1.11");
    expect(line.grossAmount).toBe("1000.00");
    expect(line.description).toBe("English description");
    // Header fields remain the AI/provider output.
    expect(body.extraction.invoiceNumber).toBe("INV-001");
  });

  it("does not guess AI pairings when line counts make alignment unsafe", async () => {
    mockExtractLayout.mockResolvedValue(
      detResult([
        detLine(),
        detLine({ descriptionOriginal: "Support", netAmount: "50", sourceRowIndex: 2 }),
      ]),
    );
    fetchSpy.mockImplementation(() => aiOkResponse([AI_LINE]));

    const res = await POST(makeRequest(1), params(1));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.extraction.lines).toHaveLength(2);
    const line = body.extraction.lines[0];
    expect(line.netAmount).toBe("200");
    expect(line.lineNumber).toBeNull();
    expect(line.unit).toBeNull();
    expect(line.vatRate).toBeNull();
    expect(line.grossAmount).toBeNull();
    expect(line.description).toBeNull();
    expect(body.extraction.lines[1].descriptionOriginal).toBe("Support");
  });

  it("runs reconciliation on the final merged extraction, not the raw AI lines", async () => {
    mockGetDb.mockReturnValue(makeDbWithDigitalPdf("fiat"));
    // Deterministic nets reconcile to the AI header; the raw AI line nets do
    // not, so a pre-merge reconciliation would report review-required.
    mockExtractLayout.mockResolvedValue(
      detResult([
        detLine(),
        detLine({ descriptionOriginal: "Support", netAmount: "50", sourceRowIndex: 2 }),
      ]),
    );
    const sparseAiLine = {
      ...AI_LINE,
      netAmount: "999.99",
      vatRate: null,
      vatAmount: null,
      grossAmount: null,
    };
    fetchSpy.mockImplementation(() =>
      aiOkResponse([sparseAiLine, { ...sparseAiLine, lineNumber: "2" }], {
        netAmount: "250.00",
        vatAmount: "0.00",
        grossAmount: "250.00",
      }),
    );

    const res = await POST(makeRequest(1), params(1));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Only possible when reconciliation saw the merged deterministic nets.
    expect(body.reconciliation.kind).toBe("vat-prorated");
    // The returned lines carry the reconciliation transform on top of the
    // merged deterministic values.
    expect(body.extraction.lines).toHaveLength(2);
    expect(body.extraction.lines[0].netAmount).toBe("200");
    expect(body.extraction.lines[0].vatAmount).toBe("0.00");
    expect(body.extraction.lines[0].grossAmount).toBe("200.00");
    expect(body.extraction.lines[1].netAmount).toBe("50");
    expect(body.extraction.lines[1].grossAmount).toBe("50.00");
  });

  it("keeps the AI lines exactly when deterministic rows are numeric-only", async () => {
    // Numeric-only deterministic rows fail the usefulness gate and must not
    // displace the AI fallback.
    mockExtractLayout.mockResolvedValue(
      detResult(
        [
          detLine({ descriptionOriginal: null }),
          detLine({ descriptionOriginal: null, netAmount: "50", sourceRowIndex: 2 }),
        ],
        false,
      ),
    );
    fetchSpy.mockImplementation(() =>
      aiOkResponse([AI_LINE, { ...AI_LINE, lineNumber: "2" }]),
    );

    const res = await POST(makeRequest(1), params(1));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.extraction.lines).toEqual([AI_LINE, { ...AI_LINE, lineNumber: "2" }]);
  });

  it("falls back to the AI path unchanged when layout extraction fails", async () => {
    mockExtractLayout.mockRejectedValue(new Error("pdfjs exploded"));
    fetchSpy.mockImplementation(() => aiOkResponse([AI_LINE]));

    const res = await POST(makeRequest(1), params(1));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.extraction.lines).toEqual([AI_LINE]);
    expect(body.extraction.invoiceNumber).toBe("INV-001");
  });

  it("keeps the AI path when the document bytes cannot be read", async () => {
    mockReadDocument.mockRejectedValue(new Error("storage unavailable"));
    fetchSpy.mockImplementation(() => aiOkResponse([AI_LINE]));

    const res = await POST(makeRequest(1), params(1));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.extraction.lines).toEqual([AI_LINE]);
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
