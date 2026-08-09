import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import {
  supplierInvoices,
  supplierInvoiceDocuments,
  vendors,
  costCentres,
  chartOfAccounts,
} from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const UpdateSchema = z.object({
  vendorId: z.number().nullable().optional(),
  newVendorName: z.string().optional(),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  currency: z.string().length(3).optional(),
  fxRate: z.string().optional(),
  netAmount: z.string().optional(),
  vatAmount: z.string().optional(),
  grossAmount: z.string().optional(),
  costCentreId: z.number().nullable().optional(),
  expenseAccountId: z.number().nullable().optional(),
  notes: z.string().optional(),
  status: z.enum(["draft", "approved"]).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const [invoice] = await db
    .select()
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, Number(id)));

  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const docs = await db
    .select()
    .from(supplierInvoiceDocuments)
    .where(eq(supplierInvoiceDocuments.invoiceId, invoice.id));

  const vendorList = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(eq(vendors.companyId, invoice.companyId));

  const costCentreList = await db
    .select()
    .from(costCentres)
    .where(eq(costCentres.companyId, invoice.companyId));

  const accountList = await db
    .select()
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.companyId, invoice.companyId));

  return NextResponse.json({ invoice, documents: docs, vendors: vendorList, costCentres: costCentreList, accounts: accountList });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  const data = parsed.data;

  // Create a new vendor if name provided without id
  let vendorId = data.vendorId;
  if (data.newVendorName && !vendorId) {
    const [invoice] = await db.select({ companyId: supplierInvoices.companyId }).from(supplierInvoices).where(eq(supplierInvoices.id, Number(id)));
    if (invoice) {
      const [v] = await db.insert(vendors).values({ companyId: invoice.companyId, name: data.newVendorName }).returning();
      vendorId = v.id;
    }
  }

  const updateValues: Record<string, unknown> = { updatedAt: new Date() };
  if (vendorId !== undefined) updateValues.vendorId = vendorId;
  if (data.invoiceNumber !== undefined) updateValues.invoiceNumber = data.invoiceNumber;
  if (data.invoiceDate !== undefined) updateValues.invoiceDate = data.invoiceDate;
  if (data.dueDate !== undefined) updateValues.dueDate = data.dueDate;
  if (data.currency !== undefined) updateValues.currency = data.currency;
  if (data.fxRate !== undefined) updateValues.fxRate = data.fxRate;
  if (data.netAmount !== undefined) updateValues.netAmount = data.netAmount;
  if (data.vatAmount !== undefined) updateValues.vatAmount = data.vatAmount;
  if (data.grossAmount !== undefined) updateValues.grossAmount = data.grossAmount;
  if (data.costCentreId !== undefined) updateValues.costCentreId = data.costCentreId;
  if (data.expenseAccountId !== undefined) updateValues.expenseAccountId = data.expenseAccountId;
  if (data.notes !== undefined) updateValues.notes = data.notes;
  if (data.status !== undefined) updateValues.status = data.status;

  const [updated] = await db
    .update(supplierInvoices)
    .set(updateValues)
    .where(eq(supplierInvoices.id, Number(id)))
    .returning();

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}
