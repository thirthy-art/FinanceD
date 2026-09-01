"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import VendorListActions from "@/src/components/VendorListActions";
import { useI18n } from "@/src/i18n/context";

interface Vendor {
  id: number;
  name: string;
  taxId: string | null;
  address: string | null;
  defaultCurrency: string | null;
  vendorStatus: "draft" | "active";
  isActive: boolean;
  invoiceCount: number;
  possibleDuplicate: boolean;
}

const inputStyle: React.CSSProperties = { padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 13 };

async function fetchVendors(): Promise<Vendor[]> {
  return fetch("/api/settings/vendors").then((response) => response.json());
}

function VendorsContent() {
  const { t } = useI18n();
  const v = t.vendors;
  const cm = t.common;

  const searchParams = useSearchParams();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newTaxId, setNewTaxId] = useState("");
  const [newCurrency, setNewCurrency] = useState("");
  const [addError, setAddError] = useState("");
  const [actionError, setActionError] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<Vendor>>({});
  const action = searchParams.get("action");
  const notice = action === "deleted"
    ? v.deletedNotice
    : action === "merged" ? v.mergedNotice : "";

  async function load() {
    const data = await fetchVendors();
    setVendors(data);
    setLoading(false);
  }
  useEffect(() => {
    let cancelled = false;
    void fetchVendors().then((data) => {
      if (!cancelled) {
        setVendors(data);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  async function addVendor(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    const body: Record<string, string> = { name: newName };
    if (newTaxId) body.taxId = newTaxId;
    if (newCurrency) body.defaultCurrency = newCurrency;
    const res = await fetch("/api/settings/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) { setAddError(v.couldNotAdd); return; }
    setNewName(""); setNewTaxId(""); setNewCurrency("");
    load();
  }

  async function saveEdit(id: number) {
    await fetch(`/api/settings/vendors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editData),
    });
    setEditId(null);
    load();
  }

  if (loading) return <div style={{ color: "#94a3b8" }}>{v.loading}</div>;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1e3a5f", marginBottom: 24 }}>{v.title}</h1>
      {notice && <div style={{ marginBottom: 16, padding: 12, borderRadius: 6, background: "#ecfdf5", color: "#166534" }}>{notice}</div>}
      {actionError && <div role="alert" style={{ marginBottom: 16, padding: 12, borderRadius: 6, background: "#fef2f2", color: "#b91c1c" }}>{actionError}</div>}

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", marginBottom: 32 }}>
        {vendors.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "#94a3b8" }}>{v.noVendors}</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {[v.colName, v.colTaxId, v.colDefaultCurrency, v.colActive, v.colInvoices, v.colDuplicate, ""].map((h) => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vendors.map((vendor, i) => (
                <tr key={vendor.id} style={{ borderBottom: i < vendors.length - 1 ? "1px solid #f1f5f9" : "none", opacity: vendor.isActive ? 1 : 0.45 }}>
                  {editId === vendor.id ? (
                    <>
                      <td style={{ padding: "8px 16px" }}>
                        <input style={{ ...inputStyle, width: 200 }} value={editData.name ?? vendor.name} onChange={(e) => setEditData((d) => ({ ...d, name: e.target.value }))} />
                      </td>
                      <td style={{ padding: "8px 16px" }}>
                        <input style={{ ...inputStyle, width: 120 }} value={editData.taxId ?? vendor.taxId ?? ""} onChange={(e) => setEditData((d) => ({ ...d, taxId: e.target.value }))} />
                      </td>
                      <td style={{ padding: "8px 16px" }}>
                        <input style={{ ...inputStyle, width: 60 }} value={editData.defaultCurrency ?? vendor.defaultCurrency ?? ""} maxLength={3} onChange={(e) => setEditData((d) => ({ ...d, defaultCurrency: e.target.value.toUpperCase() }))} />
                      </td>
                      <td />
                      <td />
                      <td />
                      <td style={{ padding: "8px 16px", display: "flex", gap: 8 }}>
                        <button onClick={() => saveEdit(vendor.id)} style={{ ...inputStyle, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer" }}>{cm.save}</button>
                        <button onClick={() => setEditId(null)} style={{ ...inputStyle, cursor: "pointer" }}>{cm.cancel}</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: "10px 16px", fontWeight: 500 }}>
                        <Link href={`/settings/vendors/${vendor.id}`} style={{ color: "#2563eb", textDecoration: "underline" }}>{vendor.name}</Link>
                      </td>
                      <td style={{ padding: "10px 16px", color: "#64748b" }}>{vendor.taxId ?? "—"}</td>
                      <td style={{ padding: "10px 16px", color: "#64748b" }}>{vendor.defaultCurrency ?? "—"}</td>
                      <td style={{ padding: "10px 16px" }}>{vendor.isActive ? "✓" : "—"}</td>
                      <td style={{ padding: "10px 16px" }}>{vendor.invoiceCount}</td>
                      <td style={{ padding: "10px 16px", color: vendor.possibleDuplicate ? "#b45309" : "#94a3b8" }}>
                        {vendor.possibleDuplicate ? v.possibleDuplicate : "—"}
                      </td>
                      <td style={{ padding: "10px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button onClick={() => { setEditId(vendor.id); setEditData({}); }} style={{ ...inputStyle, cursor: "pointer", fontSize: 12 }}>{cm.edit}</button>
                        <button
                          onClick={() => fetch(`/api/settings/vendors/${vendor.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !vendor.isActive }) }).then(load)}
                          style={{ ...inputStyle, cursor: "pointer", fontSize: 12, color: vendor.isActive ? "#dc2626" : "#16a34a" }}
                        >
                          {vendor.isActive ? cm.deactivate : cm.activate}
                        </button>
                        <VendorListActions vendor={vendor} onDeleted={load} onError={setActionError} />
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "#374151" }}>{v.addVendor}</h2>
        <form onSubmit={addVendor} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3 }}>{v.nameLabel}</label>
            <input style={{ ...inputStyle, width: 220 }} value={newName} onChange={(e) => setNewName(e.target.value)} required placeholder={v.vendorNamePlaceholder} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3 }}>{v.taxIdLabel}</label>
            <input style={{ ...inputStyle, width: 140 }} value={newTaxId} onChange={(e) => setNewTaxId(e.target.value)} placeholder={v.taxIdOptionalPlaceholder} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3 }}>{v.defaultCurrencyLabel}</label>
            <input style={{ ...inputStyle, width: 70 }} value={newCurrency} onChange={(e) => setNewCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="USD" />
          </div>
          <button type="submit" style={{ ...inputStyle, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}>
            {v.addVendor}
          </button>
        </form>
        {addError && <div style={{ marginTop: 8, color: "#dc2626", fontSize: 13 }}>{addError}</div>}
      </div>
    </div>
  );
}

export default function VendorsPage() {
  const { t } = useI18n();
  return <Suspense fallback={<div style={{ color: "#94a3b8" }}>{t.vendors.loading}</div>}><VendorsContent /></Suspense>;
}
