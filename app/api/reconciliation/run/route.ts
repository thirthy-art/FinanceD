import { NextRequest, NextResponse } from "next/server";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import {
  ReconciliationSelectionError,
  runAndPersistReconciliation,
} from "@/src/lib/reconciliation";

export async function POST(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;

  try {
    const body = await req.json().catch(() => ({})) as {
      playerLedgerImportId?: unknown;
      pspImportId?: unknown;
    };
    const playerLedgerImportId = optionalPositiveInteger(body.playerLedgerImportId);
    const pspImportId = optionalPositiveInteger(body.pspImportId);
    if (playerLedgerImportId === null || pspImportId === null) {
      return NextResponse.json({ error: "Invalid reconciliation import selection." }, { status: 400 });
    }
    const result = await runAndPersistReconciliation(company.id, {
      playerLedgerImportId,
      pspImportId,
    });
    return NextResponse.json({
      runId: result.runId,
      playerLedgerImportId: result.playerLedgerImportId,
      pspImportId: result.pspImportId,
      matched: result.matches.length,
      ambiguousCount: result.ambiguousIds.length,
      matchedPlayerIds: result.matchedPlayerIds,
      matchedPspIds: result.matchedPspIds,
    });
  } catch (error) {
    if (error instanceof ReconciliationSelectionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Reconciliation could not be produced. Please retry safely." },
      { status: 500 }
    );
  }
}

function optionalPositiveInteger(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}
