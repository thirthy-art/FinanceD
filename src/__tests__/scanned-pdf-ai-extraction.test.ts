import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// ── Module mocks ──────────────────────────────────────────────────────────────
// vi.mock calls are hoisted by Vitest and run before any imports.

vi.mock("pdf-parse", () => ({ PDFParse: vi.fn() }));
// Deterministic layout extraction is exercised in its own focused tests; here
// it always reports no useful lines so the AI path remains the only behavior.
vi.mock("@/src/lib/experimental/layout-line-extraction", () => ({
  extractDeterministicLayoutInvoiceLines: vi.fn().mockResolvedValue(null),
  mergeDeterministicWithAiLines: vi.fn(),
}));
vi.mock("@/src/db", () => ({ getDb: vi.fn() }));
vi.mock("@/src/lib/active-company", () => ({
  getActiveCompanyFromRequest: vi.fn().mockResolvedValue({ id: 1, baseCurrency: "EUR" }),
}));
vi.mock("@/src/lib/ai-provider", () => ({ getAiProviderCandidates: vi.fn() }));
vi.mock("@/src/lib/document-storage", () => ({
  readDocument: vi.fn(),
  DocumentNotFoundError: class DocumentNotFoundError extends Error {},
}));

// ── Imports after mocks ───────────────────────────────────────────────────────
import { PDFParse } from "pdf-parse";
import { getDb } from "@/src/db";
import { getAiProviderCandidates } from "@/src/lib/ai-provider";
import { DocumentNotFoundError, readDocument } from "@/src/lib/document-storage";
import { AI_EXTRACTION_PROMPT } from "@/src/lib/ai-extraction";
import { POST } from "@/app/api/invoices/[id]/extract/route";

const MockPDFParse = vi.mocked(PDFParse);
const mockGetDb = vi.mocked(getDb);
const mockGetAiProviderCandidates = vi.mocked(getAiProviderCandidates);
const mockReadDocument = vi.mocked(readDocument);

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_AI_EXTRACTION = JSON.stringify({
  vendorOriginal: "Acme Ltd",
  vendorNormalized: "Acme Ltd",
  vendorTaxId: null,
  invoiceNumber: "INV-001",
  invoiceDate: "2024-01-15",
  dueDate: null,
  currency: "USD",
  netAmount: "100.00",
  vatAmount: null,
  grossAmount: "100.00",
  lines: [],
});

function aiOkResponse() {
  return Promise.resolve(
    new Response(
      JSON.stringify({ choices: [{ message: { content: VALID_AI_EXTRACTION } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
}

function makeDbWithDocument(doc: {
  mimeType: string;
  storagePath: string;
  extractedText: string | null;
}) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ ...doc, currencyType: "fiat" }]),
          }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof getDb>;
}

function imageCapableConfig() {
  return {
    provider: "legacy-openai-compatible" as const,
    model: "gpt-4o",
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: "sk-test",
    fallbackLevel: 0 as const,
  };
}

function imageIncapableConfig() {
  return {
    provider: "mimo-direct" as const,
    model: "mimo-v2.5-pro",
    endpoint: "https://api.xiaomimimo.com/v1/chat/completions",
    apiKey: "mimo-key",
    fallbackLevel: 0 as const,
  };
}

function makeRequest(invoiceId: number, mode?: "image") {
  return new Request(`http://localhost/api/invoices/${invoiceId}/extract${mode ? `?mode=${mode}` : ""}`, {
    method: "POST",
  });
}

function params(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function makeScreenshotResult(pages: Array<{ dataUrl: string; pageNumber: number }>) {
  return {
    pages: pages.map((p) => ({
      dataUrl: p.dataUrl,
      pageNumber: p.pageNumber,
      data: new Uint8Array(0),
      width: 1600,
      height: 2000,
      scale: 1,
    })),
    total: pages.length,
  };
}

// Install a PDFParse constructor mock that returns a controlled instance.
// Must use a regular function (not arrow) so it can act as a constructor.
function installPDFParseMock(getScreenshot: ReturnType<typeof vi.fn>, destroy: ReturnType<typeof vi.fn>) {
  MockPDFParse.mockImplementation(function (this: unknown) {
    return { getScreenshot, destroy } as unknown as InstanceType<typeof PDFParse>;
  } as unknown as new (...args: unknown[]) => InstanceType<typeof PDFParse>);
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

// ── 1. Digital PDF with extracted text ────────────────────────────────────────

describe("digital PDF with extracted text", () => {
  it("returns sanitized 503 JSON when provider settings lookup fails", async () => {
    mockGetAiProviderCandidates.mockRejectedValueOnce(new Error("database details must not escape"));
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/invoice.pdf",
        extractedText: "embedded text",
      }),
    );
    const res = await POST(makeRequest(1), params(1));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "AI extraction configuration is temporarily unavailable." });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends text to AI without calling getScreenshot", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageCapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/invoice.pdf",
        extractedText: "ACME Corp\nInvoice: INV-001",
      }),
    );
    fetchSpy.mockImplementation(aiOkResponse);

    const res = await POST(makeRequest(1), params(1));

    expect(res.status).toBe(200);

    // PDFParse must not have been instantiated, and the digital text path
    // never reads the PDF bytes at all.
    expect(MockPDFParse).not.toHaveBeenCalled();
    expect(mockReadDocument).not.toHaveBeenCalled();

    // AI fetch body must contain extracted text, not image_url items
    const fetchBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userContent = fetchBody.messages.find((m: { role: string }) => m.role === "user").content;
    expect(typeof userContent).toBe("string");
    expect(userContent).toContain("INVOICE TEXT START");
    expect(userContent).toContain("INV-001");
    expect(userContent).toContain(AI_EXTRACTION_PROMPT);
  });

  it("returns extraction matching the existing schema contract", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageCapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/invoice.pdf",
        extractedText: "Some embedded text",
      }),
    );
    fetchSpy.mockImplementation(aiOkResponse);

    const res = await POST(makeRequest(1), params(1));
    const body = await res.json();

    expect(body.extraction.vendorOriginal).toBe("Acme Ltd");
    expect(body.extraction.invoiceNumber).toBe("INV-001");
    expect(body.extraction.lines).toEqual([]);
  });
});

