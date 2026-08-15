import { NextRequest, NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/src/db";
import { supplierInvoices, vendors } from "@/src/db/schema";
import { normalizeVendorTaxId } from "@/src/lib/vendor-identity";

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  taxId: z.string().trim().max(50).nullable().optional(),
  address: z.string().max(10_000).nullable().optional(),
  defaultCurrency: z.string().trim().min(1).max(10).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vendorId = Number(id);
  const parsed = UpdateSchema.safeParse(await req.json());
  if (!Number.isInteger(vendorId) || vendorId <= 0 || !parsed.success) {
    return NextResponse.json({ error: parsed.success ? "Invalid vendor id." : parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  const [current] = await db.select().from(vendors).where(eq(vendors.id, vendorId));
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const taxId = parsed.data.taxId !== undefined ? parsed.data.taxId?.trim() || null : current.taxId;
  const normalizedTaxId = normalizeVendorTaxId(taxId);
  if (normalizedTaxId) {
    const companyVendors = await db
      .select({ id: vendors.id, taxId: vendors.taxId, normalizedTaxId: vendors.normalizedTaxId })
      .from(vendors)
      .where(eq(vendors.companyId, current.companyId));
    const conflict = companyVendors.some((candidate) =>
      candidate.id !== vendorId && normalizeVendorTaxId(candidate.normalizedTaxId ?? candidate.taxId) === normalizedTaxId
    );
    if (conflict) {
      return NextResponse.json({ error: "Another vendor already uses this VAT/Tax ID." }, { status: 409 });
    }
  }

  const [row] = await db
    .update(vendors)
    .set({ ...parsed.data, taxId, normalizedTaxId, updatedAt: new Date() })
    .where(eq(vendors.id, vendorId))
    .returning();
  return NextResponse.json(row);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vendorId = Number(id);
  if (!Number.isInteger(vendorId) || vendorId <= 0) {
    return NextResponse.json({ error: "Invalid vendor id." }, { status: 400 });
  }

  const db = getDb();
  const [invoiceReference] = await db
    .select({ invoiceCount: count(supplierInvoices.id) })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.vendorId, vendorId));
  const invoiceCount = invoiceReference?.invoiceCount ?? 0;
  if (invoiceCount > 0) {
    return NextResponse.json(
      { error: `This vendor has ${invoiceCount} associated invoice${invoiceCount === 1 ? "" : "s"} and cannot be deleted.`, invoiceCount },
      { status: 409 },
    );
  }

  try {
    const [deleted] = await db.delete(vendors).where(eq(vendors.id, vendorId)).returning({ id: vendors.id });
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json(
      { error: "This vendor is referenced elsewhere and cannot be deleted." },
      { status: 409 },
    );
  }
}
