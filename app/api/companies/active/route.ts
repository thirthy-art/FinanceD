import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/src/db";
import { companies } from "@/src/db/schema";
import { setActiveCompanyCookie } from "@/src/lib/active-company";

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

  const [company] = await getDb()
    .select({ id: companies.id, name: companies.name, baseCurrency: companies.baseCurrency })
    .from(companies)
    .where(eq(companies.id, parsed.data.companyId))
    .limit(1);
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  return setActiveCompanyCookie(NextResponse.json(company), company.id);
}
