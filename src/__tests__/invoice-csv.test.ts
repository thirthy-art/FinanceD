import { describe, expect, it } from "vitest";
import { invoicesToCsv } from "@/src/lib/invoice-csv";

describe("invoice CSV export", () => {
  it("keeps decimal strings, normalizes dates, and escapes Excel CSV values", () => {
    const csv = invoicesToCsv([{
      vendor: 'Vendor, "North"',
      invoiceNumber: "=1+1",
      invoiceDate: "4/7/2026",
      dueDate: null,
      currency: "EUR",
      netAmount: "1234567890.123456789012345678",
      vatAmount: "0.00",
      grossAmount: "1234567890.123456789012345678",
      status: "draft",
    }]);

    expect(csv).toContain('"Vendor, ""North"""');
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"2026-07-04"');
    expect(csv).toContain('"1234567890.123456789012345678"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
