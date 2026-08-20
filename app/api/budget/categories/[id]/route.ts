import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { budgetCategories } from "@/src/db/schema";
import { eq, and } from "drizzle-orm";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { z } from "zod";

const PatchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const categoryId = parseInt(id, 10);
  if (isNaN(categoryId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  const db = getDb();

  try {
    const updated = await db
      .update(budgetCategories)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(budgetCategories.id, categoryId),
          eq(budgetCategories.companyId, company.id)
        )
      )
      .returning();

    if (!updated.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated[0]);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "Category name already exists" }, { status: 409 });
    }
    throw err;
  }
}
