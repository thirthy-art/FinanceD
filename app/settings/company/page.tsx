"use client";
import { useEffect, useState } from "react";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0",
  borderRadius: 6, fontSize: 14, background: "#fff",
};

const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "CAD", "AUD", "JPY", "SEK", "NOK", "DKK", "RON"];

export default function CompanyPage() {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/company")
      .then((r) => r.json())
      .then((d) => { setName(d.name); setCurrency(d.baseCurrency); setLoading(false); });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch("/api/settings/company", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, baseCurrency: currency }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
    } catch { setError("Could not save. Please try again."); }
    finally { setSaving(false); }
  }

  if (loading) return <div style={{ color: "#94a3b8" }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1e3a5f", marginBottom: 24 }}>Company Settings</h1>
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 24 }}>
        <form onSubmit={save}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>COMPANY NAME</label>
            <input style={inputStyle} value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} required />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>BASE CURRENCY</label>
            <select style={inputStyle} value={currency} onChange={(e) => { setCurrency(e.target.value); setSaved(false); }}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          {error && <div style={{ marginBottom: 12, padding: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#dc2626", fontSize: 13 }}>{error}</div>}
          {saved && <div style={{ marginBottom: 12, padding: 10, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#16a34a", fontSize: 13 }}>✓ Saved</div>}
          <button
            type="submit"
            disabled={saving}
            style={{ padding: "10px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 14 }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      </div>
    </div>
  );
}
