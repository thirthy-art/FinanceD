import { NextRequest, NextResponse } from "next/server";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { deletePaymentEvent, PaymentLedgerDependencyError, PaymentLedgerNotFoundError, updatePaymentEvent } from "@/src/lib/payment-ledger";
import type { AssetType, BalanceDirection, PaymentEventType } from "@/src/lib/payment-ledger";

const EVENT_TYPES = new Set<PaymentEventType>(["deposit", "withdrawal", "refund", "chargeback", "fee", "adjustment", "settlement", "transfer", "reserve_hold", "reserve_release", "conversion", "unknown"]);
const DIRECTIONS = new Set<BalanceDirection>(["credit", "debit", "none"]);

function eventId(raw: string) { const id = Number(raw); return Number.isInteger(id) && id > 0 ? id : null; }
function mutationError(error: unknown) {
  if (error instanceof PaymentLedgerNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof PaymentLedgerDependencyError) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ error: error instanceof Error ? error.message : "Payment transaction could not be changed." }, { status: 400 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = eventId((await params).id); if (id === null) return NextResponse.json({ error: "Invalid payment transaction id." }, { status: 400 });
  const company = await getActiveCompanyFromRequest(req); if (company instanceof Response) return company;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.eventDate !== "string" || typeof body.eventType !== "string" || !EVENT_TYPES.has(body.eventType as PaymentEventType)
      || typeof body.balanceDirection !== "string" || !DIRECTIONS.has(body.balanceDirection as BalanceDirection)
      || typeof body.balanceAmount !== "string" || typeof body.balanceAssetCode !== "string"
      || (body.balanceAssetType !== "fiat" && body.balanceAssetType !== "crypto")
      || (body.reference !== null && typeof body.reference !== "string")) {
      return NextResponse.json({ error: "Valid transaction business fields are required." }, { status: 400 });
    }
    const event = await updatePaymentEvent(company.id, id, {
      eventDate: body.eventDate, eventType: body.eventType as PaymentEventType, balanceDirection: body.balanceDirection as BalanceDirection,
      balanceAmount: body.balanceAmount, balanceAssetCode: body.balanceAssetCode, balanceAssetType: body.balanceAssetType as AssetType,
      reference: body.reference,
    });
    return NextResponse.json({ event });
  } catch (error) { return mutationError(error); }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = eventId((await params).id); if (id === null) return NextResponse.json({ error: "Invalid payment transaction id." }, { status: 400 });
  const company = await getActiveCompanyFromRequest(req); if (company instanceof Response) return company;
  try { return NextResponse.json(await deletePaymentEvent(company.id, id)); }
  catch (error) { return mutationError(error); }
}
