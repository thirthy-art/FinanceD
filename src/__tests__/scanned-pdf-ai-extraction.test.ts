import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────
// vi.mock calls are hoisted by Vitest and run before any imports.

vi.mock("pdf-parse", () => ({ PDFParse: vi.fn() }));
vi.mock("@/src/db", () => ({ getDb: vi.fn() }));
vi.mock("@/src/lib/ai-provider", () => ({ getAiProviderConfig: vi.fn() }));
vi.mock("fs/promises", () => ({ readFile: vi.fn(), stat: vi.fn() }));

// ── Imports after mocks ───────────────────────────────────────────────────────
import { PDFParse } from "pdf-parse";
import { getDb } from "@/src/db";
import { getAiProviderConfig } from "@/src/lib/ai-provider";
import { readFile, stat } from "fs/promises";
import { AI_EXTRACTION_PROMPT } from "@/src/lib/ai-extraction";
import { POST } from "@/app/api/invoices/[id]/extract/route";

const MockPDFParse = vi.mocked(PDFParse);
const mockGetDb = vi.mocked(getDb);
const mockGetAiProviderConfig = vi.mocked(getAiProviderConfig);
const mockReadFile = vi.mocked(readFile);
const mockStat = vi.mocked(stat);

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
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([doc]),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof getDb>;
}

function imageCapableConfig() {
  return {
    ok: true as const,
    model: "gpt-4o",
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: "sk-test",
  };
}

function imageIncapableConfig() {
  return {
    ok: true as const,
    model: "mimo-v2.5-pro",
    endpoint: "https://api.xiaomimimo.com/v1/chat/completions",
    apiKey: "mimo-key",
  };
}

function makeRequest(invoiceId: number) {
  return new Request(`http://localhost/api/invoices/${invoiceId}/extract`, {
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
  it("sends text to AI without calling getScreenshot", async () => {
    mockGetAiProviderConfig.mockReturnValue(imageCapableConfig());
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

    // PDFParse must not have been instantiated
    expect(MockPDFParse).not.toHaveBeenCalled();

    // AI fetch body must contain extracted text, not image_url items
    const fetchBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userContent = fetchBody.messages.find((m: { role: string }) => m.role === "user").content;
    expect(typeof userContent).toBe("string");
    expect(userContent).toContain("INVOICE TEXT START");
    expect(userContent).toContain("INV-001");
    expect(userContent).toContain(AI_EXTRACTION_PROMPT);
  });

  it("returns extraction matching the existing schema contract", async () => {
    mockGetAiProviderConfig.mockReturnValue(imageCapableConfig());
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

// ── 2. Scanned PDF with blank extracted text ──────────────────────────────────

describe("scanned PDF with blank extracted text", () => {
  it("renders PDF pages and sends them as image inputs", async () => {
    mockGetAiProviderConfig.mockReturnValue(imageCapableConfig());
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/scanned.pdf",
        extractedText: null,
      }),
    );
    mockReadFile.mockResolvedValue(Buffer.from("PDF bytes") as never);

    const mockGetScreenshot = vi.fn().mockResolvedValue(
      makeScreenshotResult([{ dataUrl: "data:image/png;base64,PAGE1DATA", pageNumber: 1 }]),
    );
    const mockDestroy = vi.fn().mockResolvedValue(undefined);
    installPDFParseMock(mockGetScreenshot, mockDestroy);

    fetchSpy.mockImplementation(aiOkResponse);

    const res = await POST(makeRequest(1), params(1));

    expect(res.status).toBe(200);
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
    mockGetAiProviderConfig.mockReturnValue(imageCapableConfig());
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/scanned.pdf",
        extractedText: "",
      }),
    );
    mockReadFile.mockResolvedValue(Buffer.from("PDF bytes") as never);

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
    mockGetAiProviderConfig.mockReturnValue(imageCapableConfig());
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/scanned.pdf",
        extractedText: null,
      }),
    );
    mockReadFile.mockResolvedValue(Buffer.from("PDF") as never);
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

// ── 3. Multiple rendered PDF pages ────────────────────────────────────────────

describe("multiple rendered PDF pages", () => {
  it("sends all pages as image inputs in document order", async () => {
    mockGetAiProviderConfig.mockReturnValue(imageCapableConfig());
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/multi.pdf",
        extractedText: null,
      }),
    );
    mockReadFile.mockResolvedValue(Buffer.from("PDF") as never);
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

// ── 4. Image-incompatible configured model ───────────────────────────────────

describe("image-incompatible configured model (mimo-v2.5-pro)", () => {
  it("returns 422 for scanned PDF without reading or rendering", async () => {
    mockGetAiProviderConfig.mockReturnValue(imageIncapableConfig());
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
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("also blocks JPEG images with the existing error", async () => {
    mockGetAiProviderConfig.mockReturnValue(imageIncapableConfig());
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

// ── 5. PDF read / render failure ─────────────────────────────────────────────

describe("PDF read/render failures", () => {
  it("returns 404 when PDF file cannot be read", async () => {
    mockGetAiProviderConfig.mockReturnValue(imageCapableConfig());
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/missing.pdf",
        extractedText: null,
      }),
    );
    mockReadFile.mockRejectedValue(new Error("ENOENT") as never);

    const res = await POST(makeRequest(1), params(1));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/could not be read/i);
    // PDF renderer should not be instantiated if file read failed
    expect(MockPDFParse).not.toHaveBeenCalled();
  });

  it("returns 422 when getScreenshot throws, and still destroys parser", async () => {
    mockGetAiProviderConfig.mockReturnValue(imageCapableConfig());
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "application/pdf",
        storagePath: "/uploads/corrupt.pdf",
        extractedText: null,
      }),
    );
    mockReadFile.mockResolvedValue(Buffer.from("bad PDF") as never);

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

// ── 6. Existing JPEG/PNG/WebP path regression ─────────────────────────────────

describe("existing JPEG/PNG/WebP AI path", () => {
  it("sends image bytes to AI as image_url without using PDFParse", async () => {
    mockGetAiProviderConfig.mockReturnValue(imageCapableConfig());
    mockGetDb.mockReturnValue(
      makeDbWithDocument({
        mimeType: "image/jpeg",
        storagePath: "/uploads/photo.jpg",
        extractedText: null,
      }),
    );
    mockStat.mockResolvedValue({ size: 1024 } as never);
    mockReadFile.mockResolvedValue(Buffer.from("JPEG bytes") as never);
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
