import { NextRequest, NextResponse } from "next/server";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { deletePaymentAccount, PaymentLedgerDependencyError, PaymentLedgerNotFoundError } from "@/src/lib/payment-ledger";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const paymentAccountId = Number(id);
  if (!Number.isInteger(paymentAccountId) || paymentAccountId <= 0) return NextResponse.json({ error: "Invalid payment account id." }, { status: 400 });
  const company = await getActiveCompanyFromRequest(req); if (company instanceof Response) return company;
  try {
    return NextResponse.json(await deletePaymentAccount(company.id, paymentAccountId));
  } catch (error) {
    if (error instanceof PaymentLedgerNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof PaymentLedgerDependencyError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payment account could not be deleted." }, { status: 400 });
  }
}
