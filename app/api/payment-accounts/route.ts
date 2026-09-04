import { NextRequest, NextResponse } from "next/server";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { createPaymentAccount } from "@/src/lib/payment-ledger";
import type { PaymentAccountType } from "@/src/lib/payment-ledger";

const TYPES = new Set<PaymentAccountType>(["psp", "wallet", "exchange", "bank", "other"]);
export async function POST(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req); if (company instanceof Response) return company;
  try {
    const body = await req.json() as { name?: unknown; providerName?: unknown; accountType?: unknown };
    if (typeof body.name !== "string" || typeof body.accountType !== "string" || !TYPES.has(body.accountType as PaymentAccountType)) return NextResponse.json({ error: "A valid name and account type are required." }, { status: 400 });
    const account = await createPaymentAccount(company.id, { name: body.name, providerName: typeof body.providerName === "string" ? body.providerName : null, accountType: body.accountType as PaymentAccountType });
    return NextResponse.json({ account });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Account could not be created." }, { status: 400 }); }
}
