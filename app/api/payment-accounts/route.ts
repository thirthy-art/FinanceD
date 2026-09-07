import { NextRequest, NextResponse } from "next/server";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { createPaymentAccount, setClientFundsEligibility } from "@/src/lib/payment-ledger";
import type { PaymentAccountType } from "@/src/lib/payment-ledger";

const TYPES = new Set<PaymentAccountType>(["psp", "wallet", "exchange", "bank", "other"]);
export async function POST(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req); if (company instanceof Response) return company;
  try {
    const body = await req.json() as { name?: unknown; providerName?: unknown; accountType?: unknown; clientFundsEligible?: unknown };
    if (typeof body.name !== "string" || typeof body.accountType !== "string" || !TYPES.has(body.accountType as PaymentAccountType)) return NextResponse.json({ error: "A valid name and account type are required." }, { status: 400 });
    const account = await createPaymentAccount(company.id, { name: body.name, providerName: typeof body.providerName === "string" ? body.providerName : null, accountType: body.accountType as PaymentAccountType, clientFundsEligible: typeof body.clientFundsEligible === "boolean" ? body.clientFundsEligible : undefined });
    return NextResponse.json({ account });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Account could not be created." }, { status: 400 }); }
}

export async function PATCH(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req); if (company instanceof Response) return company;
  try {
    const body = await req.json() as { paymentAccountId?: unknown; clientFundsEligible?: unknown };
    if (typeof body.paymentAccountId !== "number" || !Number.isInteger(body.paymentAccountId) || typeof body.clientFundsEligible !== "boolean") return NextResponse.json({ error: "Valid account and eligibility are required." }, { status: 400 });
    return NextResponse.json({ account: await setClientFundsEligibility(company.id, body.paymentAccountId, body.clientFundsEligible) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Account could not be updated." }, { status: 400 }); }
}
