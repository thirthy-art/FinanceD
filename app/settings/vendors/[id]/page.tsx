import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { and, asc, count, eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import { companies, supplierInvoices, vendors } from "@/src/db/schema";
import VendorActions from "@/src/components/VendorActions";
import { Decimal } from "@/src/lib/decimal";
import { calculateVendorInvoiceTotals } from "@/src/lib/vendor-totals";
import { resolveLocale, getMessages } from "@/src/i18n/index";
import { LOCALE_COOKIE } from "@/src/i18n/types";
import { getActiveCompanyForPage } from "@/src/lib/active-company-page";
import CompanySelectionRequired from "@/src/components/CompanySelectionRequired";
import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { EmptyState } from "@/src/components/ui/feedback";
import { PageDescription, PageHeader, PageHeading, PageTitle } from "@/src/components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";

function displayAmount(value: string | null) {
  if (!value) return "—";
  try { return new Decimal(value).toFixed(); } catch { return value; }
}

export default async function VendorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const vendorId = Number(id);
  if (!Number.isInteger(vendorId) || vendorId <= 0) notFound();
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const activeCompany = await getActiveCompanyForPage();
  if (!activeCompany) return <CompanySelectionRequired locale={locale} />;
  const db = getDb();
  const [vendor] = await db.select().from(vendors).where(and(
    eq(vendors.id, vendorId),
    eq(vendors.companyId, activeCompany.id),
  ));
  if (!vendor) notFound();

  const { vendorDetail: vd } = getMessages(locale);

  const [invoiceRows, targetRows, [company]] = await Promise.all([
    db.select({
      id: supplierInvoices.id,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      status: supplierInvoices.status,
      currency: supplierInvoices.currency,
      grossAmount: supplierInvoices.grossAmount,
      baseGrossAmount: supplierInvoices.baseGrossAmount,
    }).from(supplierInvoices).where(and(
      eq(supplierInvoices.vendorId, vendor.id),
      eq(supplierInvoices.companyId, activeCompany.id),
    )).orderBy(asc(supplierInvoices.invoiceDate), asc(supplierInvoices.id)),
    db.select({
      id: vendors.id,
      name: vendors.name,
      taxId: vendors.taxId,
      invoiceCount: count(supplierInvoices.id),
    }).from(vendors)
      .leftJoin(supplierInvoices, and(
        eq(supplierInvoices.vendorId, vendors.id),
        eq(supplierInvoices.companyId, activeCompany.id),
      ))
      .where(eq(vendors.companyId, vendor.companyId))
      .groupBy(vendors.id)
      .orderBy(asc(vendors.name)),
    db.select({ baseCurrency: companies.baseCurrency }).from(companies).where(eq(companies.id, vendor.companyId)),
  ]);

  const draftCount = invoiceRows.filter((invoice) => invoice.status === "draft").length;
  const approvedCount = invoiceRows.filter((invoice) => invoice.status === "approved").length;
  const totals = calculateVendorInvoiceTotals(invoiceRows);
  const targets = targetRows.filter((candidate) => candidate.id !== vendor.id);

  return (
    <div>
      <PageHeader><PageHeading><Link href="/settings/vendors" className="ui-back-link">← {vd.backToVendors}</Link><PageTitle>{vendor.name}</PageTitle><PageDescription>{vendor.taxId ?? vd.labelTaxId}</PageDescription></PageHeading></PageHeader>
      <Card className="mb-5">
        <CardContent className="pt-5"><dl className="vendor-info-grid">
          <Info label={vd.labelVendorName} value={vendor.name} />
          <Info label={vd.labelTaxId} value={vendor.taxId ?? "—"} />
          <Info label={vd.labelDefaultCurrency} value={vendor.defaultCurrency ?? "—"} />
          <div><dt className="ui-definition-label">{vd.labelActiveStatus}</dt><dd className="ui-definition-value"><Badge variant={vendor.isActive ? "success" : "neutral"}>{vendor.isActive ? vd.active : vd.inactive}</Badge></dd></div>
          <Info label={vd.labelDraftInvoices} value={String(draftCount)} />
          <Info label={vd.labelApprovedInvoices} value={String(approvedCount)} />
        </dl></CardContent>
      </Card>

      <Card className="mb-5">
        <CardHeader><CardTitle>{vd.totalInvoiced}</CardTitle><p className="text-sm text-[var(--muted-foreground)]">{vd.approvedOnly}</p></CardHeader>
        <CardContent className="vendor-total-grid">
        {totals.approved.length === 0 ? <p>—</p> : totals.approved.map((total) => <p key={total.currency}><strong>{total.currency}</strong> {displayAmount(total.amount)}</p>)}
        {totals.baseApproved && (
          <p>
            <strong>{vd.baseCurrencyLabel.replace("{base}", company?.baseCurrency ?? vd.companyBaseCurrency)}</strong>{" "}
            {displayAmount(totals.baseApproved)}
          </p>
        )}
        <h3 className="col-span-full mt-2 text-sm font-semibold text-[var(--heading)]">{vd.draftTotals}</h3>
        {totals.drafts.length === 0 ? <p>—</p> : totals.drafts.map((total) => <p key={total.currency}><strong>{total.currency}</strong> {displayAmount(total.amount)}</p>)}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader><CardTitle>{vd.associatedInvoices}</CardTitle></CardHeader>
        {invoiceRows.length === 0 ? <EmptyState className="m-5 mt-0">{vd.noAssociatedInvoices}</EmptyState> : (
          <Table>
            <TableHeader><TableRow>{[vd.colInvoiceNumber, vd.colDate, vd.colStatus, vd.colCurrency, vd.colGrossAmount].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{invoiceRows.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell><Link href={`/invoices/${invoice.id}`} className="ui-table-link">{invoice.invoiceNumber ?? `${vd.invoicePrefix} ${invoice.id}`}</Link></TableCell>
                <TableCell>{invoice.invoiceDate ?? "—"}</TableCell>
                <TableCell><Badge variant={invoice.status === "approved" ? "success" : "warning"}>{invoice.status}</Badge></TableCell>
                <TableCell>{invoice.currency}</TableCell>
                <TableCell className="text-end font-semibold tabular-nums">{displayAmount(invoice.grossAmount)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
        <CardContent><VendorActions
          source={{ id: vendor.id, name: vendor.name, taxId: vendor.taxId, invoiceCount: invoiceRows.length }}
          targets={targets}
          initialMode={query.action === "merge" ? "merge" : "idle"}
        /></CardContent>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><dt className="ui-definition-label">{label}</dt><dd className="ui-definition-value">{value}</dd></div>;
}
