import { NextRequest, NextResponse } from "next/server";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { createFeeRule, createReserveRule } from "@/src/lib/payment-ledger";
import type { FeeBasis, PaymentEventType } from "@/src/lib/payment-ledger";

export async function POST(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req); if (company instanceof Response) return company;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.paymentAccountId !== "number" || !Number.isInteger(body.paymentAccountId) || typeof body.effectiveFrom !== "string") return NextResponse.json({ error: "Valid account and effective date are required." }, { status: 400 });
    if (body.kind === "fee" && typeof body.eventType === "string" && (body.feeBasis === "source_amount" || body.feeBasis === "balance_amount") && typeof body.feeAssetCode === "string" && typeof body.percentageRate === "string" && typeof body.fixedAmount === "string") {
      return NextResponse.json({ rule: await createFeeRule(company.id, { paymentAccountId: body.paymentAccountId, eventType: body.eventType as PaymentEventType, feeBasis: body.feeBasis as FeeBasis, assetCode: typeof body.assetCode === "string" ? body.assetCode : null, feeAssetCode: body.feeAssetCode, percentageRate: body.percentageRate, fixedAmount: body.fixedAmount, effectiveFrom: body.effectiveFrom, effectiveTo: typeof body.effectiveTo === "string" ? body.effectiveTo : null }) });
    }
    if (body.kind === "reserve") {
      return NextResponse.json({ rule: await createReserveRule(company.id, { paymentAccountId: body.paymentAccountId, assetCode: typeof body.assetCode === "string" ? body.assetCode : null, reservePercentage: typeof body.reservePercentage === "string" ? body.reservePercentage : null, holdPeriodDays: typeof body.holdPeriodDays === "number" ? body.holdPeriodDays : null, effectiveFrom: body.effectiveFrom, effectiveTo: typeof body.effectiveTo === "string" ? body.effectiveTo : null }) });
    }
    return NextResponse.json({ error: "Invalid rule." }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Rule could not be saved." }, { status: 400 }); }
}
