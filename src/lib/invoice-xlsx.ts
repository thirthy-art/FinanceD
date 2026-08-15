import ExcelJS from "exceljs";
import { Decimal } from "@/src/lib/decimal";

export interface InvoiceExportRow {
  id: number;
  vendorName: string | null;
  vendorTaxId: string | null;
  vendorExternalNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  currencyType: "fiat" | "crypto";
  netAmount: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  baseNetAmount: string | null;
  baseVatAmount: string | null;
  baseGrossAmount: string | null;
  status: "draft" | "approved";
  paymentStatus: "Unpaid" | "Paid";
  paidDate: string | null;
}

export interface InvoiceLineExportRow {
  invoiceId: number;
  vendorName: string | null;
  vendorTaxId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceStatus: "draft" | "approved";
  currency: string;
  currencyType: "fiat" | "crypto";
  lineNumber: string | null;
  descriptionOriginal: string | null;
  description: string | null;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  netAmount: string | null;
  vatRate: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  sourcePage: number | null;
  recognitionTreatment: "Immediate" | "Prepaid";
  recognitionStartDate: string | null;
  recognitionEndDate: string | null;
  accountingAccountNumber: string | null;
}

const fiatFormat = "0.00";
const precisionFormat = "0.##################";

function asExcelDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function decimalFormula(value: string | null): ExcelJS.CellFormulaValue | null {
  if (value === null || value.trim() === "") return null;
  try {
    return { formula: new Decimal(value).toFixed() };
  } catch {
    return null;
  }
}

function styleWorksheet(worksheet: ExcelJS.Worksheet) {
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columnCount },
  };
  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  header.alignment = { vertical: "middle" };
  header.height = 22;
}

function setDateCell(cell: ExcelJS.Cell, value: string | null) {
  cell.value = asExcelDate(value);
  cell.numFmt = "yyyy-mm-dd";
}

function setDecimalCell(cell: ExcelJS.Cell, value: string | null, format: string) {
  cell.value = decimalFormula(value);
  cell.numFmt = format;
}

