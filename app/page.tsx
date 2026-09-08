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
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { PageActions, PageHeader, PageTitle } from "@/src/components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";

export const dynamic = "force-dynamic";

function statusBadge(status: string, t: { statusApproved: string; statusDraft: string }) {
  const label = status === "approved" ? t.statusApproved : t.statusDraft;
  return <Badge variant={status === "approved" ? "success" : "warning"}>{label}</Badge>;
}

function paymentStatusBadge(status: "Paid" | "Unpaid", t: { statusPaid: string; statusUnpaid: string }) {
  const paid = status === "Paid";
  return <Badge variant={paid ? "success" : "destructive"}>{paid ? t.statusPaid : t.statusUnpaid}</Badge>;
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
    <div>
      <PageHeader>
        <PageTitle>{t.title}</PageTitle>
        <PageActions>
          <form action="/api/invoices/export" method="get">
            <Button type="submit" variant="secondary">
              {t.exportInvoices}
            </Button>
          </form>
          <NewInvoiceUploadButton label={t.newInvoice} />
        </PageActions>
      </PageHeader>

      <Card className="invoice-filter-bar">
        <InvoicePaymentFilter
          label={t.paymentFilterLabel}
          allLabel={t.paymentFilterAll}
          unpaidLabel={common.statusUnpaid}
          paidLabel={common.statusPaid}
          value={paymentFilter}
        />
      </Card>

      {deleted === "1" && (
        <div className="ui-alert ui-alert-success mb-4">
          {t.deleted}
        </div>
      )}

      {!hasAnyInvoices ? (
        <div className="ui-empty-state">
          <div className="mb-2 text-base font-semibold text-[var(--heading)]">{t.noInvoicesTitle}</div>
          <div className="mb-5">{t.noInvoicesDesc}</div>
          <NewInvoiceUploadButton label={t.uploadInvoice} />
        </div>
      ) : rows.length === 0 ? (
        <div className="invoice-list-filter-empty">{t.noFilterResults}</div>
      ) : (
        <>
          <div className="invoice-list-desktop ui-table-shell">
            <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
                {[t.colVendor, t.colInvoiceNo, t.colDate, t.colAmount, t.colStatus, t.colNum, ""].map((h, idx) => (
                  <TableHead key={idx} className={idx === 3 ? "text-end" : undefined}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-semibold text-[var(--heading)]">{inv.vendorName ?? <span className="text-[var(--muted-foreground)]">{common.none}</span>}</TableCell>
                  <TableCell>{inv.invoiceNumber ?? <span className="text-[var(--muted-foreground)]">{common.none}</span>}</TableCell>
                  <TableCell className="text-[var(--muted-foreground)]">{inv.invoiceDate ?? common.none}</TableCell>
                  <TableCell className="text-end font-semibold tabular-nums">
                    {inv.grossAmount
                      ? `${inv.currency} ${formatDisplayAmount(inv.grossAmount, inv.currencyType)}`
                      : common.none}
                  </TableCell>
                  <TableCell>
                    <div className="invoice-list-status-badges">
                      {statusBadge(inv.status, common)}
                      {paymentStatusBadge(inv.paymentStatus, common)}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-[var(--muted-foreground)]">#{inv.id}</TableCell>
                  <TableCell className="text-end">
                    <Link href={`/invoices/${inv.id}`} className="ui-table-action">
                      {t.review}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            </Table>
          </div>
          <div className="invoice-list-mobile">
            {rows.map((inv) => (
              <article className="invoice-list-card" key={inv.id}>
                <div className="invoice-list-card-header">
                  <div className="invoice-list-card-vendor">
                    {inv.vendorName ?? <span className="invoice-list-card-none">{common.none}</span>}
                  </div>
                  <div className="invoice-list-status-badges invoice-list-card-status">
                    {statusBadge(inv.status, common)}
                    {paymentStatusBadge(inv.paymentStatus, common)}
                  </div>
                </div>
                <div className="invoice-list-card-details">
                  <span className="invoice-list-card-invoice-number">
                    {inv.invoiceNumber ?? <span className="invoice-list-card-none">{common.none}</span>}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{inv.invoiceDate ?? common.none}</span>
                </div>
                <div className="invoice-list-card-summary">
                  <div className="invoice-list-card-amount">
                    {inv.grossAmount
                      ? `${inv.currency} ${formatDisplayAmount(inv.grossAmount, inv.currencyType)}`
                      : common.none}
                  </div>
                  <Link className="invoice-list-card-review" href={`/invoices/${inv.id}`}>
                    {t.review}
                  </Link>
                </div>
                <div className="invoice-list-card-id">#{inv.id}</div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
