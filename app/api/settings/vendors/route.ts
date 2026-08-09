import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { vendors } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateCompany } from "@/src/lib/db-helpers";
import { z } from "zod";

export async function GET() {
  const company = await getOrCreateCompany();
  const db = getDb();
  const rows = await db
    .select()
    .from(vendors)
    .where(eq(vendors.companyId, company.id))
    .orderBy(vendors.name);
  return NextResponse.json(rows);
}

const CreateSchema = z.object({
  name: z.string().min(1),
  taxId: z.string().optional(),
  address: z.string().optional(),
  defaultCurrency: z.string().length(3).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const company = await getOrCreateCompany();
  const db = getDb();
  const [row] = await db
    .insert(vendors)
    .values({ ...parsed.data, companyId: company.id })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
