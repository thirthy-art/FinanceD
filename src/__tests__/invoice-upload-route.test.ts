import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs/promises", () => ({
  mkdir: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("@/src/db", () => ({ getDb: vi.fn() }));
vi.mock("@/src/lib/db-helpers", () => ({ getOrCreateCompany: vi.fn() }));
vi.mock("@/src/lib/extract", () => ({
  extractPdfText: vi.fn(),
  extractImageText: vi.fn(),
  parseInvoiceFields: vi.fn(),
}));

import { mkdir, writeFile } from "fs/promises";
import { getDb } from "@/src/db";
import { getOrCreateCompany } from "@/src/lib/db-helpers";
import { extractImageText, extractPdfText, parseInvoiceFields } from "@/src/lib/extract";
import { POST } from "@/app/api/invoices/upload/route";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const mockMkdir = vi.mocked(mkdir);
const mockWriteFile = vi.mocked(writeFile);
const mockGetDb = vi.mocked(getDb);
const mockGetOrCreateCompany = vi.mocked(getOrCreateCompany);
const mockExtractPdfText = vi.mocked(extractPdfText);
const mockExtractImageText = vi.mocked(extractImageText);
const mockParseInvoiceFields = vi.mocked(parseInvoiceFields);

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
  const insert = vi.fn()
    .mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 42 }]),
        }),
      }),
    })
    .mockReturnValueOnce({ values: vi.fn().mockResolvedValue(undefined) });
  const tx = { insert };
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockGetOrCreateCompany.mockResolvedValue({ id: 1, baseCurrency: "EUR" } as never);
  mockExtractPdfText.mockResolvedValue({ text: "Invoice text", ocrPerformed: false });
  mockExtractImageText.mockResolvedValue({ text: "Invoice text", ocrPerformed: true });
  mockParseInvoiceFields.mockReturnValue({});
});

describe("invoice upload size limit", () => {
  it("allows a file at the 25 MiB limit to follow the normal upload path", async () => {
    const arrayBuffer = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    mockGetDb.mockReturnValue(successfulDb() as never);

    const response = await POST(uploadRequest({
      name: "invoice.pdf",
      type: "application/pdf",
      size: MAX_UPLOAD_BYTES,
      arrayBuffer,
    }) as never);

    expect(response.status).toBe(200);
    expect(arrayBuffer).toHaveBeenCalledOnce();
    expect(mockWriteFile).toHaveBeenCalledOnce();
    expect(mockExtractPdfText).toHaveBeenCalledOnce();
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
    expect(mockMkdir).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockExtractPdfText).not.toHaveBeenCalled();
    expect(mockExtractImageText).not.toHaveBeenCalled();
    expect(mockGetDb).not.toHaveBeenCalled();
  });
});
