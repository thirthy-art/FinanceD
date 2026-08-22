import { and, eq } from "drizzle-orm";
import { PDFParse } from "pdf-parse";
import { getDb } from "@/src/db";
import { supplierInvoiceDocuments, supplierInvoices } from "@/src/db/schema";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import {
  AI_EXTRACTION_PROMPT,
} from "@/src/lib/ai-extraction";
import { reconcileAiInvoiceExtraction } from "@/src/lib/ai-invoice-reconciliation";
import { getAiProviderCandidates } from "@/src/lib/ai-provider";
import { isKnownImageIncompatibleModel, runAiProviderChain } from "@/src/lib/ai-provider-chain";
import { DocumentNotFoundError, readDocument } from "@/src/lib/document-storage";

export const runtime = "nodejs";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BASE64_IMAGE_BYTES = 50 * 1024 * 1024;
// Total base64 size limit across all rendered PDF pages (50 MiB)
const MAX_SCANNED_PDF_TOTAL_BYTES = 50 * 1024 * 1024;

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}

function documentReadError(error: unknown) {
  return error instanceof DocumentNotFoundError
    ? errorResponse("The invoice document could not be read.", 404)
    : errorResponse("The document storage service is unavailable.", 503);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoiceId = Number(id);
  const forceImage = new URL(request.url).searchParams.get("mode") === "image";
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return errorResponse("Invalid invoice id.", 400);
  }

  const company = await getActiveCompanyFromRequest(request);
  if (company instanceof Response) return company;
  const db = getDb();
  const [document] = await db
    .select({
      mimeType: supplierInvoiceDocuments.mimeType,
      storagePath: supplierInvoiceDocuments.storagePath,
      extractedText: supplierInvoiceDocuments.extractedText,
      currencyType: supplierInvoices.currencyType,
    })
    .from(supplierInvoiceDocuments)
    .innerJoin(supplierInvoices, eq(supplierInvoiceDocuments.invoiceId, supplierInvoices.id))
    .where(and(
      eq(supplierInvoiceDocuments.invoiceId, invoiceId),
      eq(supplierInvoices.companyId, company.id),
    ))
    .limit(1);

  if (!document) return errorResponse("This invoice has no document to extract.", 404);

  let candidates: Awaited<ReturnType<typeof getAiProviderCandidates>>;
  try {
    candidates = await getAiProviderCandidates();
  } catch {
    return errorResponse("AI extraction configuration is temporarily unavailable.", 503);
  }
  if (candidates.length === 0) {
    return errorResponse("AI extraction is not configured on the server.", 503);
  }

  let userContent: string | Array<Record<string, unknown>>;
  let vision = false;

  if (IMAGE_MIME_TYPES.has(document.mimeType)) {
    vision = true;
    if (candidates.every((candidate) => isKnownImageIncompatibleModel(candidate.model))) {
      return errorResponse(
        "The configured AI model does not support image input. Choose an image-capable model for JPEG, PNG, or WebP invoices.",
        422,
      );
    }

    try {
      const image = await readDocument(document.storagePath);
      const base64Size = 4 * Math.ceil(image.length / 3);
      if (base64Size > MAX_BASE64_IMAGE_BYTES) {
        return errorResponse("The Base64-encoded invoice image exceeds the AI extraction service's 50 MiB limit.", 413);
      }
      userContent = [
        {
          type: "image_url",
          image_url: { url: `data:${document.mimeType};base64,${image.toString("base64")}` },
        },
        { type: "text", text: AI_EXTRACTION_PROMPT },
      ];
    } catch (error) {
      return documentReadError(error);
    }
  } else if (document.mimeType === "application/pdf") {
    const extractedText = document.extractedText?.trim();
    if (extractedText && !forceImage) {
      userContent = `${AI_EXTRACTION_PROMPT}\n\nINVOICE TEXT START\n${extractedText}\nINVOICE TEXT END`;
    } else {
      vision = true;
      // Scanned PDF fallback: render pages locally and send as images to AI
      if (candidates.every((candidate) => isKnownImageIncompatibleModel(candidate.model))) {
        return errorResponse(
          "The configured AI model does not support image input. Choose an image-capable model for scanned PDF invoices.",
          422,
        );
      }

      let pdfBytes: Buffer;
      try {
        pdfBytes = await readDocument(document.storagePath);
      } catch (error) {
        return documentReadError(error);
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

  const chainResult = await runAiProviderChain({
    candidates,
    userContent,
    vision,
    systemPrompt: "You extract supplier invoices faithfully. Follow the user's JSON schema and extraction rules exactly.",
  });
  if (chainResult.kind === "not-configured") {
    return errorResponse("AI extraction is not configured on the server.", 503);
  }
  if (chainResult.kind === "no-vision-provider") {
    return errorResponse("The configured AI models do not support image input.", 422);
  }
  if (chainResult.kind === "terminal-provider-error") {
    return errorResponse("The AI extraction service rejected this document.", 502);
  }
  if (chainResult.kind === "providers-exhausted") {
    return errorResponse("The configured AI extraction services could not return valid invoice data. Try again later.", 502);
  }

  const { extraction: reconciledExtraction, reconciliation } =
    reconcileAiInvoiceExtraction(chainResult.extraction, document.currencyType);

  return Response.json({
    extraction: reconciledExtraction,
    reconciliation,
    providerMetadata: chainResult.metadata,
  });
}
