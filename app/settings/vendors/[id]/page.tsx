import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, count, eq } from "drizzle-orm";
import { getDb } from "@/src/db";
import { companies, supplierInvoices, vendors } from "@/src/db/schema";
import VendorActions from "@/src/components/VendorActions";
import { Decimal } from "@/src/lib/decimal";
import { calculateVendorInvoiceTotals } from "@/src/lib/vendor-totals";

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
  const db = getDb();
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, vendorId));
  if (!vendor) notFound();

  const [invoiceRows, targetRows, [company]] = await Promise.all([
    db.select({
      id: supplierInvoices.id,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      status: supplierInvoices.status,
      currency: supplierInvoices.currency,
      grossAmount: supplierInvoices.grossAmount,
      baseGrossAmount: supplierInvoices.baseGrossAmount,
    }).from(supplierInvoices).where(eq(supplierInvoices.vendorId, vendor.id)).orderBy(asc(supplierInvoices.invoiceDate), asc(supplierInvoices.id)),
    db.select({
      id: vendors.id,
      name: vendors.name,
      taxId: vendors.taxId,
      invoiceCount: count(supplierInvoices.id),
    }).from(vendors)
      .leftJoin(supplierInvoices, eq(supplierInvoices.vendorId, vendors.id))
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
      <Link href="/settings/vendors" style={{ color: "#2563eb" }}>← Vendors</Link>
      <h1 style={{ margin: "16px 0 20px", fontSize: 22, color: "#1e3a5f" }}>{vendor.name}</h1>
      <section style={cardStyle}>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, margin: 0 }}>
          <Info label="Vendor Name" value={vendor.name} />
          <Info label="VAT/Tax ID" value={vendor.taxId ?? "—"} />
          <Info label="Default Currency" value={vendor.defaultCurrency ?? "—"} />
          <Info label="Active Status" value={vendor.isActive ? "Active" : "Inactive"} />
          <Info label="Draft Invoices" value={String(draftCount)} />
          <Info label="Approved Invoices" value={String(approvedCount)} />
        </dl>
      </section>

      <section style={cardStyle}>
        <h2 style={headingStyle}>Total Invoiced</h2>
        <p style={{ color: "#64748b", marginTop: 0 }}>Approved invoices only</p>
        {totals.approved.length === 0 ? <p>—</p> : totals.approved.map((total) => <p key={total.currency}><strong>{total.currency}</strong> {displayAmount(total.amount)}</p>)}
        {totals.baseApproved && <p><strong>Company base currency ({company?.baseCurrency ?? "Base"})</strong> {displayAmount(totals.baseApproved)}</p>}
        <h3 style={{ fontSize: 14, marginTop: 20 }}>Draft totals (excluded from Total Invoiced)</h3>
        {totals.drafts.length === 0 ? <p>—</p> : totals.drafts.map((total) => <p key={total.currency}><strong>{total.currency}</strong> {displayAmount(total.amount)}</p>)}
      </section>

      <section style={{ ...cardStyle, overflowX: "auto" }}>
        <h2 style={headingStyle}>Associated invoices</h2>
        {invoiceRows.length === 0 ? <p style={{ color: "#64748b" }}>No associated invoices.</p> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Invoice Number", "Invoice Date", "Status", "Currency", "Gross Amount"].map((label) => <th key={label} style={thStyle}>{label}</th>)}</tr></thead>
            <tbody>{invoiceRows.map((invoice) => (
              <tr key={invoice.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td style={tdStyle}><Link href={`/invoices/${invoice.id}`} style={{ color: "#2563eb" }}>{invoice.invoiceNumber ?? `Invoice ${invoice.id}`}</Link></td>
                <td style={tdStyle}>{invoice.invoiceDate ?? "—"}</td>
                <td style={tdStyle}>{invoice.status}</td>
                <td style={tdStyle}>{invoice.currency}</td>
                <td style={tdStyle}>{displayAmount(invoice.grossAmount)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <VendorActions
          source={{ id: vendor.id, name: vendor.name, taxId: vendor.taxId, invoiceCount: invoiceRows.length }}
          targets={targets}
          initialMode={query.action === "merge" ? "merge" : "idle"}
        />
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><dt style={{ fontSize: 12, color: "#64748b" }}>{label}</dt><dd style={{ margin: "4px 0 0", fontWeight: 600 }}>{value}</dd></div>;
}

const cardStyle: React.CSSProperties = { marginBottom: 20, padding: 20, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 };
const headingStyle: React.CSSProperties = { margin: "0 0 12px", fontSize: 17, color: "#334155" };
const thStyle: React.CSSProperties = { padding: "9px 10px", textAlign: "left", fontSize: 12, color: "#64748b" };
const tdStyle: React.CSSProperties = { padding: "10px" };
