import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";
import { extractPdfText, parseInvoiceFields } from "../src/lib/extract";
import {
  DOCUMENT_EVIDENCE_VERSION,
  type DocumentEvidence,
} from "../src/lib/experimental/document-evidence";
import { clusterEvidenceTables } from "../src/lib/experimental/layout-table-clustering";
import { extractImageOcrLayoutEvidence } from "../src/lib/experimental/ocr-layout-evidence";
import { extractPdfLayoutEvidence } from "../src/lib/experimental/pdf-layout-evidence";

const MAX_PROBE_BYTES = 25 * 1024 * 1024;
const MAX_OCR_PAGES = 5;

function usage(): never {
  throw new Error("Usage: npm run probe:layout -- <explicit-local.pdf> [--ocr]");
}

export function parseProbeArguments(args: string[]): { localPathArg: string; ocr: boolean } {
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const flags = args.filter((arg) => arg.startsWith("--"));
  if (
    positional.length !== 1 ||
    flags.some((flag) => flag !== "--ocr") ||
    new Set(flags).size !== flags.length
  ) usage();
  return { localPathArg: positional[0], ocr: flags.includes("--ocr") };
}

async function extractBoundedPdfOcr(bytes: Buffer): Promise<DocumentEvidence> {
  const parser = new PDFParse({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    const info = await parser.getInfo();
    if (info.total > MAX_OCR_PAGES) {
      throw new Error(`Experimental OCR is limited to ${MAX_OCR_PAGES} PDF pages.`);
    }
    const screenshots = await parser.getScreenshot({
      desiredWidth: 1600,
      imageBuffer: true,
      imageDataUrl: false,
    });
    const pages: DocumentEvidence["pages"] = [];
    for (const screenshot of screenshots.pages) {
      const evidence = await extractImageOcrLayoutEvidence(screenshot.data, {
        width: screenshot.width,
        height: screenshot.height,
        page: screenshot.pageNumber,
      });
      pages.push(...evidence.pages);
    }
    return {
      formatVersion: DOCUMENT_EVIDENCE_VERSION,
      extractorVersion: "pdf-render-1600+tesseract-js-7-layout-v1",
      source: "ocr-word",
      pages,
    };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const { localPathArg, ocr } = parseProbeArguments(args);

  const localPath = path.resolve(localPathArg);
  if (path.extname(localPath).toLowerCase() !== ".pdf") usage();
  const metadata = await stat(localPath);
  if (!metadata.isFile() || metadata.size > MAX_PROBE_BYTES) {
    throw new Error("The probe requires a PDF file no larger than 25 MiB.");
  }
  const bytes = await readFile(localPath);
  if (bytes.length > MAX_PROBE_BYTES) {
    throw new Error("The probe requires a PDF file no larger than 25 MiB.");
  }
  const current = await extractPdfText(bytes);
  const layoutEvidence = await extractPdfLayoutEvidence(bytes);
  const result: Record<string, unknown> = {
    warning: "Experimental comparison output may contain invoice text. It is written to stdout only.",
    currentExtraction: {
      text: current.text,
      fields: parseInvoiceFields(current.text),
    },
    layoutEvidence,
    tableCandidates: clusterEvidenceTables(layoutEvidence),
  };
  if (ocr) result.ocrEvidence = await extractBoundedPdfOcr(bytes);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedUrl) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Layout probe failed."}\n`);
    process.exitCode = 1;
  });
}
