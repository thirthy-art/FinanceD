import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(function () { return { send }; }),
  };
});

import {
  deleteDocument,
  readDocument,
  storeDocument,
} from "@/src/lib/document-storage";

const ORIGINAL_ENV = { ...process.env };
let temporaryDirectory: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("document storage", () => {
  it("writes, reads, and deletes local document bytes", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "financed-documents-"));
    process.env.DOCUMENT_STORAGE_BACKEND = "local";
    process.env.UPLOAD_DIR = temporaryDirectory;

    const reference = await storeDocument({
      bytes: Buffer.from("invoice"),
      companyId: 12,
      extension: ".pdf",
      mimeType: "application/pdf",
    });

    expect(reference.startsWith(temporaryDirectory)).toBe(true);
    expect(await readFile(reference, "utf8")).toBe("invoice");
    expect(await readDocument(reference)).toEqual(Buffer.from("invoice"));

    await deleteDocument(reference);
    await expect(readFile(reference)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses object references for S3-compatible write, read, and delete operations", async () => {
    process.env.DOCUMENT_STORAGE_BACKEND = "s3";
    process.env.DOCUMENT_STORAGE_S3_ENDPOINT = "https://example.r2.cloudflarestorage.com";
    process.env.DOCUMENT_STORAGE_S3_REGION = "auto";
    process.env.DOCUMENT_STORAGE_S3_BUCKET = "documents";
    process.env.DOCUMENT_STORAGE_S3_ACCESS_KEY_ID = "key";
    process.env.DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY = "secret";
    send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Body: { transformToByteArray: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) } })
      .mockResolvedValueOnce({});

    const reference = await storeDocument({
      bytes: Buffer.from([1, 2, 3]),
      companyId: 34,
      extension: ".png",
      mimeType: "image/png",
    });

    expect(reference).toMatch(/^object:companies\/34\/invoice-documents\/[0-9a-f-]+\.png$/);
    expect(await readDocument(reference)).toEqual(Buffer.from([1, 2, 3]));
    await deleteDocument(reference);

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      "PutObjectCommand",
      "GetObjectCommand",
      "DeleteObjectCommand",
    ]);
  });

  it("fails clearly when the selected S3 backend is incomplete", async () => {
    process.env.DOCUMENT_STORAGE_BACKEND = "s3";
    delete process.env.DOCUMENT_STORAGE_S3_BUCKET;

    await expect(readDocument("object:companies/1/invoice-documents/a.pdf"))
      .rejects.toThrow(/DOCUMENT_STORAGE_S3_BUCKET/);
    expect(send).not.toHaveBeenCalled();
  });
});
