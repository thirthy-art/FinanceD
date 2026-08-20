import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { costCentres } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req);
  const db = getDb();
  const rows = await db
    .select()
    .from(costCentres)
    .where(eq(costCentres.companyId, company.id))
    .orderBy(costCentres.code);
  return NextResponse.json(rows);
}

const CreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const company = await getActiveCompanyFromRequest(req);
  const db = getDb();
  const [row] = await db
    .insert(costCentres)
    .values({ ...parsed.data, companyId: company.id })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
