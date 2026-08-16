import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import {
  supplierInvoices,
  supplierInvoiceDocuments,
  supplierInvoiceLines,
  vendors,
  costCentres,
  chartOfAccounts,
} from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  isAmountMismatch,
  parseAmount,
  parseSafeDecimal,
  isVatRateValid,
} from "@/src/lib/invoice-validation";

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

  // Server-side approval guard
  if (data.status === "approved") {
    const existing = await db
      .select({
        netAmount: supplierInvoices.netAmount,
        vatAmount: supplierInvoices.vatAmount,
        grossAmount: supplierInvoices.grossAmount,
      })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.id, Number(id)));
    if (!existing[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Invoice-level amount consistency check (applies when no lines are present)
    const net = parseAmount(data.netAmount ?? existing[0].netAmount);
    const vat = parseAmount(data.vatAmount ?? existing[0].vatAmount);
    const gross = parseAmount(data.grossAmount ?? existing[0].grossAmount);

    const lines = await db
      .select()
      .from(supplierInvoiceLines)
      .where(eq(supplierInvoiceLines.invoiceId, Number(id)));

    if (lines.length === 0 && isAmountMismatch(net, vat, gross)) {
      return NextResponse.json(
        { error: `Cannot approve: net (${net}) + VAT (${vat}) does not match gross (${gross}) within the accepted tolerance.` },
        { status: 422 }
      );
    }

    // Line-level approval validation
    const lineErrors: string[] = [];
    for (const line of lines) {
      const label = `Line ${line.lineNumber}`;

      // Reject malformed numeric fields
      for (const [field, val] of [
        ["quantity", line.quantity],
        ["unitPrice", line.unitPrice],
        ["netAmount", line.netAmount],
        ["vatAmount", line.vatAmount],
        ["grossAmount", line.grossAmount],
      ] as const) {
        if (val && parseSafeDecimal(val) === null) {
          lineErrors.push(`${label}: ${field} contains invalid numeric value "${val}"`);
        }
      }

      // VAT rate must be 0-100 when present
      if (line.vatRate && !isVatRateValid(line.vatRate)) {
        lineErrors.push(`${label}: VAT rate must be 0–100`);
      }

      // Prepaid lines require additional fields
      if (line.treatment === "prepaid") {
        if (!line.accountingAccountNumber) {
          lineErrors.push(`${label}: Expense account is required for Prepaid treatment`);
        }
        if (!line.prepaidAccountNumber) {
          lineErrors.push(`${label}: Prepaid asset account is required for Prepaid treatment`);
        }
        if (!line.recognitionStart) {
          lineErrors.push(`${label}: Recognition start date is required for Prepaid treatment`);
        }
        if (!line.recognitionEnd) {
          lineErrors.push(`${label}: Recognition end date is required for Prepaid treatment`);
        }
        if (line.recognitionStart && line.recognitionEnd && line.recognitionStart > line.recognitionEnd) {
          lineErrors.push(`${label}: Recognition end date must be on or after start date`);
        }
      }
    }

    if (lineErrors.length > 0) {
      return NextResponse.json({ error: lineErrors }, { status: 422 });
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
