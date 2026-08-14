import { normalizeDateForInput } from "@/src/lib/date";

export interface CsvInvoice {
  vendor: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  netAmount: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  status: string;
}

function escapeCsvValue(value: string | null) {
  let text = value ?? "";
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function invoicesToCsv(invoices: CsvInvoice[]) {
  const header = ["Vendor", "Invoice number", "Invoice date", "Due date", "Currency", "Net amount", "VAT amount", "Gross amount", "Status"];
  const rows = invoices.map((invoice) => [
    invoice.vendor,
    invoice.invoiceNumber,
    normalizeDateForInput(invoice.invoiceDate),
    normalizeDateForInput(invoice.dueDate),
    invoice.currency,
    invoice.netAmount,
    invoice.vatAmount,
    invoice.grossAmount,
    invoice.status,
  ]);
  return [header, ...rows].map((row) => row.map((value) => escapeCsvValue(value)).join(",")).join("\r\n") + "\r\n";
}
