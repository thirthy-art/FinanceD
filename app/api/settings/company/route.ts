import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { companies } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateCompany } from "@/src/lib/db-helpers";
import { z } from "zod";

export async function GET() {
  const company = await getOrCreateCompany();
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

  const company = await getOrCreateCompany();
  const db = getDb();
  const [updated] = await db
    .update(companies)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(companies.id, company.id))
    .returning();
  return NextResponse.json(updated);
}
