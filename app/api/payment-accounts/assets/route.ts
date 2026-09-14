import { NextRequest, NextResponse } from "next/server";
import { Decimal } from "@/src/lib/decimal";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { createAccountAsset, deleteAccountAsset, PaymentLedgerNotFoundError, updateAccountAsset } from "@/src/lib/payment-ledger";

const validDecimal = (value: unknown) => { if (typeof value !== "string") return false; try { return new Decimal(value).isFinite(); } catch { return false; } };
export async function POST(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req); if (company instanceof Response) return company;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.paymentAccountId !== "number" || !Number.isInteger(body.paymentAccountId) || typeof body.assetCode !== "string" || (body.assetType !== "fiat" && body.assetType !== "crypto") || !validDecimal(body.openingAvailableBalance) || !validDecimal(body.openingReserveBalance)) return NextResponse.json({ error: "Valid account, asset type, and Decimal opening balances are required." }, { status: 400 });
    if (typeof body.openingBalanceDate !== "string" || body.openingBalanceDate === "") return NextResponse.json({ error: "Opening balance date is required." }, { status: 400 });
    const position = await createAccountAsset(company.id, { paymentAccountId: body.paymentAccountId, assetCode: body.assetCode, assetType: body.assetType, openingAvailableBalance: body.openingAvailableBalance as string, openingReserveBalance: body.openingReserveBalance as string, openingBalanceDate: body.openingBalanceDate });
    return NextResponse.json({ position });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Asset position could not be saved." }, { status: 400 }); }
}

export async function PATCH(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req); if (company instanceof Response) return company;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (body.confirmOverwrite !== true) return NextResponse.json({ error: "Explicit confirmation is required to replace an existing opening balance." }, { status: 400 });
    if (typeof body.paymentAccountId !== "number" || !Number.isInteger(body.paymentAccountId) || typeof body.assetCode !== "string" || (body.assetType !== "fiat" && body.assetType !== "crypto") || !validDecimal(body.openingAvailableBalance) || !validDecimal(body.openingReserveBalance)) return NextResponse.json({ error: "Valid account, asset type, and Decimal opening balances are required." }, { status: 400 });
    if (typeof body.openingBalanceDate !== "string" || body.openingBalanceDate === "") return NextResponse.json({ error: "Opening balance date is required." }, { status: 400 });
    const position = await updateAccountAsset(company.id, { paymentAccountId: body.paymentAccountId, assetCode: body.assetCode, assetType: body.assetType, openingAvailableBalance: body.openingAvailableBalance as string, openingReserveBalance: body.openingReserveBalance as string, openingBalanceDate: body.openingBalanceDate });
    return NextResponse.json({ position });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Asset position could not be updated." }, { status: 400 }); }
}

export async function DELETE(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req); if (company instanceof Response) return company;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.paymentAccountId !== "number" || !Number.isInteger(body.paymentAccountId) || typeof body.assetCode !== "string") return NextResponse.json({ error: "Valid account and asset are required." }, { status: 400 });
    await deleteAccountAsset(company.id, body.paymentAccountId, body.assetCode);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const status = error instanceof PaymentLedgerNotFoundError ? 404 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Opening balance could not be deleted." }, { status });
  }
}
