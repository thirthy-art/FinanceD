import { readFile, stat } from "fs/promises";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { PDFParse } from "pdf-parse";
import { getDb } from "@/src/db";
import { supplierInvoiceDocuments, supplierInvoices } from "@/src/db/schema";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import {
  AI_EXTRACTION_PROMPT,
  AiInvoiceExtractionSchema,
} from "@/src/lib/ai-extraction";
import { getAiProviderConfig } from "@/src/lib/ai-provider";

export const runtime = "nodejs";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BASE64_IMAGE_BYTES = 50 * 1024 * 1024;
// Total base64 size limit across all rendered PDF pages (50 MiB)
const MAX_SCANNED_PDF_TOTAL_BYTES = 50 * 1024 * 1024;

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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return errorResponse("Invalid invoice id.", 400);
  }

  const company = await getActiveCompanyFromRequest(request);
  const db = getDb();
  const [document] = await db
    .select({
      mimeType: supplierInvoiceDocuments.mimeType,
      storagePath: supplierInvoiceDocuments.storagePath,
      extractedText: supplierInvoiceDocuments.extractedText,
    })
    .from(supplierInvoiceDocuments)
    .innerJoin(supplierInvoices, eq(supplierInvoiceDocuments.invoiceId, supplierInvoices.id))
    .where(and(
      eq(supplierInvoiceDocuments.invoiceId, invoiceId),
      eq(supplierInvoices.companyId, company.id),
    ))
    .limit(1);

  if (!document) return errorResponse("This invoice has no document to extract.", 404);

  const config = getAiProviderConfig();
  if (!config.ok) return errorResponse(config.error, 503);

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
    if (extractedText) {
      userContent = `${AI_EXTRACTION_PROMPT}\n\nINVOICE TEXT START\n${extractedText}\nINVOICE TEXT END`;
    } else {
      // Scanned PDF fallback: render pages locally and send as images to AI
      if (config.model === "mimo-v2.5-pro") {
        return errorResponse(
          "The configured AI model does not support image input. Choose an image-capable model for scanned PDF invoices.",
          422,
        );
      }

      let pdfBytes: Buffer;
      try {
        pdfBytes = await readFile(document.storagePath);
      } catch {
        return errorResponse("The invoice document could not be read.", 404);
      }

      const parser = new PDFParse({ data: pdfBytes });
      let screenshotResult: Awaited<ReturnType<PDFParse["getScreenshot"]>>;
      try {
        screenshotResult = await parser.getScreenshot({
          desiredWidth: 1600,
          imageDataUrl: true,
          imageBuffer: false,
        });
      } catch {
        return errorResponse("The PDF pages could not be rendered for AI extraction.", 422);
      } finally {
        await parser.destroy().catch(() => undefined);
      }

      if (screenshotResult.pages.length === 0) {
        return errorResponse("No pages could be rendered from this PDF.", 422);
      }

      // Guard against absurdly large payloads before sending to the AI provider.
      // dataUrl strings are already base64, so their .length approximates byte count.
      const totalBytes = screenshotResult.pages.reduce(
        (sum, page) => sum + page.dataUrl.length,
        0,
      );
      if (totalBytes > MAX_SCANNED_PDF_TOTAL_BYTES) {
        return errorResponse(
          `The rendered PDF (${screenshotResult.pages.length} page${screenshotResult.pages.length === 1 ? "" : "s"}) exceeds the AI extraction size limit. Split the document and try again.`,
          413,
        );
      }

      // Build multimodal content: one image_url item per page in document order
      userContent = [
        ...screenshotResult.pages.map((page) => ({
          type: "image_url",
          image_url: { url: page.dataUrl },
        })),
        { type: "text", text: AI_EXTRACTION_PROMPT },
      ];
    }
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
