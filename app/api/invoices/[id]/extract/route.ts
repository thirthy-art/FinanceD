import { readFile, stat } from "fs/promises";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/src/db";
import { supplierInvoiceDocuments } from "@/src/db/schema";
import {
  MIMO_EXTRACTION_PROMPT,
  MimoInvoiceExtractionSchema,
} from "@/src/lib/mimo-extraction";

export const runtime = "nodejs";

const DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1";
const DEFAULT_MODEL = "mimo-v2.5";
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

const MimoModelSchema = z.enum(["mimo-v2.5", "mimo-v2.5-pro"]);
const MimoResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }),
      }),
    )
    .min(1),
});

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}

function getProviderConfig() {
  const apiKey = process.env.MIMO_API_KEY?.trim();
  const model = MimoModelSchema.safeParse(process.env.MIMO_MODEL?.trim() || DEFAULT_MODEL);
  const baseUrlValue = process.env.MIMO_BASE_URL?.trim() || DEFAULT_BASE_URL;

  if (!apiKey) return { ok: false, error: "AI extraction is not configured. Set MIMO_API_KEY on the server." } as const;
  if (!model.success) {
    return { ok: false, error: "AI extraction is misconfigured. MIMO_MODEL must be mimo-v2.5 or mimo-v2.5-pro." } as const;
  }

  try {
    const baseUrl = new URL(baseUrlValue);
    if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") throw new Error("Unsupported protocol");
    return {
      ok: true,
      apiKey,
      model: model.data,
      endpoint: `${baseUrl.toString().replace(/\/$/, "")}/chat/completions`,
    } as const;
  } catch {
    return { ok: false, error: "AI extraction is misconfigured. MIMO_BASE_URL is not a valid HTTP URL." } as const;
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return errorResponse("Invalid invoice id.", 400);
  }

  const config = getProviderConfig();
  if (!config.ok) return errorResponse(config.error, 503);

  const db = getDb();
  const [document] = await db
    .select({
      mimeType: supplierInvoiceDocuments.mimeType,
      storagePath: supplierInvoiceDocuments.storagePath,
      extractedText: supplierInvoiceDocuments.extractedText,
    })
    .from(supplierInvoiceDocuments)
    .where(eq(supplierInvoiceDocuments.invoiceId, invoiceId))
    .limit(1);

  if (!document) return errorResponse("This invoice has no document to extract.", 404);

  let userContent: string | Array<Record<string, unknown>>;

  if (IMAGE_MIME_TYPES.has(document.mimeType)) {
    if (config.model === "mimo-v2.5-pro") {
      return errorResponse(
        "mimo-v2.5-pro does not support image input. Set MIMO_MODEL=mimo-v2.5 for JPEG, PNG, or WebP invoices.",
        422,
      );
    }

    try {
      const fileStats = await stat(document.storagePath);
      if (fileStats.size > MAX_IMAGE_BYTES) {
        return errorResponse("The invoice image exceeds MiMo's 50 MB image limit.", 413);
      }
      const image = await readFile(document.storagePath);
      userContent = [
        {
          type: "image_url",
          image_url: { url: `data:${document.mimeType};base64,${image.toString("base64")}` },
        },
        { type: "text", text: MIMO_EXTRACTION_PROMPT },
      ];
    } catch {
      return errorResponse("The invoice document could not be read.", 404);
    }
  } else if (document.mimeType === "application/pdf") {
    const extractedText = document.extractedText?.trim();
    if (!extractedText) {
      return errorResponse(
        "This PDF has no extracted text. PDF page rendering and OCR are not included in this extraction probe.",
        422,
      );
    }
    userContent = `${MIMO_EXTRACTION_PROMPT}\n\nINVOICE TEXT START\n${extractedText}\nINVOICE TEXT END`;
  } else {
    return errorResponse("AI extraction supports JPEG, PNG, WebP, and digital PDF documents only.", 415);
  }

  let providerResponse: Response;
  try {
    providerResponse = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "api-key": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content: "You extract supplier invoices faithfully. Follow the user's JSON schema and extraction rules exactly.",
          },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 16384,
        stream: false,
        thinking: { type: "disabled" },
      }),
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
  } catch {
    return errorResponse("MiMo could not be reached. Try AI extraction again later.", 502);
  }

  if (!providerResponse.ok) {
    return errorResponse(`MiMo could not process this document (HTTP ${providerResponse.status}).`, 502);
  }

  let providerJson: unknown;
  try {
    providerJson = await providerResponse.json();
  } catch {
    return errorResponse("MiMo returned an unreadable response.", 502);
  }

  const envelope = MimoResponseSchema.safeParse(providerJson);
  if (!envelope.success) return errorResponse("MiMo returned an invalid response.", 502);

  let extractionJson: unknown;
  try {
    extractionJson = JSON.parse(envelope.data.choices[0].message.content);
  } catch {
    return errorResponse("MiMo returned invalid structured invoice data.", 502);
  }

  const extraction = MimoInvoiceExtractionSchema.safeParse(extractionJson);
  if (!extraction.success) {
    return errorResponse("MiMo returned invoice data that did not match the required structure.", 502);
  }

  return Response.json({ extraction: extraction.data });
}