// ── 2. Forced image mode for a digital PDF ───────────────────────────────────

describe("digital PDF with forced image mode", () => {
  it("ignores extracted text and sends rendered pages in document order", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageCapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "object:companies/1/invoice-documents/digital.pdf",
        extractedText: "This text must not be sent",
      }),
    );
    mockReadDocument.mockResolvedValue(Buffer.from("PDF bytes"));
    installPDFParseMock(
      vi.fn().mockResolvedValue(
        makeScreenshotResult([
          { dataUrl: "data:image/png;base64,PAGE1", pageNumber: 1 },
          { dataUrl: "data:image/png;base64,PAGE2", pageNumber: 2 },
        ]),
      ),
      vi.fn().mockResolvedValue(undefined),
    );
    fetchSpy.mockImplementation(aiOkResponse);

    const res = await POST(makeRequest(1, "image"), params(1));

    expect(res.status).toBe(200);
    expect(mockReadDocument).toHaveBeenCalledWith("object:companies/1/invoice-documents/digital.pdf");
    expect(MockPDFParse).toHaveBeenCalledOnce();

    const fetchBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userContent = fetchBody.messages.find((m: { role: string }) => m.role === "user").content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(userContent.filter((item) => item.type === "image_url").map((item) => item.image_url?.url)).toEqual([
      "data:image/png;base64,PAGE1",
      "data:image/png;base64,PAGE2",
    ]);
    expect(JSON.stringify(userContent)).not.toContain("This text must not be sent");
  });

  it("keeps the image-model guard and does not call the provider", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageIncapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/digital.pdf",
        extractedText: "Usable embedded text",
      }),
    );

    const res = await POST(makeRequest(1, "image"), params(1));

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "The configured AI model does not support image input. Choose an image-capable model for scanned PDF invoices.",
    });
    expect(mockReadDocument).not.toHaveBeenCalled();
    expect(MockPDFParse).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the reconciled extraction and reconciliation metadata", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageCapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/digital.pdf",
        extractedText: "Usable embedded text",
      }),
    );
    mockReadDocument.mockResolvedValue(Buffer.from("PDF bytes"));
    installPDFParseMock(
      vi.fn().mockResolvedValue(
        makeScreenshotResult([{ dataUrl: "data:image/png;base64,PAGE1", pageNumber: 1 }]),
      ),
      vi.fn().mockResolvedValue(undefined),
    );
    const extractionForReconciliation = {
      ...JSON.parse(VALID_AI_EXTRACTION),
      netAmount: "100.00",
      vatAmount: "20.00",
      grossAmount: "120.00",
      lines: [
        {
          lineNumber: "1", descriptionOriginal: "A", description: "A", quantity: null, unit: null,
          unitPrice: null, netAmount: "60.00", vatRate: null, vatAmount: null, grossAmount: null, sourcePage: 1,
        },
        {
          lineNumber: "2", descriptionOriginal: "B", description: "B", quantity: null, unit: null,
          unitPrice: null, netAmount: "40.00", vatRate: null, vatAmount: null, grossAmount: null, sourcePage: 1,
        },
      ],
    };
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(extractionForReconciliation) } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await POST(makeRequest(1, "image"), params(1));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reconciliation).toEqual({ kind: "vat-prorated" });
    expect(body.extraction.lines).toEqual([
      expect.objectContaining({ netAmount: "60.00", vatAmount: "12.00", grossAmount: "72.00" }),
      expect.objectContaining({ netAmount: "40.00", vatAmount: "8.00", grossAmount: "48.00" }),
    ]);
  });
});

