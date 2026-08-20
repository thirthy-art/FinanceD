import { NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { budgetCategories } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";

const STARTER_CATEGORIES = [
  "HR",
  "Marketing",
  "Software / IT",
  "Office & Administration",
  "Professional Services",
  "Travel",
  "Rent & Premises",
  "Regulatory & Licences",
  "Banking & PSP Fees",
  "Other Operating Expenses",
];

export async function POST(req: Request) {
  const company = await getActiveCompanyFromRequest(req);
  const db = getDb();

  const existing = await db
    .select({ name: budgetCategories.name })
    .from(budgetCategories)
    .where(eq(budgetCategories.companyId, company.id));

  const existingNames = new Set(existing.map((r) => r.name));
  const toInsert = STARTER_CATEGORIES.filter((name) => !existingNames.has(name));

  if (!toInsert.length) {
    return NextResponse.json({ created: 0, message: "All starter categories already exist" });
  }

  const rows = await db
    .insert(budgetCategories)
    .values(
      toInsert.map((name, i) => ({
        companyId: company.id,
        name,
        sortOrder: i,
      }))
    )
    .returning();

  return NextResponse.json({ created: rows.length, categories: rows });
}
