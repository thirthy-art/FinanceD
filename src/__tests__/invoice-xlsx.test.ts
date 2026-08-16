import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { invoiceExportToXlsx, type InvoiceLineExportRow } from "@/src/lib/invoice-xlsx";

describe("invoice XLSX export", () => {
  it("contains both worksheets and one row for each of six invoice lines", async () => {
    const invoice = {
      id: 7, vendorName: "ACME", vendorTaxId: "CY123", vendorExternalNumber: null,
      invoiceNumber: "INV-7", invoiceDate: "2026-08-15", dueDate: null,
      currency: "EUR", currencyType: "fiat" as const,
      netAmount: "52.000000000000000000", vatAmount: "9.88", grossAmount: "61.88",
      baseNetAmount: "52", baseVatAmount: "9.88", baseGrossAmount: "61.88", status: "approved" as const,
      paymentStatus: "Unpaid" as const, paidDate: null,
    };
    const lines: InvoiceLineExportRow[] = Array.from({ length: 6 }, (_, index) => ({
      invoiceId: 7, vendorName: "ACME", vendorTaxId: "CY123", invoiceNumber: "INV-7",
      invoiceDate: "2026-08-15", invoiceStatus: "approved" as const, currency: "EUR", currencyType: "fiat" as const,
      lineNumber: String(index + 1), descriptionOriginal: `Original ${index + 1}`, description: `Line ${index + 1}`,
      quantity: "1", unit: "ea", unitPrice: "8.666666666666666667", netAmount: "8.666666666666666667",
      vatRate: "19", vatAmount: null, grossAmount: null, sourcePage: 1,
      recognitionTreatment: "Immediate" as const, recognitionStartDate: null, recognitionEndDate: null,
      accountingAccountNumber: null, prepaidAccountNumber: null,
    }));

    const bytes = await invoiceExportToXlsx([invoice], lines);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Invoices", "Invoice Lines"]);
    expect(workbook.getWorksheet("Invoices")?.rowCount).toBe(2);
    expect(workbook.getWorksheet("Invoice Lines")?.rowCount).toBe(7);
    // Column I is "Net Amount" (shifted by 1 due to "Vendor External No." in column D)
    expect(workbook.getWorksheet("Invoices")?.getCell("I2").numFmt).toBe("0.00");
    expect(workbook.getWorksheet("Invoice Lines")?.getCell("I2").value).toBe("Original 1");
    expect(workbook.getWorksheet("Invoice Lines")?.getCell("J2").value).toBe("Line 1");

    const lineHeaders = workbook.getWorksheet("Invoice Lines")?.getRow(1).values as (string | undefined)[];
    expect(lineHeaders).toContain("Accounting Account No.");
    expect(lineHeaders).toContain("Prepaid Account No.");
  });
});
