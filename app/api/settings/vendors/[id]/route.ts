import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { vendors } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  taxId: z.string().optional(),
  address: z.string().optional(),
  defaultCurrency: z.string().length(3).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getDb();
  const [row] = await db
    .update(vendors)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(vendors.id, Number(id)))
    .returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
