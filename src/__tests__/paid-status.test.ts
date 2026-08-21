import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { invoiceExportToXlsx, type InvoiceExportRow } from "@/src/lib/invoice-xlsx";

const baseLine = {
  invoiceId: 1, vendorName: "Vendor", vendorTaxId: null, invoiceNumber: "INV-1",
  invoiceDate: "2026-01-15", invoiceStatus: "approved" as const, currency: "EUR", currencyType: "fiat" as const,
  lineNumber: "1", descriptionOriginal: null, description: null, quantity: null, unit: null,
  unitPrice: null, netAmount: "100", vatRate: null, vatAmount: "0", grossAmount: "100", sourcePage: null,
  recognitionTreatment: "Immediate" as const, recognitionStartDate: null, recognitionEndDate: null,
  accountingAccountNumber: null, prepaidAccountNumber: null,
};

function makeInvoice(overrides: Partial<InvoiceExportRow> = {}): InvoiceExportRow {
  return {
    id: 1, vendorName: "Vendor", vendorTaxId: null, vendorExternalNumber: null,
    invoiceNumber: "INV-1", invoiceDate: "2026-01-15", dueDate: null,
    currency: "EUR", currencyType: "fiat",
    netAmount: "100", lineNetAdjustment: "0", vatAmount: "0", grossAmount: "100",
    baseNetAmount: "100", baseVatAmount: "0", baseGrossAmount: "100",
    status: "approved", paymentStatus: "Unpaid", paidDate: null,
    ...overrides,
  };
}

describe("Invoice XLSX export — payment status columns", () => {
  it("includes Payment Status and Paid Date columns in Invoices sheet", async () => {
    const bytes = await invoiceExportToXlsx([makeInvoice()], [baseLine]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const sheet = workbook.getWorksheet("Invoices");
    const headers = sheet?.getRow(1).values as (string | undefined)[];
    expect(headers).toContain("Payment Status");
    expect(headers).toContain("Paid Date");
  });

  it("exports Unpaid status correctly", async () => {
    const bytes = await invoiceExportToXlsx([makeInvoice({ paymentStatus: "Unpaid", paidDate: null })], [baseLine]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const sheet = workbook.getWorksheet("Invoices");
    const headers = sheet?.getRow(1).values as (string | undefined)[];
    const paymentStatusCol = headers.indexOf("Payment Status");
    expect(sheet?.getRow(2).getCell(paymentStatusCol).value).toBe("Unpaid");
  });

  it("exports Paid status with date correctly", async () => {
    const bytes = await invoiceExportToXlsx([makeInvoice({ paymentStatus: "Paid", paidDate: "2026-02-01" })], [baseLine]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const sheet = workbook.getWorksheet("Invoices");
    const headers = sheet?.getRow(1).values as (string | undefined)[];
    const paymentStatusCol = headers.indexOf("Payment Status");
    const paidDateCol = headers.indexOf("Paid Date");
    expect(sheet?.getRow(2).getCell(paymentStatusCol).value).toBe("Paid");
    const paidDateCell = sheet?.getRow(2).getCell(paidDateCol);
    expect(paidDateCell?.value).toBeInstanceOf(Date);
    expect(paidDateCell?.numFmt).toBe("yyyy-mm-dd");
  });

  it("exports null Paid Date when status is Unpaid", async () => {
    const bytes = await invoiceExportToXlsx([makeInvoice({ paymentStatus: "Unpaid", paidDate: null })], [baseLine]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const sheet = workbook.getWorksheet("Invoices");
    const headers = sheet?.getRow(1).values as (string | undefined)[];
    const paidDateCol = headers.indexOf("Paid Date");
    expect(sheet?.getRow(2).getCell(paidDateCol).value).toBeNull();
  });
});
