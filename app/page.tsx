import Link from "next/link";
import { getDb } from "@/src/db";
import { supplierInvoices, vendors } from "@/src/db/schema";
import { eq, desc } from "drizzle-orm";
import { getOrCreateCompany } from "@/src/lib/db-helpers";
import { formatDisplayAmount } from "@/src/lib/invoice-validation";

export const dynamic = "force-dynamic";

function statusBadge(status: string) {
  const style: React.CSSProperties =
    status === "approved"
      ? { background: "#dcfce7", color: "#166534", padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600 }
      : { background: "#fef9c3", color: "#713f12", padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600 };
  return <span style={style}>{status}</span>;
}

export default async function Home() {
  await getOrCreateCompany();
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
      vendorName: vendors.name,
      createdAt: supplierInvoices.createdAt,
    })
    .from(supplierInvoices)
    .leftJoin(vendors, eq(supplierInvoices.vendorId, vendors.id))
    .orderBy(desc(supplierInvoices.createdAt));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1e3a5f" }}>Supplier Invoices</h1>
        <Link
          href="/invoices/new"
          style={{
            background: "#2563eb",
            color: "#fff",
            padding: "8px 18px",
            borderRadius: 6,
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          + New Invoice
        </Link>
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "48px 24px",
            textAlign: "center",
            color: "#718096",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No invoices yet</div>
          <div style={{ marginBottom: 20 }}>Upload your first supplier invoice to get started.</div>
          <Link
            href="/invoices/new"
            style={{
              background: "#2563eb",
              color: "#fff",
              padding: "10px 20px",
              borderRadius: 6,
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Upload Invoice
          </Link>
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {["#", "Vendor", "Invoice No.", "Date", "Amount", "Status", ""].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 16px",
                      textAlign: "left",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((inv, i) => (
                <tr
                  key={inv.id}
                  style={{ borderBottom: i < rows.length - 1 ? "1px solid #f1f5f9" : "none" }}
                >
                  <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 12 }}>{inv.id}</td>
                  <td style={{ padding: "12px 16px", fontWeight: 500 }}>{inv.vendorName ?? <span style={{ color: "#94a3b8" }}>—</span>}</td>
                  <td style={{ padding: "12px 16px" }}>{inv.invoiceNumber ?? <span style={{ color: "#94a3b8" }}>—</span>}</td>
                  <td style={{ padding: "12px 16px", color: "#64748b" }}>{inv.invoiceDate ?? "—"}</td>
                  <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                    {inv.grossAmount
                      ? `${inv.currency} ${formatDisplayAmount(inv.grossAmount, inv.currencyType)}`
                      : "—"}
                  </td>
                  <td style={{ padding: "12px 16px" }}>{statusBadge(inv.status)}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <Link
                      href={`/invoices/${inv.id}`}
                      style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500, fontSize: 13 }}
                    >
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
