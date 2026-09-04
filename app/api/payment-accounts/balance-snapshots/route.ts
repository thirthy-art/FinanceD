import { NextRequest, NextResponse } from "next/server";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { createReportedBalanceSnapshot } from "@/src/lib/payment-ledger";

export async function POST(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req); if (company instanceof Response) return company;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.paymentAccountId !== "number" || !Number.isInteger(body.paymentAccountId) || typeof body.assetCode !== "string" || (body.assetType !== "fiat" && body.assetType !== "crypto") || typeof body.reportedAvailableBalance !== "string" || typeof body.asOf !== "string") return NextResponse.json({ error: "Valid account, asset, reported balance, and as-of date are required." }, { status: 400 });
    const snapshot = await createReportedBalanceSnapshot(company.id, { paymentAccountId: body.paymentAccountId, assetCode: body.assetCode, assetType: body.assetType, reportedAvailableBalance: body.reportedAvailableBalance, reportedReserveBalance: typeof body.reportedReserveBalance === "string" && body.reportedReserveBalance !== "" ? body.reportedReserveBalance : null, asOf: body.asOf, ingestionSource: "api", providerSnapshotId: typeof body.providerSnapshotId === "string" ? body.providerSnapshotId : null });
    return NextResponse.json({ snapshot });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Balance snapshot could not be saved." }, { status: 400 }); }
}
