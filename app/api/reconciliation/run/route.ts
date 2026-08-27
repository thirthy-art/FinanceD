import { NextRequest, NextResponse } from "next/server";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { runAndPersistReconciliation } from "@/src/lib/reconciliation";

export async function POST(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;

  try {
    const result = await runAndPersistReconciliation(company.id);
    return NextResponse.json({
      matched: result.matches.length,
      ambiguousCount: result.ambiguousIds.length,
      matchedPlayerIds: result.matchedPlayerIds,
      matchedPspIds: result.matchedPspIds,
    });
  } catch {
    return NextResponse.json(
      { error: "Reconciliation could not be produced. Please retry safely." },
      { status: 500 }
    );
  }
}