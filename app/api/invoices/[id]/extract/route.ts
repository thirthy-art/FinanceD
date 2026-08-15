import { readFile, stat } from "fs/promises";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/src/db";
import { supplierInvoiceDocuments } from "@/src/db/schema";
import {
  AI_EXTRACTION_PROMPT,
  AiInvoiceExtractionSchema,
} from "@/src/lib/ai-extraction";
import { getAiProviderConfig } from "@/src/lib/ai-provider";

export const runtime = "nodejs";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BASE64_IMAGE_BYTES = 50 * 1024 * 1024;

const AiResponseSchema = z.object({
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

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return errorResponse("Invalid invoice id.", 400);
  }

  const config = getAiProviderConfig();
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
        "The configured AI model does not support image input. Choose an image-capable model for JPEG, PNG, or WebP invoices.",
        422,
      );
    }

    try {
      const fileStats = await stat(document.storagePath);
      const base64Size = 4 * Math.ceil(fileStats.size / 3);
      if (base64Size > MAX_BASE64_IMAGE_BYTES) {
        return errorResponse("The Base64-encoded invoice image exceeds the AI extraction service's 50 MiB limit.", 413);
      }
      const image = await readFile(document.storagePath);
      userContent = [
        {
          type: "image_url",
          image_url: { url: `data:${document.mimeType};base64,${image.toString("base64")}` },
        },
        { type: "text", text: AI_EXTRACTION_PROMPT },
      ];
    } catch {
      return errorResponse("The invoice document could not be read.", 404);
    }
  } else if (document.mimeType === "application/pdf") {
    const extractedText = document.extractedText?.trim();
    if (!extractedText) {
      return errorResponse(
        "This PDF has no extracted text. PDF page rendering and OCR are not available for AI extraction.",
        422,
      );
    }
    const textFormatNote =
      "TEXT FORMAT: Each line is one row. Tab characters (\\t) separate columns within the same row. " +
      'Lines matching "-- N of M --" are page-break markers and are not invoice data.';
    userContent = `${AI_EXTRACTION_PROMPT}\n\n${textFormatNote}\n\nINVOICE TEXT START\n${extractedText}\nINVOICE TEXT END`;
  } else {
    return errorResponse("AI extraction supports JPEG, PNG, WebP, and digital PDF documents only.", 415);
  }

  let providerResponse: Response;
  try {
    const requestExtras = new URL(config.endpoint).hostname.endsWith("xiaomimimo.com")
      ? { thinking: { type: "disabled" } }
      : {};
    providerResponse = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
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
        ...requestExtras,
      }),
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
  } catch {
    return errorResponse("The AI extraction service could not be reached. Try again later.", 502);
  }

  if (!providerResponse.ok) {
    return errorResponse(`The AI extraction service could not process this document (HTTP ${providerResponse.status}).`, 502);
  }

  let providerJson: unknown;
  try {
    providerJson = await providerResponse.json();
  } catch {
    return errorResponse("The AI extraction service returned an unreadable response.", 502);
  }

  const envelope = AiResponseSchema.safeParse(providerJson);
  if (!envelope.success) return errorResponse("The AI extraction service returned an invalid response.", 502);

  let extractionJson: unknown;
  try {
    extractionJson = JSON.parse(envelope.data.choices[0].message.content);
  } catch {
    return errorResponse("AI extraction returned invalid structured invoice data.", 502);
  }

  const extraction = AiInvoiceExtractionSchema.safeParse(extractionJson);
  if (!extraction.success) {
    return errorResponse("AI extraction returned invoice data that did not match the required structure.", 502);
  }

  return Response.json({ extraction: extraction.data });
}
