import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { supplierInvoices, supplierInvoiceLines } from "@/src/db/schema";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { parseSafeDecimal, isVatRateValid } from "@/src/lib/invoice-validation";

const LineSchema = z.object({
  lineNumber: z.number().int().positive(),
  description: z.string().optional().nullable(),
  descriptionOriginal: z.string().optional().nullable(),
  quantity: z.string().optional().nullable(),
  unit: z.string().max(50).optional().nullable(),
  unitPrice: z.string().optional().nullable(),
  netAmount: z.string().optional().nullable(),
  vatRate: z.string().optional().nullable(),
  vatAmount: z.string().optional().nullable(),
  grossAmount: z.string().optional().nullable(),
  sourcePage: z.number().int().optional().nullable(),
  treatment: z.enum(["immediate", "prepaid"]).default("immediate"),
  accountingAccountNumber: z.string().max(20).optional().nullable(),
  prepaidAccountNumber: z.string().max(20).optional().nullable(),
  recognitionStart: z.string().max(10).optional().nullable(),
  recognitionEnd: z.string().max(10).optional().nullable(),
});

const BulkLinesSchema = z.object({
  lines: z.array(LineSchema),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const db = getDb();
  const lines = await db
    .select()
    .from(supplierInvoiceLines)
    .where(eq(supplierInvoiceLines.invoiceId, Number(id)))
    .orderBy(asc(supplierInvoiceLines.lineNumber));
  return NextResponse.json(lines);
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const invoiceId = Number(id);

  const body = await req.json();
  const parsed = BulkLinesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  const [invoice] = await db
    .select({ id: supplierInvoices.id, status: supplierInvoices.status })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, invoiceId));
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Validate lines
  const errors: string[] = [];
  for (const line of parsed.data.lines) {
    const label = `Line ${line.lineNumber}`;
    for (const field of ["quantity", "unitPrice", "netAmount", "vatAmount", "grossAmount"] as const) {
      const val = line[field];
      if (val && val.trim() && parseSafeDecimal(val) === null) {
        errors.push(`${label}: ${field} is not a valid number ("${val}")`);
      }
    }
    if (line.vatRate && !isVatRateValid(line.vatRate)) {
      const v = parseSafeDecimal(line.vatRate);
      if (v === null) {
        errors.push(`${label}: VAT rate is not a valid number ("${line.vatRate}")`);
      } else {
        errors.push(`${label}: VAT rate must be 0–100 (got ${v})`);
      }
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors }, { status: 422 });
  }

  // Replace all lines for this invoice
  await db.delete(supplierInvoiceLines).where(eq(supplierInvoiceLines.invoiceId, invoiceId));

  const rows = parsed.data.lines.map((line) => ({
    invoiceId,
    lineNumber: line.lineNumber,
    description: line.description ?? null,
    descriptionOriginal: line.descriptionOriginal ?? null,
    quantity: line.quantity ?? null,
    unit: line.unit ?? null,
    unitPrice: line.unitPrice ?? null,
    netAmount: line.netAmount ?? null,
    vatRate: line.vatRate ?? null,
    vatAmount: line.vatAmount ?? null,
    grossAmount: line.grossAmount ?? null,
    sourcePage: line.sourcePage ?? null,
    treatment: line.treatment,
    accountingAccountNumber: line.accountingAccountNumber ?? null,
    prepaidAccountNumber: line.prepaidAccountNumber ?? null,
    recognitionStart: line.recognitionStart ?? null,
    recognitionEnd: line.recognitionEnd ?? null,
  }));

  if (rows.length > 0) {
    await db.insert(supplierInvoiceLines).values(rows);
  }

  const saved = await db
    .select()
    .from(supplierInvoiceLines)
    .where(eq(supplierInvoiceLines.invoiceId, invoiceId))
    .orderBy(asc(supplierInvoiceLines.lineNumber));

  return NextResponse.json(saved);
}
