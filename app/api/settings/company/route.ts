import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { companies } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  return NextResponse.json(company);
}

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  baseCurrency: z.string().length(3).optional(),
});

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  const db = getDb();
  const [updated] = await db
    .update(companies)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(companies.id, company.id))
    .returning();
  return NextResponse.json(updated);
}
