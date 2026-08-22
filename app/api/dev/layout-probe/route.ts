import path from "node:path";
import { pathToFileURL } from "node:url";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPdfLayoutEvidence } from "@/src/lib/experimental/pdf-layout-evidence";
import { clusterEvidenceTables } from "@/src/lib/experimental/layout-table-clustering";
import {
  hasPdfMagicBytes,
  MAX_LAYOUT_PROBE_BYTES,
  MAX_LAYOUT_PROBE_LABEL,
  validateLayoutProbeFile,
} from "@/app/dev/layout-probe/layout-probe-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Multipart framing overhead allowed on top of the file budget itself.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Developer-only deterministic layout evidence probe. The uploaded bytes live
 * only for this request: they are never written to disk, the database, or logs.
 * No OCR and no invoice field parsing happen here.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return json({ error: "Not found." }, 404);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_LAYOUT_PROBE_BYTES + MULTIPART_OVERHEAD_BYTES
  ) {
    return json({ error: `The PDF must be at most ${MAX_LAYOUT_PROBE_LABEL}.` }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Expected multipart form data with one PDF file." }, 400);
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return json({ error: "Attach exactly one PDF file." }, 400);
  }

  const validationError = validateLayoutProbeFile(file);
  if (validationError) {
    return json({ error: validationError }, file.size > MAX_LAYOUT_PROBE_BYTES ? 413 : 422);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfMagicBytes(bytes)) {
    return json({ error: "The file is not a valid PDF." }, 422);
  }

  // Under Turbopack, pdfjs resolves its fake worker relative to the bundled chunk,
  // where the worker file is not emitted. Pin it to the real file in node_modules.
  // Only runs behind the development gate, so production pdfjs usage is untouched.
  GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
  ).href;

  try {
    const evidence = await extractPdfLayoutEvidence(bytes);
    const tables = clusterEvidenceTables(evidence);
    return json({ evidence, tables }, 200);
  } catch {
    return json({ error: "Layout evidence extraction failed for this PDF." }, 422);
  }
}
