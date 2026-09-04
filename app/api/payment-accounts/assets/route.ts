import { NextRequest, NextResponse } from "next/server";
import { Decimal } from "@/src/lib/decimal";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { upsertAccountAsset } from "@/src/lib/payment-ledger";

const validDecimal = (value: unknown) => { if (typeof value !== "string") return false; try { return new Decimal(value).isFinite(); } catch { return false; } };
export async function POST(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req); if (company instanceof Response) return company;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.paymentAccountId !== "number" || !Number.isInteger(body.paymentAccountId) || typeof body.assetCode !== "string" || (body.assetType !== "fiat" && body.assetType !== "crypto") || !validDecimal(body.openingAvailableBalance) || !validDecimal(body.openingReserveBalance)) return NextResponse.json({ error: "Valid account, asset type, and Decimal opening balances are required." }, { status: 400 });
    const position = await upsertAccountAsset(company.id, { paymentAccountId: body.paymentAccountId, assetCode: body.assetCode, assetType: body.assetType, openingAvailableBalance: body.openingAvailableBalance as string, openingReserveBalance: body.openingReserveBalance as string, openingBalanceDate: typeof body.openingBalanceDate === "string" ? body.openingBalanceDate : null });
    return NextResponse.json({ position });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Asset position could not be saved." }, { status: 400 }); }
}
