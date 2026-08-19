import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { budgetActualEntries, budgetCategories, costCentres } from "@/src/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrCreateCompany } from "@/src/lib/db-helpers";
import { z } from "zod";
import { isValidBudgetAmount, isValidMonth } from "@/src/lib/budget-actuals";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");
  if (!year || !/^\d{4}$/.test(year))
    return NextResponse.json({ error: "year required (YYYY)" }, { status: 400 });

  const company = await getOrCreateCompany();
  const db = getDb();
  const rows = await db
    .select()
    .from(budgetActualEntries)
    .where(eq(budgetActualEntries.companyId, company.id));

  const filtered = rows.filter((r) => r.month.startsWith(year));
  return NextResponse.json(filtered);
}

const CreateSchema = z.object({
  budgetCategoryId: z.number().int().positive(),
  month: z.string().refine(isValidMonth, { message: "month must be YYYY-MM" }),
  amount: z.string().refine(isValidBudgetAmount, {
    message: "amount must be finite, have at most 2 decimal places, and fit numeric(18,2)",
  }),
  description: z.string().max(500).optional(),
  source: z.string().max(100).optional(),
  costCentreId: z.number().int().positive().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const company = await getOrCreateCompany();
  const db = getDb();

  const [cat] = await db
    .select()
    .from(budgetCategories)
    .where(
      and(
        eq(budgetCategories.id, parsed.data.budgetCategoryId),
        eq(budgetCategories.companyId, company.id)
      )
    );
  if (!cat) return NextResponse.json({ error: "Category not found" }, { status: 404 });

  const { budgetCategoryId, month, amount, description, source, costCentreId } = parsed.data;

  if (costCentreId != null) {
    const [cc] = await db
      .select({ id: costCentres.id })
      .from(costCentres)
      .where(
        and(
          eq(costCentres.id, costCentreId),
          eq(costCentres.companyId, company.id)
        )
      );
    if (!cc) return NextResponse.json({ error: "Cost centre not found or does not belong to this company" }, { status: 422 });
  }

  const [row] = await db
    .insert(budgetActualEntries)
    .values({
      companyId: company.id,
      budgetCategoryId,
      month,
      amount,
      description: description ?? null,
      source: source ?? "Manual",
      costCentreId: costCentreId ?? null,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const idParam = searchParams.get("id");
  const entryId = parseInt(idParam ?? "", 10);
  if (isNaN(entryId)) return NextResponse.json({ error: "id required" }, { status: 400 });

  const company = await getOrCreateCompany();
  const db = getDb();

  await db
    .delete(budgetActualEntries)
    .where(
      and(
        eq(budgetActualEntries.id, entryId),
        eq(budgetActualEntries.companyId, company.id)
      )
    );

  return NextResponse.json({ ok: true });
}
