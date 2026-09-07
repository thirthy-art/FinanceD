import { NextRequest, NextResponse } from "next/server";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import {
  ReconciliationImportError,
  parseReconciliationCsv,
  parseReconciliationXlsx,
} from "@/src/lib/reconciliation";
import { createImport } from "@/src/lib/reconciliation/service";
import type { ReconciliationSource } from "@/src/lib/reconciliation/types";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function isReconciliationSource(value: FormDataEntryValue | null): value is ReconciliationSource {
  return value === "player_ledger" || value === "psp_transactions";
}

export async function POST(req: NextRequest) {
  let data: FormData;
  try {
    data = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

  const file = data.get("file");
  const sourceValue = data.get("source");

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (!isReconciliationSource(sourceValue)) {
    return NextResponse.json(
      { error: "Missing or invalid reconciliation source." },
      { status: 400 }
    );
  }
  if (sourceValue === "psp_transactions") {
    return NextResponse.json(
      { error: "PSP and wallet files must be uploaded once in PSPs & Wallets → Transactions." },
      { status: 409 }
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Reconciliation file exceeds the 25 MB upload limit." },
      { status: 413 }
    );
  }

  const originalFilename = file.name;
  const lower = originalFilename.toLowerCase();
  const isXlsx = lower.endsWith(".xlsx");
  const isCsv = lower.endsWith(".csv");
  if (!isXlsx && !isCsv) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a CSV or XLSX file." },
      { status: 400 }
    );
  }

  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "The file could not be read. Please retry." }, { status: 500 });
  }

  let parsed;
  try {
    parsed = isXlsx
      ? await parseReconciliationXlsx(sourceValue, bytes)
      : parseReconciliationCsv(sourceValue, bytes.toString("utf8"));
  } catch (error) {
    if (error instanceof ReconciliationImportError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json({ error: "The file could not be parsed. Please check the format." }, { status: 422 });
  }

  try {
    const result = await createImport(
      company.id,
      sourceValue,
      originalFilename,
      parsed.transactions,
      parsed.contentHash
    );
    return NextResponse.json({
      importId: result.importId,
      transactionCount: result.transactionIds.length,
      reused: result.reused,
      source: sourceValue,
    });
  } catch {
    return NextResponse.json(
      { error: "The import could not be stored. Please retry safely." },
      { status: 500 }
    );
  }
}
