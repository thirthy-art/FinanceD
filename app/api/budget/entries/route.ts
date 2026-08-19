import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { budgetEntries, budgetCategories, costCentres } from "@/src/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getOrCreateCompany } from "@/src/lib/db-helpers";
import { z } from "zod";
import { isValidBudgetAmount, isValidMonth } from "@/src/lib/budget-actuals";

async function verifyCostCentre(
  db: ReturnType<typeof getDb>,
  costCentreId: number,
  companyId: number
): Promise<boolean> {
  const [cc] = await db
    .select({ id: costCentres.id })
    .from(costCentres)
    .where(
      and(
        eq(costCentres.id, costCentreId),
        eq(costCentres.companyId, companyId)
      )
    );
  return cc !== undefined;
}

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

  const filtered = rows.filter((r) => r.month.startsWith(year));
  return NextResponse.json(filtered);
}

const UpsertSchema = z.object({
  budgetCategoryId: z.number().int().positive(),
  month: z.string().refine(isValidMonth, { message: "month must be YYYY-MM" }),
  amount: z.string().refine(isValidBudgetAmount, {
    message: "amount must be finite, have at most 2 decimal places, and fit numeric(18,2)",
  }),
  note: z.string().max(500).optional(),
  costCentreId: z.number().int().positive().nullable().optional(),
});

export async function PUT(req: NextRequest) {
  const body = await req.json();
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

  if (costCentreId != null) {
    const valid = await verifyCostCentre(db, costCentreId, company.id);
    if (!valid) return NextResponse.json({ error: "Cost centre not found or does not belong to this company" }, { status: 422 });
  }

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

const BulkUpsertSchema = z.object({
  entries: z.array(UpsertSchema),
});

export async function POST(req: NextRequest) {
  const body = await req.json();

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
    const invalidCat = catIds.find((id) => !validCatIds.has(id));
    if (invalidCat) return NextResponse.json({ error: `Category ${invalidCat} not found` }, { status: 404 });

    // Validate all distinct non-null cost centre IDs up front
    const ccIds = [...new Set(
      parsed.data.entries
        .map((e) => e.costCentreId)
        .filter((id): id is number => id != null)
    )];
    if (ccIds.length) {
      const validCcs = await db
        .select({ id: costCentres.id })
        .from(costCentres)
        .where(
          and(
            inArray(costCentres.id, ccIds),
            eq(costCentres.companyId, company.id)
          )
        );
      const validCcIds = new Set(validCcs.map((c) => c.id));
      const invalidCc = ccIds.find((id) => !validCcIds.has(id));
      if (invalidCc) {
        return NextResponse.json(
          { error: `Cost centre ${invalidCc} not found or does not belong to this company` },
          { status: 422 }
        );
      }
    }

    const results = await db.transaction(async (tx) => {
      const now = new Date();
      const rows = [];
      for (const entry of parsed.data.entries) {
        const { budgetCategoryId, month, amount, note, costCentreId } = entry;
        const existing = await tx
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
          const [updated] = await tx
            .update(budgetEntries)
            .set({ amount, note: note ?? null, updatedAt: now })
            .where(eq(budgetEntries.id, matchingEntry.id))
            .returning();
          rows.push(updated);
        } else {
          const [created] = await tx
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
          rows.push(created);
        }
      }
      return rows;
    });
    return NextResponse.json(results);
  }

  // Single entry
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

  if (costCentreId != null) {
    const valid = await verifyCostCentre(db, costCentreId, company.id);
    if (!valid) return NextResponse.json({ error: "Cost centre not found or does not belong to this company" }, { status: 422 });
  }

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
