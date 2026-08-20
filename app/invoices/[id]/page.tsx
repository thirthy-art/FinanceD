import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/src/db";
import {
  supplierInvoices,
  supplierInvoiceDocuments,
  supplierInvoiceLines,
  vendors,
  costCentres,
  chartOfAccounts,
  companies,
} from "@/src/db/schema";
import { and, eq, asc, count } from "drizzle-orm";
import InvoiceReview from "@/src/components/InvoiceReview";
import Link from "next/link";
import { parseInvoiceFields } from "@/src/lib/extract";
import { stripTrailingZeros } from "@/src/lib/invoice-validation";
import { resolveLocale, getMessages } from "@/src/i18n/index";
import { LOCALE_COOKIE } from "@/src/i18n/types";
import { getActiveCompany } from "@/src/lib/active-company";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const activeCompany = await getActiveCompany();
  const db = getDb();

  const [invoice] = await db
    .select()
    .from(supplierInvoices)
    .where(and(
      eq(supplierInvoices.id, Number(id)),
      eq(supplierInvoices.companyId, activeCompany.id),
    ));

  if (!invoice) notFound();

  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const { invoiceDetail: t } = getMessages(locale);

  const [docs, lines, vendorList, ccList, acctList, [company]] = await Promise.all([
    db.select().from(supplierInvoiceDocuments).where(eq(supplierInvoiceDocuments.invoiceId, invoice.id)),
    db.select().from(supplierInvoiceLines).where(eq(supplierInvoiceLines.invoiceId, invoice.id)).orderBy(asc(supplierInvoiceLines.position)),
    db.select({
      id: vendors.id,
      name: vendors.name,
      taxId: vendors.taxId,
      normalizedTaxId: vendors.normalizedTaxId,
      invoiceCount: count(supplierInvoices.id),
    })
      .from(vendors)
      .leftJoin(supplierInvoices, and(
        eq(supplierInvoices.vendorId, vendors.id),
        eq(supplierInvoices.companyId, activeCompany.id),
      ))
      .where(eq(vendors.companyId, invoice.companyId))
      .groupBy(vendors.id)
      .orderBy(asc(vendors.name)),
    db.select().from(costCentres).where(eq(costCentres.companyId, invoice.companyId)),
    db.select().from(chartOfAccounts).where(eq(chartOfAccounts.companyId, invoice.companyId)),
    db.select({ baseCurrency: companies.baseCurrency }).from(companies).where(eq(companies.id, invoice.companyId)),
  ]);

  const extractedText = docs[0]?.extractedText ?? "";
  const extractedFields = parseInvoiceFields(extractedText) as Record<string, string>;

  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
        <Link href="/" style={{ color: "#2563eb", textDecoration: "none", fontSize: 13 }}>
          {t.allInvoices}
        </Link>
        <span style={{ color: "#cbd5e1" }}>/</span>
        <span style={{ fontSize: 13, color: "#64748b" }}>
          Invoice #{invoice.id}
          {invoice.invoiceNumber ? ` · ${invoice.invoiceNumber}` : ""}
        </span>
      </div>
      <InvoiceReview
        invoice={invoice}
        documents={docs}
        lines={lines.map((line) => ({
          id: line.id,
          lineNumber: line.lineNumber ?? "",
          descriptionOriginal: line.descriptionOriginal ?? "",
          description: line.description ?? "",
          quantity: stripTrailingZeros(line.quantity),
          unit: line.unit ?? "",
          unitPrice: stripTrailingZeros(line.unitPrice),
          netAmount: line.netAmountDerived ? "" : stripTrailingZeros(line.netAmount),
          vatRate: stripTrailingZeros(line.vatRate),
          vatAmount: line.vatAmountDerived ? "" : stripTrailingZeros(line.vatAmount),
          grossAmount: line.grossAmountDerived ? "" : stripTrailingZeros(line.grossAmount),
          sourcePage: line.sourcePage === null ? "" : String(line.sourcePage),
          recognitionTreatment: line.recognitionTreatment ?? "Immediate",
          recognitionStartDate: line.recognitionStartDate ?? "",
          recognitionEndDate: line.recognitionEndDate ?? "",
          accountingAccountNumber: line.accountingAccountNumber ?? "",
          prepaidAccountNumber: line.prepaidAccountNumber ?? "",
        }))}
        vendors={vendorList}
        costCentres={ccList}
        accounts={acctList}
        extractedFields={extractedFields}
        baseCurrency={company?.baseCurrency ?? "EUR"}
      />
    </div>
  );
}