// ── 3. Scanned PDF with blank extracted text ──────────────────────────────────

describe("scanned PDF with blank extracted text", () => {
  it("renders PDF pages and sends them as image inputs", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageCapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "object:companies/1/invoice-documents/scanned.pdf",
        extractedText: null,
      }),
    );
    mockReadDocument.mockResolvedValue(Buffer.from("PDF bytes"));

    const mockGetScreenshot = vi.fn().mockResolvedValue(
      makeScreenshotResult([{ dataUrl: "data:image/png;base64,PAGE1DATA", pageNumber: 1 }]),
    );
    const mockDestroy = vi.fn().mockResolvedValue(undefined);
    installPDFParseMock(mockGetScreenshot, mockDestroy);

    fetchSpy.mockImplementation(aiOkResponse);

    const res = await POST(makeRequest(1), params(1));

    expect(res.status).toBe(200);
    expect(mockReadDocument).toHaveBeenCalledWith("object:companies/1/invoice-documents/scanned.pdf");
    expect(MockPDFParse).toHaveBeenCalledOnce();
    expect(mockGetScreenshot).toHaveBeenCalledOnce();

    // getScreenshot called with correct params
    expect(mockGetScreenshot).toHaveBeenCalledWith(
      expect.objectContaining({ desiredWidth: 1600, imageDataUrl: true, imageBuffer: false }),
    );

    // AI fetch was made with image_url content
    const fetchBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userContent = fetchBody.messages.find((m: { role: string }) => m.role === "user").content;
    expect(Array.isArray(userContent)).toBe(true);

    const imageItems = (userContent as Array<{ type: string; image_url?: { url: string } }>).filter(
      (c) => c.type === "image_url",
    );
    expect(imageItems).toHaveLength(1);
    expect(imageItems[0].image_url?.url).toBe("data:image/png;base64,PAGE1DATA");

    // AI_EXTRACTION_PROMPT included as text item
    const textItems = (userContent as Array<{ type: string; text?: string }>).filter(
      (c) => c.type === "text",
    );
    expect(textItems.length).toBeGreaterThan(0);
    expect(textItems[0].text).toBe(AI_EXTRACTION_PROMPT);
  });

  it("destroys the parser even when rendering succeeds", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageCapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/scanned.pdf",
        extractedText: "",
      }),
    );
    mockReadDocument.mockResolvedValue(Buffer.from("PDF bytes"));

    const mockDestroy = vi.fn().mockResolvedValue(undefined);
    installPDFParseMock(
      vi.fn().mockResolvedValue(
        makeScreenshotResult([{ dataUrl: "data:image/png;base64,X", pageNumber: 1 }]),
      ),
      mockDestroy,
    );

    fetchSpy.mockImplementation(aiOkResponse);

    await POST(makeRequest(1), params(1));

    expect(mockDestroy).toHaveBeenCalledOnce();
  });

  it("returns structured extraction response", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageCapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/scanned.pdf",
        extractedText: null,
      }),
    );
    mockReadDocument.mockResolvedValue(Buffer.from("PDF"));
    installPDFParseMock(
      vi.fn().mockResolvedValue(
        makeScreenshotResult([{ dataUrl: "data:image/png;base64,DATA", pageNumber: 1 }]),
      ),
      vi.fn().mockResolvedValue(undefined),
    );
    fetchSpy.mockImplementation(aiOkResponse);

    const res = await POST(makeRequest(1), params(1));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty("extraction");
    expect(body.extraction.invoiceNumber).toBe("INV-001");
  });
});

// ── 4. Multiple rendered PDF pages ────────────────────────────────────────────

