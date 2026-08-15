import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { supplierInvoiceLines, supplierInvoices } from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const LineSchema = z.object({
  id: z.number().optional(),
  position: z.number().int().min(1),
  description: z.string().nullable().optional(),
  netAmount: z.string().nullable().optional(),
  vatRate: z.string().nullable().optional(),
  vatAmount: z.string().nullable().optional(),
  grossAmount: z.string().nullable().optional(),
  recognitionTreatment: z.enum(["Immediate", "Prepaid"]).default("Immediate"),
  recognitionStartDate: z.string().nullable().optional(),
  recognitionEndDate: z.string().nullable().optional(),
  accountingAccountNumber: z.string().nullable().optional(),
});

const PutSchema = z.object({
  lines: z.array(LineSchema),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(supplierInvoiceLines)
    .where(eq(supplierInvoiceLines.invoiceId, Number(id)))
    .orderBy(supplierInvoiceLines.position);
  return NextResponse.json(rows);
}

/**
 * PUT replaces all lines for the invoice atomically.
 * Approved invoices cannot have their lines modified.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  const invoiceId = Number(id);

  const [invoice] = await db
    .select({ status: supplierInvoices.status })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, invoiceId));

  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status === "approved") {
    return NextResponse.json({ error: "Cannot modify lines of an approved invoice" }, { status: 422 });
  }

  await db.delete(supplierInvoiceLines).where(eq(supplierInvoiceLines.invoiceId, invoiceId));

  if (parsed.data.lines.length > 0) {
    await db.insert(supplierInvoiceLines).values(
      parsed.data.lines.map((l) => ({
        invoiceId,
        position: l.position,
        description: l.description ?? null,
        netAmount: l.netAmount ?? null,
        vatRate: l.vatRate ?? null,
        vatAmount: l.vatAmount ?? null,
        grossAmount: l.grossAmount ?? null,
        recognitionTreatment: l.recognitionTreatment,
        recognitionStartDate: l.recognitionStartDate ?? null,
        recognitionEndDate: l.recognitionEndDate ?? null,
        accountingAccountNumber: l.accountingAccountNumber ?? null,
      }))
    );
  }

  const rows = await db
    .select()
    .from(supplierInvoiceLines)
    .where(eq(supplierInvoiceLines.invoiceId, invoiceId))
    .orderBy(supplierInvoiceLines.position);

  return NextResponse.json(rows);
}
