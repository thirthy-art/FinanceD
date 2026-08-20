import Link from "next/link";
import { cookies } from "next/headers";
import { getDb } from "@/src/db";
import { supplierInvoices, vendors } from "@/src/db/schema";
import { eq, desc } from "drizzle-orm";
import { getOrCreateCompany } from "@/src/lib/db-helpers";
import { formatDisplayAmount } from "@/src/lib/invoice-validation";
import { resolveLocale, getMessages } from "@/src/i18n/index";
import { LOCALE_COOKIE } from "@/src/i18n/types";

export const dynamic = "force-dynamic";

function statusBadge(status: string, t: { statusApproved: string; statusDraft: string }) {
  const label = status === "approved" ? t.statusApproved : t.statusDraft;
  const style: React.CSSProperties =
    status === "approved"
      ? { background: "#dcfce7", color: "#166534", padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600 }
      : { background: "#fef9c3", color: "#713f12", padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600 };
  return <span style={style}>{label}</span>;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  await getOrCreateCompany();
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);
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
      vendorName: vendors.name,
      createdAt: supplierInvoices.createdAt,
    })
    .from(supplierInvoices)
    .leftJoin(vendors, eq(supplierInvoices.vendorId, vendors.id))
    .orderBy(desc(supplierInvoices.createdAt));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1e3a5f" }}>{t.title}</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <form action="/api/invoices/export" method="get">
            <button
              type="submit"
              style={{ border: "1px solid #cbd5e1", color: "#334155", background: "#fff", padding: "8px 18px", borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              {t.exportInvoices}
            </button>
          </form>
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
            {t.newInvoice}
          </Link>
        </div>
      </div>

      {deleted === "1" && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#166534", fontSize: 14 }}>
          {t.deleted}
        </div>
      )}

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
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{t.noInvoicesTitle}</div>
          <div style={{ marginBottom: 20 }}>{t.noInvoicesDesc}</div>
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
            {t.uploadInvoice}
          </Link>
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {[t.colNum, t.colVendor, t.colInvoiceNo, t.colDate, t.colAmount, t.colStatus, ""].map((h, idx) => (
                  <th
                    key={idx}
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
                  <td style={{ padding: "12px 16px", fontWeight: 500 }}>{inv.vendorName ?? <span style={{ color: "#94a3b8" }}>{common.none}</span>}</td>
                  <td style={{ padding: "12px 16px" }}>{inv.invoiceNumber ?? <span style={{ color: "#94a3b8" }}>{common.none}</span>}</td>
                  <td style={{ padding: "12px 16px", color: "#64748b" }}>{inv.invoiceDate ?? common.none}</td>
                  <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                    {inv.grossAmount
                      ? `${inv.currency} ${formatDisplayAmount(inv.grossAmount, inv.currencyType)}`
                      : common.none}
                  </td>
                  <td style={{ padding: "12px 16px" }}>{statusBadge(inv.status, common)}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <Link
                      href={`/invoices/${inv.id}`}
                      style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500, fontSize: 13 }}
                    >
                      {t.review}
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