describe("multiple rendered PDF pages", () => {
  it("sends all pages as image inputs in document order", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageCapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/multi.pdf",
        extractedText: null,
      }),
    );
    mockReadDocument.mockResolvedValue(Buffer.from("PDF"));
    installPDFParseMock(
      vi.fn().mockResolvedValue(
        makeScreenshotResult([
          { dataUrl: "data:image/png;base64,PAGE1", pageNumber: 1 },
          { dataUrl: "data:image/png;base64,PAGE2", pageNumber: 2 },
          { dataUrl: "data:image/png;base64,PAGE3", pageNumber: 3 },
        ]),
      ),
      vi.fn().mockResolvedValue(undefined),
    );
    fetchSpy.mockImplementation(aiOkResponse);

    const res = await POST(makeRequest(1), params(1));
    expect(res.status).toBe(200);

    const fetchBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userContent = fetchBody.messages.find((m: { role: string }) => m.role === "user").content as Array<{
      type: string;
      image_url?: { url: string };
    }>;

    const imageItems = userContent.filter((c) => c.type === "image_url");
    expect(imageItems).toHaveLength(3);
    expect(imageItems[0].image_url?.url).toBe("data:image/png;base64,PAGE1");
    expect(imageItems[1].image_url?.url).toBe("data:image/png;base64,PAGE2");
    expect(imageItems[2].image_url?.url).toBe("data:image/png;base64,PAGE3");
  });
});

// ── 5. Image-incompatible configured model ───────────────────────────────────

describe("image-incompatible configured model (mimo-v2.5-pro)", () => {
  it("returns 422 for scanned PDF without reading or rendering", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageIncapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/scanned.pdf",
        extractedText: null,
      }),
    );

    const res = await POST(makeRequest(1), params(1));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/image/i);

    // PDFParse must never be instantiated and no file read should occur
    expect(MockPDFParse).not.toHaveBeenCalled();
    expect(mockReadDocument).not.toHaveBeenCalled();
  });

  it("also blocks JPEG images with the existing error", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageIncapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "image/jpeg",
        storagePath: "/uploads/photo.jpg",
        extractedText: null,
      }),
    );

    const res = await POST(makeRequest(1), params(1));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/image/i);
  });
});

// ── 6. PDF read / render failure ─────────────────────────────────────────────

describe("PDF read/render failures", () => {
  it("returns 404 when PDF file cannot be read", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageCapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/missing.pdf",
        extractedText: null,
      }),
    );
    mockReadDocument.mockRejectedValue(new DocumentNotFoundError());

    const res = await POST(makeRequest(1), params(1));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/could not be read/i);
    // PDF renderer should not be instantiated if file read failed
    expect(MockPDFParse).not.toHaveBeenCalled();
  });

  it("returns 503 when scanned PDF storage is unavailable", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageCapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "object:companies/1/invoice-documents/scanned.pdf",
        extractedText: null,
      }),
    );
    mockReadDocument.mockRejectedValue(new Error("credential details must not leak"));

    const res = await POST(makeRequest(1), params(1));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "The document storage service is unavailable." });
    expect(MockPDFParse).not.toHaveBeenCalled();
  });

  it("returns 422 when getScreenshot throws, and still destroys parser", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageCapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/corrupt.pdf",
        extractedText: null,
      }),
    );
    mockReadDocument.mockResolvedValue(Buffer.from("bad PDF"));

    const mockDestroy = vi.fn().mockResolvedValue(undefined);
    installPDFParseMock(
      vi.fn().mockRejectedValue(new Error("corrupt PDF")),
      mockDestroy,
    );

    const res = await POST(makeRequest(1), params(1));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/rendered/i);

    // Parser must still be destroyed even after failure
    expect(mockDestroy).toHaveBeenCalledOnce();
    // No AI call should be made
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── 7. Existing JPEG/PNG/WebP path regression ─────────────────────────────────

describe("existing JPEG/PNG/WebP AI path", () => {
  it("sends image bytes to AI as image_url without using PDFParse", async () => {
    mockGetAiProviderCandidates.mockResolvedValue([imageCapableConfig()]);
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "image/jpeg",
        storagePath: "/uploads/photo.jpg",
        extractedText: null,
      }),
    );
    mockReadDocument.mockResolvedValue(Buffer.from("JPEG bytes"));
    fetchSpy.mockImplementation(aiOkResponse);

    const res = await POST(makeRequest(1), params(1));

    expect(res.status).toBe(200);
    expect(MockPDFParse).not.toHaveBeenCalled();

    const fetchBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userContent = fetchBody.messages.find((m: { role: string }) => m.role === "user").content;
    expect(Array.isArray(userContent)).toBe(true);

    const imageItems = (userContent as Array<{ type: string; image_url?: { url: string } }>).filter(
      (c) => c.type === "image_url",
    );
    expect(imageItems).toHaveLength(1);
    expect(imageItems[0].image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
  });
});
