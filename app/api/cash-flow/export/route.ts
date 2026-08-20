import { and, eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import { supplierInvoices, vendors } from "@/src/db/schema";
import { classifyBucket, BUCKET_LABELS } from "@/src/lib/cash-flow-buckets";
import { setDecimalAmountCell } from "@/src/lib/cash-flow-xlsx";
import { excelDateFromString } from "@/src/lib/xlsx-helpers";
import ExcelJS from "exceljs";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function setDateCell(cell: ExcelJS.Cell, value: string | null) {
  cell.value = excelDateFromString(value);
  cell.numFmt = "yyyy-mm-dd";
}

export async function GET(request: Request) {
  const today = todayString();
  const company = await getActiveCompanyFromRequest(request);
  if (company instanceof Response) return company;
  const db = getDb();

  const rows = await db
    .select({
      id: supplierInvoices.id,
      vendorName: vendors.name,
      vendorTaxId: vendors.taxId,
      vendorExternalNumber: vendors.externalVendorNumber,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      dueDate: supplierInvoices.dueDate,
      currency: supplierInvoices.currency,
      currencyType: supplierInvoices.currencyType,
      grossAmount: supplierInvoices.grossAmount,
      baseGrossAmount: supplierInvoices.baseGrossAmount,
      status: supplierInvoices.status,
      paymentStatus: supplierInvoices.paymentStatus,
    })
    .from(supplierInvoices)
    .leftJoin(vendors, and(
      eq(supplierInvoices.vendorId, vendors.id),
      eq(vendors.companyId, company.id),
    ))
    .where(and(
      eq(supplierInvoices.companyId, company.id),
      eq(supplierInvoices.paymentStatus, "Unpaid"),
    ));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FinanceD";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const sheet = workbook.addWorksheet("Outstanding Payables");
  sheet.columns = [
    { header: "Invoice ID", key: "id", width: 12 },
    { header: "Vendor", key: "vendorName", width: 28 },
    { header: "Vendor Tax ID", key: "vendorTaxId", width: 20 },
    { header: "Vendor External No.", key: "vendorExternalNumber", width: 20 },
    { header: "Invoice Number", key: "invoiceNumber", width: 20 },
    { header: "Invoice Date", key: "invoiceDate", width: 14 },
    { header: "Due Date", key: "dueDate", width: 14 },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Gross Amount", key: "grossAmount", width: 18 },
    { header: "Base Gross Amount", key: "baseGrossAmount", width: 20 },
    { header: "Approval Status", key: "status", width: 16 },
    { header: "Payment Timing", key: "bucket", width: 20 },
  ];

  for (const row of rows) {
    const bucket = classifyBucket(row.dueDate, today);
    const sheetRow = sheet.addRow({
      id: row.id,
      vendorName: row.vendorName,
      vendorTaxId: row.vendorTaxId,
      vendorExternalNumber: row.vendorExternalNumber,
      invoiceNumber: row.invoiceNumber,
      currency: row.currency,
      status: row.status,
      bucket: BUCKET_LABELS[bucket],
    });
    setDateCell(sheetRow.getCell("invoiceDate"), row.invoiceDate);
    setDateCell(sheetRow.getCell("dueDate"), row.dueDate);
    setDecimalAmountCell(sheetRow.getCell("grossAmount"), row.grossAmount);
    setDecimalAmountCell(sheetRow.getCell("baseGrossAmount"), row.baseGrossAmount);
  }

  // Style header row
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  header.alignment = { vertical: "middle" };
  header.height = 22;

  const bytes = await workbook.xlsx.writeBuffer();
  const exportDate = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="payables-${exportDate}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
