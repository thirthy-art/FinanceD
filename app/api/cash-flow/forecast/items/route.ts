import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/src/db";
import { cashForecastItems } from "@/src/db/schema";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import {
  CASH_FORECAST_CATEGORIES,
  CASH_FORECAST_DIRECTIONS,
  isCategoryForDirection,
  isValidBaseAmount,
  isValidDate,
} from "@/src/lib/cash-forecast";

export const ForecastItemSchema = z.object({
  date: z.string().refine(isValidDate),
  description: z.string().trim().min(1).max(200),
  direction: z.enum(CASH_FORECAST_DIRECTIONS),
  category: z.enum(CASH_FORECAST_CATEGORIES),
  amount: z.string().refine((value) => isValidBaseAmount(value, false)),
}).refine((value) => isCategoryForDirection(value.category, value.direction), {
  message: "category is not valid for direction",
  path: ["category"],
});

export async function GET(request: Request) {
  const company = await getActiveCompanyFromRequest(request);
  if (company instanceof Response) return company;
  const items = await getDb().select().from(cashForecastItems)
    .where(eq(cashForecastItems.companyId, company.id))
    .orderBy(asc(cashForecastItems.date), asc(cashForecastItems.id));
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const parsed = ForecastItemSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const company = await getActiveCompanyFromRequest(request);
  if (company instanceof Response) return company;
  const [item] = await getDb().insert(cashForecastItems).values({
    companyId: company.id,
    ...parsed.data,
  }).returning();
  return NextResponse.json(item, { status: 201 });
}
