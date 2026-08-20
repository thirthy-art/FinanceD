import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/db", () => ({ getDb: vi.fn() }));
vi.mock("@/src/lib/active-company", () => ({ getActiveCompanyFromRequest: vi.fn() }));
vi.mock("@/src/lib/document-storage", () => ({
  deleteDocument: vi.fn(),
  UnsafeDocumentStoragePathError: class UnsafeDocumentStoragePathError extends Error {},
}));

import { DELETE } from "@/app/api/invoices/[id]/route";
import { getDb } from "@/src/db";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { deleteDocument } from "@/src/lib/document-storage";

const mockGetDb = vi.mocked(getDb);
const mockGetActiveCompany = vi.mocked(getActiveCompanyFromRequest);
const mockDeleteDocument = vi.mocked(deleteDocument);

function selection(rows: unknown[], withLimit = false) {
  const where = vi.fn().mockReturnValue(withLimit
    ? { limit: vi.fn().mockResolvedValue(rows) }
    : Promise.resolve(rows));
  return { from: vi.fn().mockReturnValue({ where }) };
}

function deletion(rows?: unknown[]) {
  return {
    where: vi.fn().mockReturnValue(rows
      ? { returning: vi.fn().mockResolvedValue(rows) }
      : Promise.resolve(undefined)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveCompany.mockResolvedValue({ id: 9, baseCurrency: "EUR" } as never);
});

describe("DELETE /api/invoices/[id] document cleanup", () => {
  it("keeps DB-first deletion successful and warns when durable cleanup fails", async () => {
    const tx = {
      select: vi.fn()
        .mockReturnValueOnce(selection([{ id: 51, status: "draft" }]))
        .mockReturnValueOnce(selection([{ storagePath: "object:companies/9/invoice-documents/a.pdf" }]))
        .mockReturnValueOnce(selection([], true)),
      delete: vi.fn()
        .mockReturnValueOnce(deletion())
        .mockReturnValueOnce(deletion())
        .mockReturnValueOnce(deletion([{ id: 51 }])),
    };
    let transactionCompleted = false;
    mockGetDb.mockReturnValue({
      transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => {
        const result = await callback(tx);
        transactionCompleted = true;
        return result;
      }),
    } as never);
    mockDeleteDocument.mockImplementation(async () => {
      expect(transactionCompleted).toBe(true);
      throw new Error("R2 unavailable");
    });

    const response = await DELETE(
      new Request("http://localhost/api/invoices/51", { method: "DELETE" }) as never,
      { params: Promise.resolve({ id: "51" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      deleted: true,
      warning: "The invoice was deleted, but its uploaded file could not be removed.",
    });
    expect(mockDeleteDocument).toHaveBeenCalledWith("object:companies/9/invoice-documents/a.pdf");
  });
});
