import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { resolveSafeUploadPath } from "./safe-upload-path";

const OBJECT_REFERENCE_PREFIX = "object:";

type StoreDocumentInput = {
  bytes: Buffer;
  companyId: number;
  extension: string;
  mimeType: string;
};

type S3Configuration = {
  bucket: string;
  client: S3Client;
};

export class UnsafeDocumentStoragePathError extends Error {}
export class DocumentNotFoundError extends Error {
  constructor() {
    super("Document not found.");
    this.name = "DocumentNotFoundError";
  }
}

function storageBackend(): "local" | "s3" {
  const backend = process.env.DOCUMENT_STORAGE_BACKEND ?? "local";
  if (backend !== "local" && backend !== "s3") {
    throw new Error(`Unsupported DOCUMENT_STORAGE_BACKEND: ${backend}`);
  }
  return backend;
}

function s3Configuration(): S3Configuration {
  const variables = {
    endpoint: process.env.DOCUMENT_STORAGE_S3_ENDPOINT,
    region: process.env.DOCUMENT_STORAGE_S3_REGION,
    bucket: process.env.DOCUMENT_STORAGE_S3_BUCKET,
    accessKeyId: process.env.DOCUMENT_STORAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY,
  };
  const missing = Object.entries(variables)
    .filter(([, value]) => !value)
    .map(([name]) => `DOCUMENT_STORAGE_S3_${name.replace(/([A-Z])/g, "_$1").toUpperCase()}`);
  if (missing.length > 0) {
    throw new Error(`Missing S3 document storage configuration: ${missing.join(", ")}`);
  }

  try {
    new URL(variables.endpoint!);
  } catch {
    throw new Error("Invalid DOCUMENT_STORAGE_S3_ENDPOINT.");
  }

  return {
    bucket: variables.bucket!,
    client: new S3Client({
      endpoint: variables.endpoint!,
      region: variables.region!,
      credentials: {
        accessKeyId: variables.accessKeyId!,
        secretAccessKey: variables.secretAccessKey!,
      },
      forcePathStyle: true,
    }),
  };
}

function safeExtension(extension: string): string {
  const normalized = extension.toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(normalized) ? normalized : "";
}

function objectKey(reference: string): string {
  if (!reference.startsWith(OBJECT_REFERENCE_PREFIX)) {
    throw new Error("Invalid object storage reference.");
  }
  const key = reference.slice(OBJECT_REFERENCE_PREFIX.length);
  if (!key) throw new Error("Invalid object storage reference.");
  return key;
}

function isS3NotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const storageError = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return storageError.name === "NoSuchKey" || storageError.$metadata?.httpStatusCode === 404;
}

export async function storeDocument(input: StoreDocumentInput): Promise<string> {
  const filename = `${randomUUID()}${safeExtension(input.extension)}`;
  if (storageBackend() === "local") {
    const uploadDirectory = process.env.UPLOAD_DIR ?? "./uploads";
    const storagePath = path.join(/* turbopackIgnore: true */ uploadDirectory, filename);
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(storagePath, input.bytes);
    return storagePath;
  }

  const key = `companies/${input.companyId}/invoice-documents/${filename}`;
  const { bucket, client } = s3Configuration();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: input.bytes,
    ContentType: input.mimeType,
  }));
  return `${OBJECT_REFERENCE_PREFIX}${key}`;
}

export async function readDocument(reference: string): Promise<Buffer> {
  if (!reference.startsWith(OBJECT_REFERENCE_PREFIX)) {
    try {
      return await readFile(reference);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new DocumentNotFoundError();
      throw error;
    }
  }

  const { bucket, client } = s3Configuration();
  let result: GetObjectCommandOutput;
  try {
    result = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey(reference),
    }));
  } catch (error) {
    if (isS3NotFoundError(error)) throw new DocumentNotFoundError();
    throw error;
  }
  if (!result.Body) throw new Error("The stored document has no content.");
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function deleteDocument(reference: string): Promise<void> {
  if (reference.startsWith(OBJECT_REFERENCE_PREFIX)) {
    const { bucket, client } = s3Configuration();
    await client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: objectKey(reference),
    }));
    return;
  }

  const uploadDirectory = process.env.UPLOAD_DIR ?? "./uploads";
  const safePath = resolveSafeUploadPath(reference, uploadDirectory);
  if (!safePath) throw new UnsafeDocumentStoragePathError("Unsafe local document storage path.");
  try {
    await unlink(safePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
