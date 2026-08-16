import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import {
  supplierInvoices,
  supplierInvoiceLines,
  vendors,
} from "@/src/db/schema";
import { eq, asc } from "drizzle-orm";
import ExcelJS from "exceljs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const invoiceId = Number(id);
  const db = getDb();

  const [invoice] = await db
    .select({
      id: supplierInvoices.id,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      currency: supplierInvoices.currency,
      status: supplierInvoices.status,
      vendorId: supplierInvoices.vendorId,
    })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, invoiceId));

  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let vendorName: string | null = null;
  if (invoice.vendorId) {
    const [v] = await db
      .select({ name: vendors.name })
      .from(vendors)
      .where(eq(vendors.id, invoice.vendorId));
    vendorName = v?.name ?? null;
  }

  const lines = await db
    .select()
    .from(supplierInvoiceLines)
    .where(eq(supplierInvoiceLines.invoiceId, invoiceId))
    .orderBy(asc(supplierInvoiceLines.lineNumber));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FinanceD";
  workbook.created = new Date();

  // ── Invoice header sheet ──────────────────────────────────────────────────────
  const headerSheet = workbook.addWorksheet("Invoice");
  headerSheet.addRow(["Invoice ID", invoice.id]);
  headerSheet.addRow(["Invoice Number", invoice.invoiceNumber ?? ""]);
  headerSheet.addRow(["Invoice Date", invoice.invoiceDate ?? ""]);
  headerSheet.addRow(["Vendor", vendorName ?? ""]);
  headerSheet.addRow(["Currency", invoice.currency]);
  headerSheet.addRow(["Status", invoice.status]);

  // ── Invoice lines sheet ───────────────────────────────────────────────────────
  const lineSheet = workbook.addWorksheet("Invoice Lines");

  lineSheet.columns = [
    { header: "Invoice ID", key: "invoiceId", width: 12 },
    { header: "Invoice Number", key: "invoiceNumber", width: 20 },
    { header: "Line No.", key: "lineNumber", width: 10 },
    { header: "Description", key: "description", width: 35 },
    { header: "Unit of Measure", key: "unit", width: 14 },
    { header: "Quantity", key: "quantity", width: 12 },
    { header: "Unit Price", key: "unitPrice", width: 14 },
    { header: "Net Amount", key: "netAmount", width: 14 },
    { header: "VAT Rate (%)", key: "vatRate", width: 13 },
    { header: "VAT Amount", key: "vatAmount", width: 14 },
    { header: "Gross Amount", key: "grossAmount", width: 14 },
    { header: "Accounting Account No.", key: "accountingAccountNumber", width: 24 },
    { header: "Prepaid Account Number", key: "prepaidAccountNumber", width: 24 },
    { header: "Treatment", key: "treatment", width: 13 },
    { header: "Recognition Start", key: "recognitionStart", width: 18 },
    { header: "Recognition End", key: "recognitionEnd", width: 18 },
    { header: "Source Page", key: "sourcePage", width: 13 },
  ];

  // Bold header row
  lineSheet.getRow(1).font = { bold: true };

  for (const line of lines) {
    lineSheet.addRow({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber ?? "",
      lineNumber: line.lineNumber,
      description: line.description ?? line.descriptionOriginal ?? "",
      unit: line.unit ?? "",
      quantity: line.quantity ?? "",
      unitPrice: line.unitPrice ?? "",
      netAmount: line.netAmount ?? "",
      vatRate: line.vatRate ?? "",
      vatAmount: line.vatAmount ?? "",
      grossAmount: line.grossAmount ?? "",
      accountingAccountNumber: line.accountingAccountNumber ?? "",
      prepaidAccountNumber: line.prepaidAccountNumber ?? "",
      treatment: line.treatment,
      recognitionStart: line.recognitionStart ?? "",
      recognitionEnd: line.recognitionEnd ?? "",
      sourcePage: line.sourcePage ?? "",
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="invoice-${invoiceId}.xlsx"`,
    },
  });
}
