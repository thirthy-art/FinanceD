import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import { cashForecastItems } from "@/src/db/schema";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { ForecastItemSchema } from "@/app/api/cash-flow/forecast/items/route";

async function positiveId(context: { params: Promise<{ id: string }> }): Promise<number | null> {
  const { id } = await context.params;
  if (!/^[1-9]\d*$/.test(id)) return null;
  const value = Number(id);
  return Number.isSafeInteger(value) ? value : null;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = await positiveId(context);
  if (id === null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const parsed = ForecastItemSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const company = await getActiveCompanyFromRequest(request);
  if (company instanceof Response) return company;
  const [item] = await getDb().update(cashForecastItems)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(cashForecastItems.id, id), eq(cashForecastItems.companyId, company.id)))
    .returning();
  if (!item) return NextResponse.json({ error: "forecast item not found" }, { status: 404 });
  return NextResponse.json(item);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = await positiveId(context);
  if (id === null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const company = await getActiveCompanyFromRequest(request);
  if (company instanceof Response) return company;
  const [deleted] = await getDb().delete(cashForecastItems)
    .where(and(eq(cashForecastItems.id, id), eq(cashForecastItems.companyId, company.id)))
    .returning({ id: cashForecastItems.id });
  if (!deleted) return NextResponse.json({ error: "forecast item not found" }, { status: 404 });
  return NextResponse.json(deleted);
}
