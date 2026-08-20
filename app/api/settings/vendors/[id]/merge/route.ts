import { NextRequest, NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/src/db";
import { supplierInvoices, vendors } from "@/src/db/schema";
import { normalizeVendorTaxId } from "@/src/lib/vendor-identity";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";

const MergeSchema = z.object({ targetVendorId: z.number().int().positive() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sourceVendorId = Number(id);
  const parsed = MergeSchema.safeParse(await req.json());
  if (!Number.isInteger(sourceVendorId) || sourceVendorId <= 0 || !parsed.success) {
    return NextResponse.json({ error: "Invalid vendor merge request." }, { status: 400 });
  }
  if (sourceVendorId === parsed.data.targetVendorId) {
    return NextResponse.json({ error: "A vendor cannot be merged into itself." }, { status: 400 });
  }

  const company = await getActiveCompanyFromRequest(req);
  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const [source] = await tx.select().from(vendors).where(and(
        eq(vendors.id, sourceVendorId),
        eq(vendors.companyId, company.id),
      ));
      const [target] = await tx.select().from(vendors).where(and(
        eq(vendors.id, parsed.data.targetVendorId),
        eq(vendors.companyId, company.id),
      ));
      if (!source || !target) return { kind: "not-found" as const };

      const sourceTaxId = normalizeVendorTaxId(source.normalizedTaxId ?? source.taxId);
      const targetTaxId = normalizeVendorTaxId(target.normalizedTaxId ?? target.taxId);
      if (sourceTaxId && targetTaxId && sourceTaxId !== targetTaxId) {
        return { kind: "tax-conflict" as const };
      }

      const [sourceReferences] = await tx
        .select({ invoiceCount: count(supplierInvoices.id) })
        .from(supplierInvoices)
        .where(and(eq(supplierInvoices.vendorId, source.id), eq(supplierInvoices.companyId, company.id)));
      const [targetReferences] = await tx
        .select({ invoiceCount: count(supplierInvoices.id) })
        .from(supplierInvoices)
        .where(and(eq(supplierInvoices.vendorId, target.id), eq(supplierInvoices.companyId, company.id)));

      await tx.update(supplierInvoices).set({ vendorId: target.id }).where(and(
        eq(supplierInvoices.vendorId, source.id),
        eq(supplierInvoices.companyId, company.id),
      ));
      await tx.delete(vendors).where(and(eq(vendors.id, source.id), eq(vendors.companyId, company.id)));

      if (!targetTaxId && sourceTaxId) {
        await tx.update(vendors).set({
          taxId: source.taxId,
          normalizedTaxId: sourceTaxId,
          updatedAt: new Date(),
        }).where(and(eq(vendors.id, target.id), eq(vendors.companyId, company.id)));
      }

      return {
        kind: "merged" as const,
        sourceInvoiceCount: sourceReferences?.invoiceCount ?? 0,
        targetInvoiceCount: targetReferences?.invoiceCount ?? 0,
        targetVendorId: target.id,
      };
    });

    if (result.kind === "not-found") return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
    if (result.kind === "tax-conflict") return NextResponse.json({ error: "The vendors have conflicting VAT/Tax IDs and cannot be merged." }, { status: 422 });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Vendor merge failed. No records were changed." }, { status: 409 });
  }
}
