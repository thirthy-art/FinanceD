import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { budgetCategories } from "@/src/db/schema";
import { eq, asc } from "drizzle-orm";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  const db = getDb();
  const rows = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.companyId, company.id))
    .orderBy(asc(budgetCategories.sortOrder), asc(budgetCategories.name));
  return NextResponse.json(rows);
}

const CreateSchema = z.object({
  name: z.string().min(1).max(255),
  sortOrder: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  const db = getDb();
  try {
    const [row] = await db
      .insert(budgetCategories)
      .values({
        companyId: company.id,
        name: parsed.data.name,
        sortOrder: parsed.data.sortOrder ?? 0,
      })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Category name already exists" }, { status: 409 });
  }
}
