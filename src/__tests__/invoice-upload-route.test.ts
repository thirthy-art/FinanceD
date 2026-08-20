import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));
vi.mock("@/src/lib/active-company", () => ({ getActiveCompanyFromRequest: vi.fn() }));
vi.mock("@/src/lib/document-storage", () => ({
  storeDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));
vi.mock("@/src/lib/extract", () => ({
  extractPdfText: vi.fn(),
  extractImageText: vi.fn(),
  parseInvoiceFields: vi.fn(),
}));

import { getDb } from "@/src/db";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { deleteDocument, storeDocument } from "@/src/lib/document-storage";
import { extractImageText, extractPdfText, parseInvoiceFields } from "@/src/lib/extract";
import { POST } from "@/app/api/invoices/upload/route";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const mockGetDb = vi.mocked(getDb);
const mockGetActiveCompany = vi.mocked(getActiveCompanyFromRequest);
const mockExtractPdfText = vi.mocked(extractPdfText);
const mockExtractImageText = vi.mocked(extractImageText);
const mockParseInvoiceFields = vi.mocked(parseInvoiceFields);
const mockStoreDocument = vi.mocked(storeDocument);
const mockDeleteDocument = vi.mocked(deleteDocument);

function uploadRequest(file: {
  name: string;
  type: string;
  size: number;
  arrayBuffer: ReturnType<typeof vi.fn>;
}) {
  return {
    formData: vi.fn().mockResolvedValue({
      get: (key: string) => key === "file" ? file : "request-1234567890",
    }),
  };
}

function successfulDb() {
  const invoiceValues = vi.fn().mockReturnValue({
    onConflictDoNothing: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 42 }]),
    }),
  });
  const insert = vi.fn()
    .mockReturnValueOnce({ values: invoiceValues })
    .mockReturnValueOnce({ values: vi.fn().mockResolvedValue(undefined) });
  const tx = { insert };
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
  };
  return { db, invoiceValues };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreDocument.mockResolvedValue("object:companies/1/invoice-documents/test.pdf");
  mockDeleteDocument.mockResolvedValue(undefined);
  mockGetActiveCompany.mockResolvedValue({ id: 1, baseCurrency: "EUR" } as never);
  mockExtractPdfText.mockResolvedValue({ text: "Invoice text", ocrPerformed: false });
  mockExtractImageText.mockResolvedValue({ text: "Invoice text", ocrPerformed: true });
  mockParseInvoiceFields.mockReturnValue({});
});

describe("invoice upload size limit", () => {
  it("allows a file at the 25 MiB limit to follow the normal upload path", async () => {
    const arrayBuffer = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    const { db } = successfulDb();
    mockGetDb.mockReturnValue(db as never);

    const response = await POST(uploadRequest({
      name: "invoice.pdf",
      type: "application/pdf",
      size: MAX_UPLOAD_BYTES,
      arrayBuffer,
    }) as never);

    expect(response.status).toBe(200);
    expect(arrayBuffer).toHaveBeenCalledOnce();
    expect(mockExtractPdfText).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
    expect(mockStoreDocument).toHaveBeenCalledWith(expect.objectContaining({
      bytes: Buffer.from([1, 2, 3]),
      companyId: 1,
      extension: ".pdf",
      mimeType: "application/pdf",
    }));
  });

  it("assigns a new invoice to the active company", async () => {
    const arrayBuffer = vi.fn().mockResolvedValue(new Uint8Array([1]).buffer);
    mockGetActiveCompany.mockResolvedValue({ id: 22, baseCurrency: "GBP" } as never);
    const { db, invoiceValues } = successfulDb();
    mockGetDb.mockReturnValue(db as never);

    const response = await POST(uploadRequest({
      name: "invoice.pdf",
      type: "application/pdf",
      size: 1,
      arrayBuffer,
    }) as never);

    expect(response.status).toBe(200);
    expect(invoiceValues).toHaveBeenCalledWith(expect.objectContaining({ companyId: 22, currency: "GBP" }));
  });

  it("does not reuse an upload request id owned by another company", async () => {
    const arrayBuffer = vi.fn().mockResolvedValue(new Uint8Array([1]).buffer);
    const emptySelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });
    const tx = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
        }),
      }),
      select: emptySelect,
    };
    mockGetDb.mockReturnValue({
      select: emptySelect,
      transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    } as never);

    const response = await POST(uploadRequest({
      name: "invoice.pdf",
      type: "application/pdf",
      size: 1,
      arrayBuffer,
    }) as never);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "The invoice record could not be created. Please retry safely." });
    expect(mockDeleteDocument).toHaveBeenCalledWith("object:companies/1/invoice-documents/test.pdf");
  });

  it("returns 413 before writing or extracting an oversized file", async () => {
    const arrayBuffer = vi.fn();

    const response = await POST(uploadRequest({
      name: "invoice.pdf",
      type: "application/pdf",
      size: MAX_UPLOAD_BYTES + 1,
      arrayBuffer,
    }) as never);

    expect(response.status).toBe(413);
    expect((await response.json()).error).toMatch(/25 MB upload limit/);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mockStoreDocument).not.toHaveBeenCalled();
    expect(mockExtractPdfText).not.toHaveBeenCalled();
    expect(mockExtractImageText).not.toHaveBeenCalled();
    expect(mockGetDb).not.toHaveBeenCalled();
  });
});
