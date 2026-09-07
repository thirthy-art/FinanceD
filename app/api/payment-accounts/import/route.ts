import { NextRequest, NextResponse } from "next/server";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { createPaymentImport, parsePaymentCsv, parsePaymentXlsx, PaymentImportError } from "@/src/lib/payment-ledger";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export async function POST(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req); if (company instanceof Response) return company;
  try {
    const data = await req.formData(); const file = data.get("file"); const rawAccountId = data.get("paymentAccountId");
    if (!(file instanceof File) || typeof rawAccountId !== "string" || !/^[1-9]\d*$/.test(rawAccountId)) return NextResponse.json({ error: "Select a payment account and file." }, { status: 400 });
    if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "Payment file exceeds the 25 MB upload limit." }, { status: 413 });
    const bytes = Buffer.from(await file.arrayBuffer()); const lower = file.name.toLowerCase();
    const ingestionSource = lower.endsWith(".csv") ? "csv" as const : lower.endsWith(".xlsx") ? "xlsx" as const : null;
    const parsed = ingestionSource === "csv" ? parsePaymentCsv(bytes.toString("utf8")) : ingestionSource === "xlsx" ? await parsePaymentXlsx(bytes) : null;
    if (!parsed) return NextResponse.json({ error: "Upload a CSV or XLSX file." }, { status: 400 });
    const result = await createPaymentImport(company.id, Number(rawAccountId), file.name, parsed.events, parsed.contentHash, ingestionSource!);
    return NextResponse.json({ importId: result.importId, eventCount: result.eventIds.length, reused: result.reused, skippedProviderDuplicates: result.skippedProviderDuplicates, overlapWarning: result.overlapWarning });
  } catch (error) {
    const status = error instanceof PaymentImportError ? 422 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment import could not be stored." }, { status });
  }
}
