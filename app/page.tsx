import Link from "next/link";
import { cookies } from "next/headers";
import { getDb } from "@/src/db";
import { supplierInvoices, vendors } from "@/src/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { getActiveCompanyForPage } from "@/src/lib/active-company-page";
import CompanySelectionRequired from "@/src/components/CompanySelectionRequired";
import { formatDisplayAmount } from "@/src/lib/invoice-validation";
import { resolveLocale, getMessages } from "@/src/i18n/index";
import { LOCALE_COOKIE } from "@/src/i18n/types";
import NewInvoiceUploadButton from "@/src/components/NewInvoiceUploadButton";
import InvoicePaymentFilter from "@/src/components/InvoicePaymentFilter";
import { ChevronRight } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { PageTitle } from "@/src/components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";
import styles from "./invoice-list.module.css";

export const dynamic = "force-dynamic";

function statusBadge(status: string, t: { statusApproved: string; statusDraft: string }) {
  const label = status === "approved" ? t.statusApproved : t.statusDraft;
  return <span className={`${styles.workflow} ${status === "approved" ? styles.approved : ""}`}>{label}</span>;
}

function paymentStatusBadge(status: "Paid" | "Unpaid", t: { statusPaid: string; statusUnpaid: string }) {
  const paid = status === "Paid";
  return <span className={`${styles.payment} ${paid ? styles.paid : ""}`}>{paid ? t.statusPaid : t.statusUnpaid}</span>;
}

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
        <div className={styles.toolbar}>
          <InvoicePaymentFilter
            label={t.paymentFilterLabel}
            allLabel={t.paymentFilterAll}
            unpaidLabel={common.statusUnpaid}
            paidLabel={common.statusPaid}
            value={paymentFilter}
          />
          <form action="/api/invoices/export" method="get" className={styles.export}>
            <Button type="submit" variant="secondary" size="sm" aria-label={t.exportAllDescription}>
              {t.exportAll} · <bdi>XLSX</bdi>
            </Button>
          </form>
        </div>

        {deleted === "1" && (
          <div className={`${styles.notice} ui-alert ui-alert-success`} role="status">
            {t.deleted}
          </div>
        )}

        {!hasAnyInvoices ? (
          <div className={styles.empty}>
            <div className="mb-2 text-base font-semibold text-[var(--heading)]">{t.noInvoicesTitle}</div>
            <div className="mb-5">{t.noInvoicesDesc}</div>
            <NewInvoiceUploadButton label={t.uploadInvoice} />
          </div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>{t.noFilterResults}</div>
        ) : (
          <>
            <div className={styles.desktop}>
              <Table className={styles.table}>
                <colgroup>
                  <col className={styles.identityColumn} />
                  <col className={styles.dateColumn} />
                  <col className={styles.workflowColumn} />
                  <col className={styles.amountColumn} />
                  <col className={styles.actionColumn} />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t.colInvoice}</TableHead>
                    <TableHead scope="col">{t.colDate}</TableHead>
                    <TableHead scope="col">{t.colWorkflow}</TableHead>
                    <TableHead scope="col" className={styles.amountHeading}>{t.colAmount} / {t.paymentFilterLabel}</TableHead>
                    <TableHead scope="col"><span className="sr-only">{t.review}</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <Link href={`/invoices/${inv.id}`} className={styles.identity}>
                          <span className="sr-only">{t.review}: </span>
                          <span className={styles.vendor}><bdi>{inv.vendorName ?? common.none}</bdi></span>
                          <span className={styles.reference}>
                            <bdi>{inv.invoiceNumber ?? common.none}</bdi>
                            <bdi className={styles.id}>#{inv.id}</bdi>
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className={styles.date}><bdi>{inv.invoiceDate ?? common.none}</bdi></TableCell>
                      <TableCell>{statusBadge(inv.status, common)}</TableCell>
                      <TableCell>
                        <div className={styles.money}>
                          <span className={styles.amount} dir="ltr">
                            {inv.grossAmount ? <><span className={styles.currency}>{inv.currency}</span>{" "}{formatDisplayAmount(inv.grossAmount, inv.currencyType)}</> : common.none}
                          </span>
                          {paymentStatusBadge(inv.paymentStatus, common)}
                        </div>
                      </TableCell>
                      <TableCell className={styles.actionCell}>
                        <Link href={`/invoices/${inv.id}`} className={styles.review} aria-label={`${t.review}: ${inv.vendorName ?? common.none}, ${inv.invoiceNumber ?? common.none}, #${inv.id}`}>
                          <ChevronRight size={16} aria-hidden="true" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className={styles.mobile}>
              {rows.map((inv) => (
                <article key={inv.id}>
                  <Link className={styles.mobileRow} href={`/invoices/${inv.id}`}>
                    <span className="sr-only">{t.review}: </span>
                    <span className={styles.mobileIdentity}>
                      <span className={styles.vendor}><bdi>{inv.vendorName ?? common.none}</bdi></span>
                      <span className={styles.reference}><bdi>{inv.invoiceNumber ?? common.none}</bdi><bdi className={styles.id}>#{inv.id}</bdi></span>
                    </span>
                    <span className={styles.money}>
                      <span className={styles.amount} dir="ltr">
                        {inv.grossAmount ? <><span className={styles.currency}>{inv.currency}</span>{" "}{formatDisplayAmount(inv.grossAmount, inv.currencyType)}</> : common.none}
                      </span>
                      <span className="sr-only">{t.paymentFilterLabel}: </span>
                      {paymentStatusBadge(inv.paymentStatus, common)}
                    </span>
                    <span className={styles.date}><span className="sr-only">{t.colDate}: </span><bdi>{inv.invoiceDate ?? common.none}</bdi></span>
                    <span className={styles.mobileWorkflow}><span>{t.colWorkflow}: </span>{statusBadge(inv.status, common)}</span>
                    <ChevronRight className={styles.mobileChevron} size={16} aria-hidden="true" />
                  </Link>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
