import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/document-storage", () => ({ readDocument: vi.fn() }));
vi.mock("@/src/lib/experimental/layout-line-extraction", async (importActual) => {
  const actual =
    await importActual<typeof import("@/src/lib/experimental/layout-line-extraction")>();
  return { ...actual, extractDeterministicLayoutInvoiceLines: vi.fn() };
});

import { readDocument } from "@/src/lib/document-storage";
import {
  extractDeterministicLayoutInvoiceLines,
  LAYOUT_LINE_EXTRACTOR_VERSION,
  type DeterministicInvoiceLine,
  type LayoutLineExtractionResult,
} from "@/src/lib/experimental/layout-line-extraction";
import { getDeterministicInitialInvoiceLines } from "@/src/lib/experimental/layout-initial-lines";

const mockReadDocument = vi.mocked(readDocument);
const mockExtractLayout = vi.mocked(extractDeterministicLayoutInvoiceLines);

const DIGITAL_PDF = {
  mimeType: "application/pdf",
  storagePath: "/uploads/invoice.pdf",
  extractedText: "ACME Corp\nInvoice: INV-001",
};

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
  useful: boolean,
): LayoutLineExtractionResult {
  return {
    extractorVersion: LAYOUT_LINE_EXTRACTOR_VERSION,
    logicalTableId: "logical-001",
    columnFields: { 1: "descriptionOriginal", 3: "netAmount" },
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

beforeEach(() => {
  vi.clearAllMocks();
  mockReadDocument.mockResolvedValue(Buffer.from("PDF bytes"));
});

describe("getDeterministicInitialInvoiceLines", () => {
  it("returns editable initial lines for a digital PDF without saved lines", async () => {
    mockExtractLayout.mockResolvedValue(
      detResult([detLine(), detLine({ descriptionOriginal: "Support", netAmount: "50", sourcePage: 2, sourceRowIndex: 2 })], true),
    );

    const lines = await getDeterministicInitialInvoiceLines({
      ...DIGITAL_PDF,
      persistedLineCount: 0,
    });

    expect(mockReadDocument).toHaveBeenCalledWith("/uploads/invoice.pdf");
    expect(lines).toHaveLength(2);
    expect(lines![0]).toEqual({
      lineNumber: "",
      descriptionOriginal: "Consulting",
      description: "",
      quantity: "2",
      unit: "",
      unitPrice: "100",
      netAmount: "200",
      vatRate: "",
      vatAmount: "",
      grossAmount: "",
      sourcePage: "1",
      recognitionTreatment: "Immediate",
      recognitionStartDate: "",
      recognitionEndDate: "",
      accountingAccountNumber: "",
      prepaidAccountNumber: "",
    });
    expect(lines![1].descriptionOriginal).toBe("Support");
    expect(lines![1].sourcePage).toBe("2");
  });

  it("keeps existing saved lines authoritative and never extracts", async () => {
    const lines = await getDeterministicInitialInvoiceLines({
      ...DIGITAL_PDF,
      persistedLineCount: 2,
    });

    expect(lines).toBeNull();
    expect(mockReadDocument).not.toHaveBeenCalled();
    expect(mockExtractLayout).not.toHaveBeenCalled();
  });

  it("returns null when the deterministic result is not useful", async () => {
    mockExtractLayout.mockResolvedValue(detResult([detLine()], false));

    const lines = await getDeterministicInitialInvoiceLines({
      ...DIGITAL_PDF,
      persistedLineCount: 0,
    });

    expect(lines).toBeNull();
  });

  it("returns null when layout extraction fails, preserving the text fallback", async () => {
    mockExtractLayout.mockRejectedValue(new Error("pdfjs exploded"));

    const lines = await getDeterministicInitialInvoiceLines({
      ...DIGITAL_PDF,
      persistedLineCount: 0,
    });

    expect(lines).toBeNull();
  });

  it("returns null when the stored bytes cannot be read", async () => {
    mockReadDocument.mockRejectedValue(new Error("storage unavailable"));

    const lines = await getDeterministicInitialInvoiceLines({
      ...DIGITAL_PDF,
      persistedLineCount: 0,
    });

    expect(lines).toBeNull();
  });

  it("leaves scanned PDFs (no embedded text) and images unchanged", async () => {
    expect(
      await getDeterministicInitialInvoiceLines({
        ...DIGITAL_PDF,
        extractedText: null,
        persistedLineCount: 0,
      }),
    ).toBeNull();
    expect(
      await getDeterministicInitialInvoiceLines({
        ...DIGITAL_PDF,
        mimeType: "image/jpeg",
        persistedLineCount: 0,
      }),
    ).toBeNull();
    expect(mockReadDocument).not.toHaveBeenCalled();
    expect(mockExtractLayout).not.toHaveBeenCalled();
  });
});
