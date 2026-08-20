import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/src/db";
import { companies } from "@/src/db/schema";
import {
  getActiveCompanyFromRequest,
  setActiveCompanyCookie,
} from "@/src/lib/active-company";

const CreateCompanySchema = z.object({
  name: z.string().trim().min(1).max(255),
  baseCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
});

export async function GET(request: Request) {
  const activeCompany = await getActiveCompanyFromRequest(request);
  const rows = await getDb()
    .select({ id: companies.id, name: companies.name, baseCurrency: companies.baseCurrency })
    .from(companies)
    .orderBy(asc(companies.id));
  return NextResponse.json({ companies: rows, activeCompanyId: activeCompany.id });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = CreateCompanySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [company] = await getDb()
    .insert(companies)
    .values(parsed.data)
    .returning({ id: companies.id, name: companies.name, baseCurrency: companies.baseCurrency });
  return setActiveCompanyCookie(NextResponse.json(company, { status: 201 }), company.id);
}
