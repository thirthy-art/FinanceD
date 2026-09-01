import { NextRequest, NextResponse } from "next/server";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/src/db";
import { supplierInvoices, vendors } from "@/src/db/schema";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import {
  findVendorIdentityMatches,
  hasPossibleVendorDuplicate,
  normalizeVendorTaxId,
} from "@/src/lib/vendor-identity";

export async function GET(req: NextRequest) {
  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  const db = getDb();
  const rows = await db
    .select({
      id: vendors.id,
      name: vendors.name,
      taxId: vendors.taxId,
      normalizedTaxId: vendors.normalizedTaxId,
      address: vendors.address,
      defaultCurrency: vendors.defaultCurrency,
      externalVendorNumber: vendors.externalVendorNumber,
      isActive: vendors.isActive,
      invoiceCount: count(supplierInvoices.id),
    })
    .from(vendors)
    .leftJoin(supplierInvoices, and(
      eq(supplierInvoices.vendorId, vendors.id),
      eq(supplierInvoices.companyId, company.id),
    ))
    .where(eq(vendors.companyId, company.id))
    .groupBy(vendors.id)
    .orderBy(asc(vendors.name));

  return NextResponse.json(rows.map((row) => ({
    ...row,
    possibleDuplicate: hasPossibleVendorDuplicate(row, rows),
  })));
}

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  taxId: z.string().trim().max(50).optional(),
  address: z.string().max(10_000).optional(),
  defaultCurrency: z.string().trim().min(1).max(10).optional(),
  externalVendorNumber: z.string().trim().max(100).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const company = await getActiveCompanyFromRequest(req);
  if (company instanceof Response) return company;
  const db = getDb();
  const existing = await db
    .select({ id: vendors.id, name: vendors.name, taxId: vendors.taxId, normalizedTaxId: vendors.normalizedTaxId })
    .from(vendors)
    .where(eq(vendors.companyId, company.id));
  const match = findVendorIdentityMatches(parsed.data.name, parsed.data.taxId, existing);
  if (match.candidates.length > 1) {
    return NextResponse.json(
      { error: "Multiple existing vendors match these details. Open a vendor and merge the duplicate records." },
      { status: 409 },
    );
  }
  if (match.candidates.length === 1) {
    return NextResponse.json({ ...match.candidates[0], reused: true });
  }

  const taxId = parsed.data.taxId?.trim() || null;
  const [created] = await db
    .insert(vendors)
    .values({
      ...parsed.data,
      taxId,
      normalizedTaxId: normalizeVendorTaxId(taxId),
      companyId: company.id,
    })
    .onConflictDoNothing()
    .returning();
  if (!created) {
    return NextResponse.json(
      { error: "A vendor with this VAT/Tax ID already exists. Refresh the vendor list and use that record." },
      { status: 409 },
    );
  }
  return NextResponse.json(created, { status: 201 });
}
