import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));
vi.mock("@/src/lib/active-company", () => ({ getActiveCompanyFromRequest: vi.fn() }));
vi.mock("@/src/lib/document-storage", () => ({
  readDocument: vi.fn(),
  DocumentNotFoundError: class DocumentNotFoundError extends Error {},
}));

import { GET } from "@/app/api/invoices/[id]/document/route";
import { getDb } from "@/src/db";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { DocumentNotFoundError, readDocument } from "@/src/lib/document-storage";

const mockGetDb = vi.mocked(getDb);
const mockGetActiveCompany = vi.mocked(getActiveCompanyFromRequest);
const mockReadDocument = vi.mocked(readDocument);

function databaseResult(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveCompany.mockResolvedValue({ id: 7, baseCurrency: "EUR" } as never);
});

describe("GET /api/invoices/[id]/document", () => {
  it("returns durable bytes inline with the stored document metadata", async () => {
    mockGetDb.mockReturnValue(databaseResult([{
      supplier_invoice_documents: {
        storagePath: "object:companies/7/invoice-documents/invoice.pdf",
        mimeType: "application/pdf",
        originalFilename: "Supplier invoice.pdf",
      },
    }]) as never);
    mockReadDocument.mockResolvedValue(Buffer.from("durable document"));

    const response = await GET(
      new Request("http://localhost/api/invoices/41/document") as never,
      { params: Promise.resolve({ id: "41" }) },
    );

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("durable document");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="Supplier invoice.pdf"');
    expect(mockReadDocument).toHaveBeenCalledWith("object:companies/7/invoice-documents/invoice.pdf");
  });

  it("does not read storage when the active company query cannot see the document", async () => {
    mockGetDb.mockReturnValue(databaseResult([]) as never);

    const response = await GET(
      new Request("http://localhost/api/invoices/41/document") as never,
      { params: Promise.resolve({ id: "41" }) },
    );

    expect(response.status).toBe(404);
    expect(mockReadDocument).not.toHaveBeenCalled();
  });

  it("returns 404 when the stored document is genuinely missing", async () => {
    mockGetDb.mockReturnValue(databaseResult([{
      supplier_invoice_documents: {
        storagePath: "object:companies/7/invoice-documents/missing.pdf",
        mimeType: "application/pdf",
        originalFilename: "Missing.pdf",
      },
    }]) as never);
    mockReadDocument.mockRejectedValue(new DocumentNotFoundError());

    const response = await GET(
      new Request("http://localhost/api/invoices/41/document") as never,
      { params: Promise.resolve({ id: "41" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "File not on disk" });
  });

  it("returns 503 when document storage fails", async () => {
    mockGetDb.mockReturnValue(databaseResult([{
      supplier_invoice_documents: {
        storagePath: "object:companies/7/invoice-documents/invoice.pdf",
        mimeType: "application/pdf",
        originalFilename: "Invoice.pdf",
      },
    }]) as never);
    mockReadDocument.mockRejectedValue(new Error("credential details must not leak"));

    const response = await GET(
      new Request("http://localhost/api/invoices/41/document") as never,
      { params: Promise.resolve({ id: "41" }) },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "The document storage service is unavailable." });
  });
});
