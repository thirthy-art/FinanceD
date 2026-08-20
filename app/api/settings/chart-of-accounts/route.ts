import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { chartOfAccounts } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  const db = getDb();
  const rows = await db
    .select()
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.companyId, company.id))
    .orderBy(chartOfAccounts.code);
  return NextResponse.json(rows);
}

const CreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  const db = getDb();
  const [row] = await db
    .insert(chartOfAccounts)
    .values({ ...parsed.data, companyId: company.id })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
