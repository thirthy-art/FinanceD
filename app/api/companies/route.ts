import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/src/db";
import { companies } from "@/src/db/schema";
import {
  activeCompanyIdFromRequest,
  resolveActiveCompany,
  setActiveCompanyCookie,
} from "@/src/lib/active-company";

const CreateCompanySchema = z.object({
  name: z.string().trim().min(1).max(255),
  baseCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
});

export async function GET(request: Request) {
  let rows = await getDb()
    .select({ id: companies.id, name: companies.name, baseCurrency: companies.baseCurrency })
    .from(companies)
    .orderBy(asc(companies.id));
  if (rows.length === 0) {
    const company = await resolveActiveCompany();
    rows = [{ id: company.id, name: company.name, baseCurrency: company.baseCurrency }];
  }

  const requestedId = activeCompanyIdFromRequest(request);
  const selected = requestedId === null ? undefined : rows.find((company) => company.id === requestedId);
  const activeCompanyId = selected?.id ?? (rows.length === 1 ? rows[0].id : null);
  return NextResponse.json({ companies: rows, activeCompanyId });
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
