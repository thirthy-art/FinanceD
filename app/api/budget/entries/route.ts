import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { budgetEntries, budgetCategories } from "@/src/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getOrCreateCompany } from "@/src/lib/db-helpers";
import { z } from "zod";
import { isValidMonth } from "@/src/lib/budget-actuals";
import { Decimal } from "@/src/lib/decimal";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");
  if (!year || !/^\d{4}$/.test(year))
    return NextResponse.json({ error: "year required (YYYY)" }, { status: 400 });

  const company = await getOrCreateCompany();
  const db = getDb();

  const rows = await db
    .select()
    .from(budgetEntries)
    .where(eq(budgetEntries.companyId, company.id));

  // Filter to requested year in JS (month is YYYY-MM)
  const filtered = rows.filter((r) => r.month.startsWith(year));
  return NextResponse.json(filtered);
}

const UpsertSchema = z.object({
  budgetCategoryId: z.number().int().positive(),
  month: z.string().refine(isValidMonth, { message: "month must be YYYY-MM" }),
  amount: z.string().refine((v) => {
    try { new Decimal(v); return true; } catch { return false; }
  }, { message: "amount must be a valid decimal" }),
  note: z.string().max(500).optional(),
  costCentreId: z.number().int().positive().nullable().optional(),
});

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const company = await getOrCreateCompany();
  const db = getDb();

  // Verify category belongs to company
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

  const { budgetCategoryId, month, amount, note, costCentreId } = parsed.data;

  // Find existing entry matching scope
  const existing = await db
    .select()
    .from(budgetEntries)
    .where(
      and(
        eq(budgetEntries.companyId, company.id),
        eq(budgetEntries.budgetCategoryId, budgetCategoryId),
        eq(budgetEntries.month, month)
      )
    );

  const matchingEntry = existing.find(
    (e) => (e.costCentreId ?? null) === (costCentreId ?? null)
  );

  const now = new Date();
  if (matchingEntry) {
    const [updated] = await db
      .update(budgetEntries)
      .set({ amount, note: note ?? null, updatedAt: now })
      .where(eq(budgetEntries.id, matchingEntry.id))
      .returning();
    return NextResponse.json(updated);
  } else {
    const [created] = await db
      .insert(budgetEntries)
      .values({
        companyId: company.id,
        budgetCategoryId,
        month,
        amount,
        note: note ?? null,
        costCentreId: costCentreId ?? null,
      })
      .returning();
    return NextResponse.json(created, { status: 201 });
  }
}

// Bulk upsert for a whole year's grid
const BulkUpsertSchema = z.object({
  entries: z.array(UpsertSchema),
});

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Check if it's a bulk or single entry
  if (Array.isArray(body?.entries)) {
    const parsed = BulkUpsertSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const company = await getOrCreateCompany();
    const db = getDb();

    const catIds = [...new Set(parsed.data.entries.map((e) => e.budgetCategoryId))];
    const cats = await db
      .select()
      .from(budgetCategories)
      .where(
        and(
          inArray(budgetCategories.id, catIds),
          eq(budgetCategories.companyId, company.id)
        )
      );
    const validCatIds = new Set(cats.map((c) => c.id));
    const invalid = catIds.find((id) => !validCatIds.has(id));
    if (invalid) return NextResponse.json({ error: `Category ${invalid} not found` }, { status: 404 });

    const now = new Date();
    const results = [];
    for (const entry of parsed.data.entries) {
      const { budgetCategoryId, month, amount, note, costCentreId } = entry;
      const existing = await db
        .select()
        .from(budgetEntries)
        .where(
          and(
            eq(budgetEntries.companyId, company.id),
            eq(budgetEntries.budgetCategoryId, budgetCategoryId),
            eq(budgetEntries.month, month)
          )
        );
      const matchingEntry = existing.find(
        (e) => (e.costCentreId ?? null) === (costCentreId ?? null)
      );
      if (matchingEntry) {
        const [updated] = await db
          .update(budgetEntries)
          .set({ amount, note: note ?? null, updatedAt: now })
          .where(eq(budgetEntries.id, matchingEntry.id))
          .returning();
        results.push(updated);
      } else {
        const [created] = await db
          .insert(budgetEntries)
          .values({
            companyId: company.id,
            budgetCategoryId,
            month,
            amount,
            note: note ?? null,
            costCentreId: costCentreId ?? null,
          })
          .returning();
        results.push(created);
      }
    }
    return NextResponse.json(results);
  }

  // Single entry (same as PUT)
  const parsed = UpsertSchema.safeParse(body);
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

  const { budgetCategoryId, month, amount, note, costCentreId } = parsed.data;
  const existing = await db
    .select()
    .from(budgetEntries)
    .where(
      and(
        eq(budgetEntries.companyId, company.id),
        eq(budgetEntries.budgetCategoryId, budgetCategoryId),
        eq(budgetEntries.month, month)
      )
    );
  const matchingEntry = existing.find(
    (e) => (e.costCentreId ?? null) === (costCentreId ?? null)
  );
  const now = new Date();
  if (matchingEntry) {
    const [updated] = await db
      .update(budgetEntries)
      .set({ amount, note: note ?? null, updatedAt: now })
      .where(eq(budgetEntries.id, matchingEntry.id))
      .returning();
    return NextResponse.json(updated);
  } else {
    const [created] = await db
      .insert(budgetEntries)
      .values({
        companyId: company.id,
        budgetCategoryId,
        month,
        amount,
        note: note ?? null,
        costCentreId: costCentreId ?? null,
      })
      .returning();
    return NextResponse.json(created, { status: 201 });
  }
}