export function createInvoiceExportWorkbook(invoices: InvoiceExportRow[], lines: InvoiceLineExportRow[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FinanceD";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const invoiceSheet = workbook.addWorksheet("Invoices");
  invoiceSheet.columns = [
    { header: "Invoice ID", key: "invoiceId", width: 12 },
    { header: "Vendor Name", key: "vendorName", width: 28 },
    { header: "Vendor VAT/Tax ID", key: "vendorTaxId", width: 20 },
    { header: "Vendor External No.", key: "vendorExternalNumber", width: 20 },
    { header: "Invoice Number", key: "invoiceNumber", width: 20 },
    { header: "Invoice Date", key: "invoiceDate", width: 14 },
    { header: "Due Date", key: "dueDate", width: 14 },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Net Amount", key: "netAmount", width: 18 },
    { header: "VAT Amount", key: "vatAmount", width: 18 },
    { header: "Gross Amount", key: "grossAmount", width: 18 },
    { header: "Base Net Amount", key: "baseNetAmount", width: 18 },
    { header: "Base VAT Amount", key: "baseVatAmount", width: 18 },
    { header: "Base Gross Amount", key: "baseGrossAmount", width: 19 },
    { header: "Status", key: "status", width: 12 },
    { header: "Payment Status", key: "paymentStatus", width: 16 },
    { header: "Paid Date", key: "paidDate", width: 14 },
  ];

  for (const invoice of invoices) {
    const row = invoiceSheet.addRow({
      invoiceId: invoice.id,
      vendorName: invoice.vendorName,
      vendorTaxId: invoice.vendorTaxId,
      vendorExternalNumber: invoice.vendorExternalNumber,
      invoiceNumber: invoice.invoiceNumber,
      currency: invoice.currency,
      status: invoice.status,
      paymentStatus: invoice.paymentStatus,
    });
    setDateCell(row.getCell("invoiceDate"), invoice.invoiceDate);
    setDateCell(row.getCell("dueDate"), invoice.dueDate);
    setDateCell(row.getCell("paidDate"), invoice.paidDate);
    const invoiceFormat = invoice.currencyType === "crypto" ? precisionFormat : fiatFormat;
    setDecimalCell(row.getCell("netAmount"), invoice.netAmount, invoiceFormat);
    setDecimalCell(row.getCell("vatAmount"), invoice.vatAmount, invoiceFormat);
    setDecimalCell(row.getCell("grossAmount"), invoice.grossAmount, invoiceFormat);
    setDecimalCell(row.getCell("baseNetAmount"), invoice.baseNetAmount, fiatFormat);
    setDecimalCell(row.getCell("baseVatAmount"), invoice.baseVatAmount, fiatFormat);
    setDecimalCell(row.getCell("baseGrossAmount"), invoice.baseGrossAmount, fiatFormat);
  }
  styleWorksheet(invoiceSheet);

  const lineSheet = workbook.addWorksheet("Invoice Lines");
  lineSheet.columns = [
    { header: "Invoice ID", key: "invoiceId", width: 12 },
    { header: "Vendor Name", key: "vendorName", width: 28 },
    { header: "Vendor VAT/Tax ID", key: "vendorTaxId", width: 20 },
    { header: "Invoice Number", key: "invoiceNumber", width: 20 },
    { header: "Invoice Date", key: "invoiceDate", width: 14 },
    { header: "Invoice Status", key: "invoiceStatus", width: 15 },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Line Number", key: "lineNumber", width: 14 },
    { header: "Original Description", key: "descriptionOriginal", width: 36 },
    { header: "English Description", key: "description", width: 36 },
    { header: "Quantity", key: "quantity", width: 15 },
    { header: "Unit", key: "unit", width: 12 },
    { header: "Unit Price", key: "unitPrice", width: 18 },
    { header: "Line Net Amount", key: "netAmount", width: 19 },
    { header: "VAT Rate", key: "vatRate", width: 14 },
    { header: "VAT Amount", key: "vatAmount", width: 18 },
    { header: "Gross Amount", key: "grossAmount", width: 18 },
    { header: "Source Page", key: "sourcePage", width: 14 },
    { header: "Recognition Treatment", key: "recognitionTreatment", width: 22 },
    { header: "Recognition Start Date", key: "recognitionStartDate", width: 22 },
    { header: "Recognition End Date", key: "recognitionEndDate", width: 20 },
    { header: "Accounting Account No.", key: "accountingAccountNumber", width: 24 },
  ];

  for (const line of lines) {
    const row = lineSheet.addRow({
      invoiceId: line.invoiceId,
      vendorName: line.vendorName,
      vendorTaxId: line.vendorTaxId,
      invoiceNumber: line.invoiceNumber,
      invoiceStatus: line.invoiceStatus,
      currency: line.currency,
      lineNumber: line.lineNumber,
      descriptionOriginal: line.descriptionOriginal,
      description: line.description,
      unit: line.unit,
      sourcePage: line.sourcePage,
      recognitionTreatment: line.recognitionTreatment,
      accountingAccountNumber: line.accountingAccountNumber,
    });
    setDateCell(row.getCell("invoiceDate"), line.invoiceDate);
    setDateCell(row.getCell("recognitionStartDate"), line.recognitionStartDate);
    setDateCell(row.getCell("recognitionEndDate"), line.recognitionEndDate);
    const invoiceFormat = line.currencyType === "crypto" ? precisionFormat : fiatFormat;
    setDecimalCell(row.getCell("quantity"), line.quantity, precisionFormat);
    setDecimalCell(row.getCell("unitPrice"), line.unitPrice, invoiceFormat);
    setDecimalCell(row.getCell("netAmount"), line.netAmount, invoiceFormat);
    setDecimalCell(row.getCell("vatRate"), line.vatRate, precisionFormat);
    setDecimalCell(row.getCell("vatAmount"), line.vatAmount, invoiceFormat);
    setDecimalCell(row.getCell("grossAmount"), line.grossAmount, invoiceFormat);
  }
  styleWorksheet(lineSheet);

  return workbook;
}

export async function invoiceExportToXlsx(invoices: InvoiceExportRow[], lines: InvoiceLineExportRow[]) {
  return createInvoiceExportWorkbook(invoices, lines).xlsx.writeBuffer();
}
