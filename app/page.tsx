import { cookies } from "next/headers";
import { getDb } from "@/src/db";
import { supplierInvoices, vendors } from "@/src/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { getActiveCompanyForPage } from "@/src/lib/active-company-page";
import CompanySelectionRequired from "@/src/components/CompanySelectionRequired";
import { resolveLocale, getMessages } from "@/src/i18n/index";
import { LOCALE_COOKIE } from "@/src/i18n/types";
import NewInvoiceUploadButton from "@/src/components/NewInvoiceUploadButton";
import InvoiceListClient from "@/src/components/InvoiceListClient";
import { PageTitle } from "@/src/components/ui/page";
import styles from "./invoice-list.module.css";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string | string[]; payment?: string | string[] }>;
}) {
  const query = await searchParams;
  const deleted = Array.isArray(query.deleted) ? query.deleted[0] : query.deleted;
  const paymentParam = Array.isArray(query.payment) ? query.payment[0] : query.payment;
  const paymentFilter = paymentParam === "paid" || paymentParam === "unpaid" ? paymentParam : "all";
  const selectedPaymentStatus = paymentFilter === "paid" ? "Paid" : paymentFilter === "unpaid" ? "Unpaid" : undefined;
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const company = await getActiveCompanyForPage();
  if (!company) return <CompanySelectionRequired locale={locale} />;
  const { invoiceList: t, common } = getMessages(locale);

  const db = getDb();
  const rows = await db
    .select({
      id: supplierInvoices.id,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      currency: supplierInvoices.currency,
      currencyType: supplierInvoices.currencyType,
      grossAmount: supplierInvoices.grossAmount,
      status: supplierInvoices.status,
      paymentStatus: supplierInvoices.paymentStatus,
      vendorName: vendors.name,
      createdAt: supplierInvoices.createdAt,
    })
    .from(supplierInvoices)
    .leftJoin(vendors, and(
      eq(supplierInvoices.vendorId, vendors.id),
      eq(vendors.companyId, company.id),
    ))
    .where(and(
      eq(supplierInvoices.companyId, company.id),
      selectedPaymentStatus ? eq(supplierInvoices.paymentStatus, selectedPaymentStatus) : undefined,
    ))
    .orderBy(desc(supplierInvoices.createdAt));

  let hasAnyInvoices = rows.length > 0;
  if (!hasAnyInvoices) {
    const [existingInvoice] = await db
      .select({ id: supplierInvoices.id })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.companyId, company.id))
      .limit(1);
    hasAnyInvoices = Boolean(existingInvoice);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <PageTitle>{t.title}</PageTitle>
        <NewInvoiceUploadButton label={t.newInvoice} />
      </header>

      <section className={styles.results} aria-label={t.title}>
        <InvoiceListClient
          rows={rows}
          hasAnyInvoices={hasAnyInvoices}
          paymentFilter={paymentFilter}
          showSingleDeleteNotice={deleted === "1"}
          labels={t}
          common={common}
        />
      </section>
    </div>
  );
}
