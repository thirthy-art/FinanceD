"use client";
import { useEffect, useState } from "react";

interface Account { id: number; code: string; name: string; type: string; isActive: boolean; }

const TYPES = ["asset", "liability", "equity", "revenue", "expense"];
const inputStyle: React.CSSProperties = { padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 13 };
const typeColors: Record<string, React.CSSProperties> = {
  asset:     { background: "#dbeafe", color: "#1d4ed8" },
  liability: { background: "#fce7f3", color: "#9d174d" },
  equity:    { background: "#fef3c7", color: "#92400e" },
  revenue:   { background: "#dcfce7", color: "#15803d" },
  expense:   { background: "#fee2e2", color: "#991b1b" },
};

export default function ChartOfAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("expense");
  const [addError, setAddError] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<Account>>({});

  async function load() {
    const data = await fetch("/api/settings/chart-of-accounts").then((r) => r.json());
    setAccounts(data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    const res = await fetch("/api/settings/chart-of-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: newCode, name: newName, type: newType }),
    });
    if (!res.ok) { setAddError("Could not add account."); return; }
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

  if (loading) return <div style={{ color: "#94a3b8" }}>Loading…</div>;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1e3a5f", marginBottom: 24 }}>Chart of Accounts</h1>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", marginBottom: 32 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              {["Code", "Name", "Type", "Active", ""].map((h) => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.map((a, i) => (
              <tr key={a.id} style={{ borderBottom: i < accounts.length - 1 ? "1px solid #f1f5f9" : "none", opacity: a.isActive ? 1 : 0.45 }}>
                {editId === a.id ? (
                  <>
                    <td style={{ padding: "8px 16px" }}>
                      <input style={{ ...inputStyle, width: 80 }} value={editData.code ?? a.code} onChange={(e) => setEditData((d) => ({ ...d, code: e.target.value }))} />
                    </td>
                    <td style={{ padding: "8px 16px" }}>
                      <input style={{ ...inputStyle, width: 200 }} value={editData.name ?? a.name} onChange={(e) => setEditData((d) => ({ ...d, name: e.target.value }))} />
                    </td>
                    <td style={{ padding: "8px 16px" }}>
                      <select style={inputStyle} value={editData.type ?? a.type} onChange={(e) => setEditData((d) => ({ ...d, type: e.target.value }))}>
                        {TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td />
                    <td style={{ padding: "8px 16px", display: "flex", gap: 8 }}>
                      <button onClick={() => saveEdit(a.id)} style={{ ...inputStyle, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer" }}>Save</button>
                      <button onClick={() => setEditId(null)} style={{ ...inputStyle, cursor: "pointer" }}>Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: "10px 16px", fontFamily: "monospace", fontWeight: 600 }}>{a.code}</td>
                    <td style={{ padding: "10px 16px" }}>{a.name}</td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, ...typeColors[a.type] }}>{a.type}</span>
                    </td>
                    <td style={{ padding: "10px 16px" }}>{a.isActive ? "✓" : "—"}</td>
                    <td style={{ padding: "10px 16px", display: "flex", gap: 8 }}>
                      <button onClick={() => { setEditId(a.id); setEditData({}); }} style={{ ...inputStyle, cursor: "pointer", fontSize: 12 }}>Edit</button>
                      {a.isActive
                        ? <button onClick={() => deactivate(a.id)} style={{ ...inputStyle, cursor: "pointer", fontSize: 12, color: "#dc2626" }}>Deactivate</button>
                        : <button onClick={() => activate(a.id)} style={{ ...inputStyle, cursor: "pointer", fontSize: 12, color: "#16a34a" }}>Activate</button>
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
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "#374151" }}>Add Account</h2>
        <form onSubmit={addAccount} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3 }}>Code</label>
            <input style={{ ...inputStyle, width: 80 }} value={newCode} onChange={(e) => setNewCode(e.target.value)} required placeholder="5100" />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3 }}>Name</label>
            <input style={{ ...inputStyle, width: 220 }} value={newName} onChange={(e) => setNewName(e.target.value)} required placeholder="Account name" />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 3 }}>Type</label>
            <select style={inputStyle} value={newType} onChange={(e) => setNewType(e.target.value)}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <button type="submit" style={{ ...inputStyle, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}>
            Add Account
          </button>
        </form>
        {addError && <div style={{ marginTop: 8, color: "#dc2626", fontSize: 13 }}>{addError}</div>}
      </div>
    </div>
  );
}
