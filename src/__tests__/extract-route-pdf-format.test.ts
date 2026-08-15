/**
 * Targeted test: verifies that the PDF AI extraction path injects the
 * column-layout format note into the user message sent to the LLM.
 *
 * This is the only behavioral change introduced by the difficult-invoice-import
 * fix. No DB or real AI provider is needed — both are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AI_EXTRACTION_PROMPT, AiInvoiceExtractionSchema } from "@/src/lib/ai-extraction";

// ── Minimal valid AI extraction response ─────────────────────────────────────

const VALID_EXTRACTION = {
  vendorOriginal: "Acme SRL",
  vendorNormalized: "Acme SRL",
  vendorTaxId: null,
  invoiceNumber: "INV-001",
  invoiceDate: "2024-01-15",
  dueDate: null,
  currency: "EUR",
  netAmount: "100.00",
  vatAmount: "20.00",
  grossAmount: "120.00",
  lines: [],
};

// Confirm the fixture is valid so the route doesn't reject it.
expect(AiInvoiceExtractionSchema.safeParse(VALID_EXTRACTION).success).toBe(true);

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/src/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                mimeType: "application/pdf",
                storagePath: "/uploads/test.pdf",
                extractedText:
                  "Acme SRL\tInvoice\tINV-001\n" +
                  "Description\tQty\tUnit Price\tAmount\n" +
                  "Widget A\t10\t10.00\t100.00\n" +
                  "-- 1 of 1 --",
              },
            ]),
        }),
      }),
    }),
  }),
}));

vi.mock("@/src/lib/ai-provider", () => ({
  getAiProviderConfig: () => ({
    ok: true,
    endpoint: "https://ai.example.com/v1/chat/completions",
    apiKey: "test-key",
    model: "test-model",
  }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PDF AI extraction — column layout format note", () => {
  let capturedBody: Record<string, unknown>;

  beforeEach(() => {
    capturedBody = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(VALID_EXTRACTION) } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
  });

  it("includes the tab-column format note in the user message sent to the AI", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/extract/route");
    const req = new Request("http://localhost/api/invoices/1/extract", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });

    expect(res.status).toBe(200);

    const messages = capturedBody.messages as Array<{ role: string; content: string }>;
    const userMessage = messages.find((m) => m.role === "user");
    expect(userMessage).toBeDefined();

    const content = userMessage!.content;

    // Format note must be present and describe tabs as column separators.
    expect(content).toContain("Tab characters");
    expect(content).toContain("separate columns");
    expect(content).toContain("page-break markers");

    // The AI extraction prompt must still be present.
    expect(content).toContain(AI_EXTRACTION_PROMPT.slice(0, 40));

    // The invoice text must still be present.
    expect(content).toContain("INVOICE TEXT START");
    expect(content).toContain("Widget A");
  });

  it("format note appears between the AI prompt and the invoice text", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/extract/route");
    const req = new Request("http://localhost/api/invoices/1/extract", { method: "POST" });
    await POST(req, { params: Promise.resolve({ id: "1" }) });

    const messages = capturedBody.messages as Array<{ role: string; content: string }>;
    const content = messages.find((m) => m.role === "user")!.content;

    const noteIdx = content.indexOf("Tab characters");
    const promptIdx = content.indexOf(AI_EXTRACTION_PROMPT.slice(0, 40));
    const textIdx = content.indexOf("INVOICE TEXT START");

    expect(promptIdx).toBeLessThan(noteIdx);
    expect(noteIdx).toBeLessThan(textIdx);
  });

  it("page-break marker line in the invoice text is flagged as non-invoice data", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/extract/route");
    const req = new Request("http://localhost/api/invoices/1/extract", { method: "POST" });
    await POST(req, { params: Promise.resolve({ id: "1" }) });

    const messages = capturedBody.messages as Array<{ role: string; content: string }>;
    const content = messages.find((m) => m.role === "user")!.content;

    // The note must specifically address the page-break pattern from pdf-parse.
    expect(content).toMatch(/page.break markers/i);
    expect(content).toMatch(/not.*invoice data/i);
  });
});
