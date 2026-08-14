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
import { isAmountMismatch, calculateBaseAmount } from "@/src/lib/invoice-validation";

const UpdateSchema = z.object({
  vendorId: z.number().nullable().optional(),
  newVendorName: z.string().optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  currency: z.string().min(1).max(20).optional(),
  currencyType: z.enum(["fiat", "crypto"]).optional(),
  fxRateToBase: z.string().nullable().optional(),
  netAmount: z.string().nullable().optional(),
  vatAmount: z.string().nullable().optional(),
  grossAmount: z.string().nullable().optional(),
  costCentreId: z.number().nullable().optional(),
  expenseAccountId: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
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

  const [existing] = await db
    .select()
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, Number(id)));

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Create a new vendor if name provided without id
  let vendorId = data.vendorId;
  if (data.newVendorName && !vendorId) {
    const [v] = await db
      .insert(vendors)
      .values({ companyId: existing.companyId, name: data.newVendorName })
      .returning();
    vendorId = v.id;
  }

  // Resolve final values for monetary fields
  const finalNet = data.netAmount !== undefined ? data.netAmount : existing.netAmount;
  const finalVat = data.vatAmount !== undefined ? data.vatAmount : existing.vatAmount;
  const finalGross = data.grossAmount !== undefined ? data.grossAmount : existing.grossAmount;
  const finalRate = data.fxRateToBase !== undefined ? data.fxRateToBase : existing.fxRateToBase;
  const finalCurrencyType = data.currencyType ?? existing.currencyType;

  // Server-side arithmetic guard for approval
  if (data.status === "approved") {
    if (isAmountMismatch(finalNet, finalVat, finalGross, finalCurrencyType)) {
      return NextResponse.json(
        { error: "Cannot approve: net + VAT does not match gross within the accepted tolerance." },
        { status: 422 }
      );
    }
  }

  const updateValues: Record<string, unknown> = { updatedAt: new Date() };
  if (vendorId !== undefined) updateValues.vendorId = vendorId;
  if (data.invoiceNumber !== undefined) updateValues.invoiceNumber = data.invoiceNumber;
  if (data.invoiceDate !== undefined) updateValues.invoiceDate = data.invoiceDate;
  if (data.dueDate !== undefined) updateValues.dueDate = data.dueDate;
  if (data.currency !== undefined) updateValues.currency = data.currency;
  if (data.currencyType !== undefined) updateValues.currencyType = data.currencyType;
  if (data.fxRateToBase !== undefined) updateValues.fxRateToBase = data.fxRateToBase;
  if (data.netAmount !== undefined) updateValues.netAmount = data.netAmount;
  if (data.vatAmount !== undefined) updateValues.vatAmount = data.vatAmount;
  if (data.grossAmount !== undefined) updateValues.grossAmount = data.grossAmount;
  if (data.costCentreId !== undefined) updateValues.costCentreId = data.costCentreId;
  if (data.expenseAccountId !== undefined) updateValues.expenseAccountId = data.expenseAccountId;
  if (data.notes !== undefined) updateValues.notes = data.notes;
  if (data.status !== undefined) updateValues.status = data.status;

  // Recalculate base amounts when any monetary field or FX rate changes
  const monetaryFieldChanged =
    data.netAmount !== undefined ||
    data.vatAmount !== undefined ||
    data.grossAmount !== undefined ||
    data.fxRateToBase !== undefined;

  if (monetaryFieldChanged) {
    updateValues.baseNetAmount = calculateBaseAmount(finalNet, finalRate);
    updateValues.baseVatAmount = calculateBaseAmount(finalVat, finalRate);
    updateValues.baseGrossAmount = calculateBaseAmount(finalGross, finalRate);
  }

  const [updated] = await db
    .update(supplierInvoices)
    .set(updateValues)
    .where(eq(supplierInvoices.id, Number(id)))
    .returning();

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}
