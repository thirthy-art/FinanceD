import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { budgetCategories, budgetCategoryAccounts, chartOfAccounts } from "@/src/db/schema";
import { eq, and } from "drizzle-orm";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { z } from "zod";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const categoryId = parseInt(id, 10);
  if (isNaN(categoryId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  const db = getDb();

  // Verify category belongs to company
  const [cat] = await db
    .select()
    .from(budgetCategories)
    .where(and(eq(budgetCategories.id, categoryId), eq(budgetCategories.companyId, company.id)));
  if (!cat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select({
      id: budgetCategoryAccounts.id,
      accountId: budgetCategoryAccounts.accountId,
      accountCode: chartOfAccounts.code,
      accountName: chartOfAccounts.name,
    })
    .from(budgetCategoryAccounts)
    .innerJoin(chartOfAccounts, eq(budgetCategoryAccounts.accountId, chartOfAccounts.id))
    .where(and(
      eq(budgetCategoryAccounts.budgetCategoryId, categoryId),
      eq(chartOfAccounts.companyId, company.id),
    ));

  return NextResponse.json(rows);
}

const AddSchema = z.object({
  accountId: z.number().int().positive(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const categoryId = parseInt(id, 10);
  if (isNaN(categoryId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json();
  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  const db = getDb();

  // Verify category belongs to company
  const [cat] = await db
    .select()
    .from(budgetCategories)
    .where(and(eq(budgetCategories.id, categoryId), eq(budgetCategories.companyId, company.id)));
  if (!cat) return NextResponse.json({ error: "Category not found" }, { status: 404 });

  // Verify account belongs to company and is an expense posting account
  const [acct] = await db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.id, parsed.data.accountId),
        eq(chartOfAccounts.companyId, company.id)
      )
    );
  if (!acct) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (acct.type !== "expense") return NextResponse.json({ error: "Only expense accounts can be mapped to budget categories" }, { status: 422 });
  if (!acct.isPosting) return NextResponse.json({ error: "Only posting accounts can be mapped" }, { status: 422 });

  try {
    const [row] = await db
      .insert(budgetCategoryAccounts)
      .values({ budgetCategoryId: categoryId, accountId: parsed.data.accountId })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Account already mapped to a budget category" }, { status: 409 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const categoryId = parseInt(id, 10);
  if (isNaN(categoryId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const accountId = parseInt(searchParams.get("accountId") ?? "", 10);
  if (isNaN(accountId)) return NextResponse.json({ error: "accountId required" }, { status: 400 });

  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  const db = getDb();

  // Verify category belongs to company
  const [cat] = await db
    .select()
    .from(budgetCategories)
    .where(and(eq(budgetCategories.id, categoryId), eq(budgetCategories.companyId, company.id)));
  if (!cat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .delete(budgetCategoryAccounts)
    .where(
      and(
        eq(budgetCategoryAccounts.budgetCategoryId, categoryId),
        eq(budgetCategoryAccounts.accountId, accountId)
      )
    );

  return NextResponse.json({ ok: true });
}
