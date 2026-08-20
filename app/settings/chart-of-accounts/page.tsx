"use client";
import { useEffect, useState } from "react";
import { flattenAccountHierarchy } from "@/src/lib/coa-hierarchy";
import { useI18n } from "@/src/i18n/context";

interface Account { id: number; code: string; name: string; type: string; parentId: number | null; isPosting: boolean; isActive: boolean; }

const TYPES = ["asset", "liability", "equity", "revenue", "expense"];
const inputStyle: React.CSSProperties = { padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 13 };
const typeColors: Record<string, React.CSSProperties> = {
  asset:     { background: "#dbeafe", color: "#1d4ed8" },
  liability: { background: "#fce7f3", color: "#9d174d" },
  equity:    { background: "#fef3c7", color: "#92400e" },
  revenue:   { background: "#dcfce7", color: "#15803d" },
  expense:   { background: "#fee2e2", color: "#991b1b" },
};

async function fetchAccounts(): Promise<Account[]> {
  return fetch("/api/settings/chart-of-accounts").then((response) => response.json());
}

export default function ChartOfAccountsPage() {
  const { t } = useI18n();
  const c = t.coa;
  const cm = t.common;

  const typeLabels: Record<string, string> = {
    asset: c.typeAsset,
    liability: c.typeLiability,
    equity: c.typeEquity,
    revenue: c.typeRevenue,
    expense: c.typeExpense,
  };

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("expense");
  const [addError, setAddError] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<Account>>({});

  async function load() {
    const data = await fetchAccounts();
    setAccounts(data);
    setLoading(false);
  }
  useEffect(() => {
    let cancelled = false;
    void fetchAccounts().then((data) => {
      if (!cancelled) {
        setAccounts(data);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    const res = await fetch("/api/settings/chart-of-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: newCode, name: newName, type: newType }),
    });
    if (!res.ok) { setAddError(c.couldNotAdd); return; }
    setNewCode(""); setNewName(""); setNewType("expense");
    load();
  }

  async function saveEdit(id: number) {
    await fetch(`/api/settings/chart-of-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editData),
    });
    setEditId(null);
    load();
  }

  async function deactivate(id: number) {
    await fetch(`/api/settings/chart-of-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    load();
  }

  async function activate(id: number) {
    await fetch(`/api/settings/chart-of-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: true }),
    });
    load();
  }

  if (loading) return <div style={{ color: "#94a3b8" }}>{c.loading}</div>;
  const hierarchicalAccounts = flattenAccountHierarchy(accounts);

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1e3a5f", marginBottom: 24 }}>{c.title}</h1>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", marginBottom: 32 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              {[c.colCode, c.colName, c.colType, c.colPosting, c.colActive, ""].map((h) => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hierarchicalAccounts.map((a, i) => (
              <tr key={a.id} style={{ borderBottom: i < hierarchicalAccounts.length - 1 ? "1px solid #f1f5f9" : "none", opacity: a.isActive ? 1 : 0.45, background: a.isPosting ? "#fff" : "#f8fafc", fontWeight: a.isPosting ? 400 : 600 }}>
                {editId === a.id ? (
                  <>
                    <td style={{ padding: "8px 16px" }}>
                      <input style={{ ...inputStyle, width: 80 }} value={editData.code ?? a.code} onChange={(e) => setEditData((d) => ({ ...d, code: e.target.value }))} />
                    </td>
                    <td style={{ padding: "8px 16px" }}>
                      <input style={{ ...inputStyle, width: 200, marginLeft: a.depth * 18 }} value={editData.name ?? a.name} onChange={(e) => setEditData((d) => ({ ...d, name: e.target.value }))} />
                    </td>
                    <td style={{ padding: "8px 16px" }}>
                      <select style={inputStyle} value={editData.type ?? a.type} onChange={(e) => setEditData((d) => ({ ...d, type: e.target.value }))}>
                        {TYPES.map((type) => <option key={type} value={type}>{typeLabels[type] ?? type}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "8px 16px" }}>{a.isPosting ? c.posting : c.header}</td>
                    <td />
                    <td style={{ padding: "8px 16px", display: "flex", gap: 8 }}>
                      <button onClick={() => saveEdit(a.id)} style={{ ...inputStyle, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer" }}>{cm.save}</button>
                      <button onClick={() => setEditId(null)} style={{ ...inputStyle, cursor: "pointer" }}>{cm.cancel}</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: "10px 16px", fontFamily: "monospace", fontWeight: 600 }}>{a.code}</td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ display: "inline-block", paddingLeft: a.depth * 18 }}>{a.name}</span>
                      {!a.isPosting && <span style={{ marginLeft: 8, padding: "2px 7px", borderRadius: 10, background: "#e2e8f0", color: "#475569", fontSize: 10 }}>{c.nonPostingHeader}</span>}
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, ...typeColors[a.type] }}>{typeLabels[a.type] ?? a.type}</span>
                    </td>
                    <td style={{ padding: "10px 16px" }}>{a.isPosting ? c.postingYes : c.postingNo}</td>
                    <td style={{ padding: "10px 16px" }}>{a.isActive ? "✓" : "—"}</td>
                    <td style={{ padding: "10px 16px", display: "flex", gap: 8 }}>
                      <button onClick={() => { setEditId(a.id); setEditData({}); }} style={{ ...inputStyle, cursor: "pointer", fontSize: 12 }}>{cm.edit}</button>
                      {a.isActive
                        ? <button onClick={() => deactivate(a.id)} style={{ ...inputStyle, cursor: "pointer", fontSize: 12, color: "#dc2626" }}>{cm.deactivate}</button>
                        : <button onClick={() => activate(a.id)} style={{ ...inputStyle, cursor: "pointer", fontSize: 12, color: "#16a34a" }}>{cm.activate}</button>
                      }
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "#374151" }}>{c.addAccount}</h2>
        <form onSubmit={addAccount} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3 }}>{c.colCode}</label>
            <input style={{ ...inputStyle, width: 80 }} value={newCode} onChange={(e) => setNewCode(e.target.value)} required placeholder={c.codePlaceholder} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3 }}>{c.colName}</label>
            <input style={{ ...inputStyle, width: 220 }} value={newName} onChange={(e) => setNewName(e.target.value)} required placeholder={c.namePlaceholder} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3 }}>{c.colType}</label>
            <select style={inputStyle} value={newType} onChange={(e) => setNewType(e.target.value)}>
              {TYPES.map((type) => <option key={type} value={type}>{typeLabels[type] ?? type}</option>)}
            </select>
          </div>
          <button type="submit" style={{ ...inputStyle, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}>
            {c.addAccount}
          </button>
        </form>
        {addError && <div style={{ marginTop: 8, color: "#dc2626", fontSize: 13 }}>{addError}</div>}
      </div>
    </div>
  );
}
