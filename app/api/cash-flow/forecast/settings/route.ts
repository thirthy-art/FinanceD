import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/src/db";
import { cashForecastSettings } from "@/src/db/schema";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { isValidBaseAmount } from "@/src/lib/cash-forecast";

export const ForecastSettingsSchema = z.object({
  openingCashBalance: z.string().refine((value) => isValidBaseAmount(value, true)),
  minimumCashBuffer: z.string().refine((value) => isValidBaseAmount(value, false)),
});

export async function GET(request: Request) {
  const company = await getActiveCompanyFromRequest(request);
  if (company instanceof Response) return company;
  const [settings] = await getDb().select().from(cashForecastSettings)
    .where(eq(cashForecastSettings.companyId, company.id)).limit(1);
  return NextResponse.json(settings ?? {
    companyId: company.id,
    openingCashBalance: "0.0000",
    minimumCashBuffer: "0.0000",
  });
}

export async function PUT(request: Request) {
  const parsed = ForecastSettingsSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const company = await getActiveCompanyFromRequest(request);
  if (company instanceof Response) return company;
  const [settings] = await getDb().insert(cashForecastSettings).values({
    companyId: company.id,
    ...parsed.data,
  }).onConflictDoUpdate({
    target: cashForecastSettings.companyId,
    set: { ...parsed.data, updatedAt: new Date() },
  }).returning();
  return NextResponse.json(settings);
}
