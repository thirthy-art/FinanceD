"use client";
import { useEffect, useState } from "react";

interface Vendor { id: number; name: string; taxId: string | null; address: string | null; defaultCurrency: string | null; isActive: boolean; }

const inputStyle: React.CSSProperties = { padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 13 };

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newTaxId, setNewTaxId] = useState("");
  const [newCurrency, setNewCurrency] = useState("");
  const [addError, setAddError] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<Vendor>>({});

  async function load() {
    const data = await fetch("/api/settings/vendors").then((r) => r.json());
    setVendors(data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

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
    if (!res.ok) { setAddError("Could not add vendor."); return; }
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

  if (loading) return <div style={{ color: "#94a3b8" }}>Loading…</div>;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1e3a5f", marginBottom: 24 }}>Vendors</h1>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", marginBottom: 32 }}>
        {vendors.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "#94a3b8" }}>No vendors yet.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {["Name", "Tax ID", "Currency", "Active", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vendors.map((v, i) => (
                <tr key={v.id} style={{ borderBottom: i < vendors.length - 1 ? "1px solid #f1f5f9" : "none", opacity: v.isActive ? 1 : 0.45 }}>
                  {editId === v.id ? (
                    <>
                      <td style={{ padding: "8px 16px" }}>
                        <input style={{ ...inputStyle, width: 200 }} value={editData.name ?? v.name} onChange={(e) => setEditData((d) => ({ ...d, name: e.target.value }))} />
                      </td>
                      <td style={{ padding: "8px 16px" }}>
                        <input style={{ ...inputStyle, width: 120 }} value={editData.taxId ?? v.taxId ?? ""} onChange={(e) => setEditData((d) => ({ ...d, taxId: e.target.value }))} />
                      </td>
                      <td style={{ padding: "8px 16px" }}>
                        <input style={{ ...inputStyle, width: 60 }} value={editData.defaultCurrency ?? v.defaultCurrency ?? ""} maxLength={3} onChange={(e) => setEditData((d) => ({ ...d, defaultCurrency: e.target.value.toUpperCase() }))} />
                      </td>
                      <td />
                      <td style={{ padding: "8px 16px", display: "flex", gap: 8 }}>
                        <button onClick={() => saveEdit(v.id)} style={{ ...inputStyle, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer" }}>Save</button>
                        <button onClick={() => setEditId(null)} style={{ ...inputStyle, cursor: "pointer" }}>Cancel</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: "10px 16px", fontWeight: 500 }}>{v.name}</td>
                      <td style={{ padding: "10px 16px", color: "#64748b" }}>{v.taxId ?? "—"}</td>
                      <td style={{ padding: "10px 16px", color: "#64748b" }}>{v.defaultCurrency ?? "—"}</td>
                      <td style={{ padding: "10px 16px" }}>{v.isActive ? "✓" : "—"}</td>
                      <td style={{ padding: "10px 16px", display: "flex", gap: 8 }}>
                        <button onClick={() => { setEditId(v.id); setEditData({}); }} style={{ ...inputStyle, cursor: "pointer", fontSize: 12 }}>Edit</button>
                        <button
                          onClick={() => fetch(`/api/settings/vendors/${v.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !v.isActive }) }).then(load)}
                          style={{ ...inputStyle, cursor: "pointer", fontSize: 12, color: v.isActive ? "#dc2626" : "#16a34a" }}
                        >
                          {v.isActive ? "Deactivate" : "Activate"}
                        </button>
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
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "#374151" }}>Add Vendor</h2>
        <form onSubmit={addVendor} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3 }}>Name *</label>
            <input style={{ ...inputStyle, width: 220 }} value={newName} onChange={(e) => setNewName(e.target.value)} required placeholder="Vendor name" />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3 }}>Tax ID</label>
            <input style={{ ...inputStyle, width: 140 }} value={newTaxId} onChange={(e) => setNewTaxId(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3 }}>Default Currency</label>
            <input style={{ ...inputStyle, width: 70 }} value={newCurrency} onChange={(e) => setNewCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="USD" />
          </div>
          <button type="submit" style={{ ...inputStyle, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}>
            Add Vendor
          </button>
        </form>
        {addError && <div style={{ marginTop: 8, color: "#dc2626", fontSize: 13 }}>{addError}</div>}
      </div>
    </div>
  );
}
