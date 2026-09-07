import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthenticationRequiredError,
  getAuthorizedCompanies,
  setActiveCompanyCookie,
} from "@/src/lib/active-company";

const SelectCompanySchema = z.object({
  companyId: z.number().int().positive(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = SelectCompanySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let authorized;
  try {
    authorized = await getAuthorizedCompanies();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 401 });
    }
    throw error;
  }
  const company = authorized.find((row) => row.id === parsed.data.companyId);
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  return setActiveCompanyCookie(NextResponse.json({
    id: company.id,
    name: company.name,
    baseCurrency: company.baseCurrency,
  }), company.id);
}
