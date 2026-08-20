import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { chartOfAccounts } from "@/src/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";

const UpdateSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  const db = getDb();
  const [row] = await db
    .update(chartOfAccounts)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(
      eq(chartOfAccounts.id, Number(id)),
      eq(chartOfAccounts.companyId, company.id),
    ))
    .returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  const db = getDb();
  const [row] = await db
    .update(chartOfAccounts)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(
      eq(chartOfAccounts.id, Number(id)),
      eq(chartOfAccounts.companyId, company.id),
    ))
    .returning({ id: chartOfAccounts.id });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
