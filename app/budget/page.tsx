"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useI18n } from "@/src/i18n/context";

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid #e2e8f0",
  borderRadius: 5,
  fontSize: 13,
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  overflow: "hidden",
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Category {
  id: number;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

interface MonthData {
  budget: string;
  invoiceActual: string;
  manualActual: string;
  actual: string;
  variance: string;
}

interface ReportCategory {
  id: number;
  name: string;
  isActive: boolean;
  months: Record<string, MonthData>;
}

interface Report {
  categories: ReportCategory[];
  months: string[];
  baseCurrency: string;
  unmappedCount: number;
}

interface AccountMapping {
  id: number;
  accountId: number;
  accountCode: string;
  accountName: string;
}

interface CoaAccount {
  id: number;
  code: string;
  name: string;
  type: string;
  isPosting: boolean;
  isActive: boolean;
}

interface ManualEntry {
  id: number;
  budgetCategoryId: number;
  month: string;
  amount: string;
  description: string | null;
  source: string;
}

type Tab = "budget" | "categories" | "actuals";

function fmt(v: string | undefined | null): string {
  if (!v || v === "0.00" || v === "0") return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function varColor(v: string): string {
  const n = parseFloat(v);
  if (isNaN(n) || n === 0) return "#374151";
  return n > 0 ? "#15803d" : "#dc2626";
}

export default function BudgetPage() {
  const { t } = useI18n();
  const b = t.budget;
  const cm = t.common;

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [tab, setTab] = useState<Tab>("budget");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [unmapped, setUnmapped] = useState<{ unmappedCount: number; accounts: { code: string; name: string; count: number }[] } | null>(null);
  const [manualActuals, setManualActuals] = useState<ManualEntry[]>([]);

  // Category management state
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);
  const [catMappings, setCatMappings] = useState<AccountMapping[]>([]);
  const [coaAccounts, setCoaAccounts] = useState<CoaAccount[]>([]);
  const [newCatName, setNewCatName] = useState("");
  const [catError, setCatError] = useState("");
  const [mappingAccountId, setMappingAccountId] = useState("");
  const [mappingError, setMappingError] = useState("");
  const [renamingCatId, setRenamingCatId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");

  // Inline budget editing state
  const [editingCell, setEditingCell] = useState<{ catId: number; month: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  // Manual actual form state
  const [newActual, setNewActual] = useState({ budgetCategoryId: "", month: "", amount: "", description: "" });
  const [actualError, setActualError] = useState("");

  const loadReport = useCallback(async () => {
    setLoading(true);
    const [rep, cats, unm] = await Promise.all([
      fetch(`/api/budget/report?year=${year}`).then((r) => r.json()),
      fetch("/api/budget/categories").then((r) => r.json()),
      fetch(`/api/budget/unmapped?year=${year}`).then((r) => r.json()),
    ]);
    setReport(rep);
    setCategories(cats);
    setUnmapped(unm);
    setLoading(false);
  }, [year]);

  const loadManualActuals = useCallback(async () => {
    const data = await fetch(`/api/budget/actuals?year=${year}`).then((r) => r.json());
    setManualActuals(Array.isArray(data) ? data : []);
  }, [year]);

  useEffect(() => {
    void loadReport();
    void loadManualActuals();
  }, [loadReport, loadManualActuals]);

  useEffect(() => {
    if (editingCell && editRef.current) editRef.current.focus();
  }, [editingCell]);

  async function seedCategories() {
    await fetch("/api/budget/seed-categories", { method: "POST" });
    await loadReport();
  }

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    setCatError("");
    const res = await fetch("/api/budget/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCatName }),
    });
    if (!res.ok) { setCatError(b.couldNotCreate); return; }
    setNewCatName("");
    await loadReport();
  }

  async function toggleCatActive(cat: Category) {
    await fetch(`/api/budget/categories/${cat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !cat.isActive }),
    });
    await loadReport();
  }

  function startRename(cat: Category) {
    setRenamingCatId(cat.id);
    setRenameValue(cat.name);
    setRenameError("");
  }

  async function saveRename(catId: number) {
    setRenameError("");
    const name = renameValue.trim();
    if (!name) { setRenameError(b.nameCannotBeEmpty); return; }
    const res = await fetch(`/api/budget/categories/${catId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setRenameError(body.error ?? b.couldNotRename);
      return;
    }
    setRenamingCatId(null);
    await loadReport();
  }

  async function loadCatMappings(catId: number) {
    setSelectedCatId(catId);
    const [maps, coa] = await Promise.all([
      fetch(`/api/budget/categories/${catId}/accounts`).then((r) => r.json()),
      fetch("/api/settings/chart-of-accounts").then((r) => r.json()),
    ]);
    setCatMappings(Array.isArray(maps) ? maps : []);
    setCoaAccounts(Array.isArray(coa) ? coa.filter((a: CoaAccount) => a.type === "expense" && a.isPosting && a.isActive) : []);
    setMappingAccountId("");
    setMappingError("");
  }

  async function addMapping(e: React.FormEvent) {
    e.preventDefault();
    setMappingError("");
    const accountId = parseInt(mappingAccountId, 10);
    if (isNaN(accountId)) { setMappingError(b.selectAccount); return; }
    const res = await fetch(`/api/budget/categories/${selectedCatId}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    if (!res.ok) {
      const err = await res.json();
      setMappingError(err.error ?? b.couldNotMap);
      return;
    }
    await loadCatMappings(selectedCatId!);
  }

  async function removeMapping(accountId: number) {
    await fetch(`/api/budget/categories/${selectedCatId}/accounts?accountId=${accountId}`, { method: "DELETE" });
    await loadCatMappings(selectedCatId!);
  }

  async function saveBudgetCell(catId: number, month: string, value: string) {
    const amount = value.trim() === "" ? "0" : value.trim();
    await fetch("/api/budget/entries", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetCategoryId: catId, month, amount }),
    });
    setEditingCell(null);
    await loadReport();
  }

  async function addManualActual(e: React.FormEvent) {
    e.preventDefault();
    setActualError("");
    const catId = parseInt(newActual.budgetCategoryId, 10);
    if (isNaN(catId)) { setActualError(b.selectCategoryRequired); return; }
    if (!newActual.month || !newActual.amount) { setActualError(b.monthAmountRequired); return; }
    const res = await fetch("/api/budget/actuals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        budgetCategoryId: catId,
        month: newActual.month,
        amount: newActual.amount,
        description: newActual.description || undefined,
      }),
    });
    if (!res.ok) { const e2 = await res.json(); setActualError(e2.error ?? "Error"); return; }
    setNewActual({ budgetCategoryId: "", month: "", amount: "", description: "" });
    await loadReport();
    await loadManualActuals();
  }

  async function deleteManualActual(id: number) {
    await fetch(`/api/budget/actuals?id=${id}`, { method: "DELETE" });
    await loadReport();
    await loadManualActuals();
  }

  const allMonths: string[] = report?.months ?? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

  const tabs: [Tab, string][] = [
    ["budget", b.tabBudget],
    ["categories", b.tabCategories],
    ["actuals", b.tabActuals],
  ];

  return (
    <div style={{ maxWidth: 1400 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1e3a5f", margin: 0 }}>{b.title}</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setYear((y) => y - 1)} style={{ ...inputStyle, cursor: "pointer", background: "#f8fafc" }}>‹</button>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#374151", minWidth: 48, textAlign: "center" }}>{year}</span>
          <button onClick={() => setYear((y) => y + 1)} style={{ ...inputStyle, cursor: "pointer", background: "#f8fafc" }}>›</button>
        </div>
        {report?.baseCurrency && (
          <span style={{ fontSize: 12, color: "#64748b", background: "#f1f5f9", padding: "3px 8px", borderRadius: 4 }}>
            {report.baseCurrency}
          </span>
        )}
        {unmapped && unmapped.unmappedCount > 0 && (
          <span style={{ fontSize: 12, color: "#b45309", background: "#fef3c7", padding: "4px 10px", borderRadius: 4 }}>
            ⚠ {b.unmappedWarning.replace("{count}", String(unmapped.unmappedCount)).replace("{s}", unmapped.unmappedCount !== 1 ? "s" : "")}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #e2e8f0" }}>
        {tabs.map(([tabId, label]) => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: tab === tabId ? 600 : 400,
              color: tab === tabId ? "#1e3a5f" : "#64748b",
              background: "transparent",
              border: "none",
              borderBottom: tab === tabId ? "2px solid #1e3a5f" : "2px solid transparent",
              cursor: "pointer",
              marginBottom: -2,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ─── TAB: Budget & Actuals ─────────────────────────────────────── */}
      {tab === "budget" && (
        <>
          {loading ? (
            <p style={{ color: "#64748b" }}>{b.loading}</p>
          ) : !report || !report.categories.length ? (
            <div style={{ ...cardStyle, padding: 32, textAlign: "center" }}>
              <p style={{ color: "#64748b", marginBottom: 16 }}>{b.noCategories}</p>
              <button
                onClick={seedCategories}
                style={{ ...inputStyle, cursor: "pointer", background: "#2563eb", color: "#fff", fontWeight: 600, border: "none" }}
              >
                {b.createStarter}
              </button>
              <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 8 }}>{b.createStarterHint}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", minWidth: 900, width: "100%" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", minWidth: 160, position: "sticky", left: 0, background: "#f8fafc", zIndex: 1 }}>{b.categoryHeader}</th>
                    {allMonths.map((m, i) => (
                      <th key={m} style={{ textAlign: "right", padding: "8px 6px", fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", minWidth: 80 }}>
                        {MONTHS_SHORT[i]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.categories.map((cat) => (
                    <tr key={cat.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "6px 12px", fontSize: 13, fontWeight: 500, color: "#1e3a5f", position: "sticky", left: 0, background: "#fff", zIndex: 1, borderRight: "1px solid #e2e8f0" }}>
                        {cat.name}
                      </td>
                      {allMonths.map((month) => {
                        const data = cat.months[month];
                        const isEditing = editingCell?.catId === cat.id && editingCell?.month === month;
                        const budgetVal = data?.budget ?? "0.00";
                        return (
                          <td key={month} style={{ padding: "4px 6px", verticalAlign: "top", minWidth: 80 }}>
                            {isEditing ? (
                              <input
                                ref={editRef}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => saveBudgetCell(cat.id, month, editValue)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveBudgetCell(cat.id, month, editValue);
                                  if (e.key === "Escape") setEditingCell(null);
                                }}
                                style={{ width: "100%", padding: "2px 4px", fontSize: 12, border: "1px solid #2563eb", borderRadius: 3, textAlign: "right", outline: "2px solid #93c5fd" }}
                              />
                            ) : (
                              <div
                                onClick={() => { setEditingCell({ catId: cat.id, month }); setEditValue(budgetVal === "0.00" ? "" : budgetVal); }}
                                title={b.clickToEdit}
                                style={{ fontSize: 12, color: "#374151", textAlign: "right", cursor: "pointer", padding: "2px 0", borderRadius: 2 }}
                              >
                                {fmt(budgetVal)}
                              </div>
                            )}
                            <div style={{ fontSize: 11, color: "#6b7280", textAlign: "right", marginTop: 1 }}>
                              {fmt(data?.actual)}
                            </div>
                            <div style={{ fontSize: 11, textAlign: "right", color: varColor(data?.variance ?? "0"), marginTop: 1 }}>
                              {data?.variance && parseFloat(data.variance) !== 0 ? fmt(data.variance) : ""}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 10, padding: "4px 12px", fontSize: 11, color: "#94a3b8" }}>
                {b.clickToEdit}
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── TAB: Categories & Accounts ───────────────────────────────── */}
      {tab === "categories" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Left: category list */}
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: "#374151", marginBottom: 12 }}>{b.budgetCategoriesTitle}</h2>
            {!categories.length ? (
              <div style={{ ...cardStyle, padding: 20 }}>
                <p style={{ color: "#64748b", marginBottom: 12 }}>{b.noCategoriesYet}</p>
                <button
                  onClick={seedCategories}
                  style={{ ...inputStyle, cursor: "pointer", background: "#2563eb", color: "#fff", fontWeight: 600, border: "none" }}
                >
                  {b.createStarter}
                </button>
              </div>
            ) : (
              <div style={cardStyle}>
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    style={{
                      borderBottom: "1px solid #f1f5f9",
                      background: selectedCatId === cat.id ? "#eff6ff" : "transparent",
                    }}
                  >
                    {renamingCatId === cat.id ? (
                      <div style={{ padding: "8px 14px" }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveRename(cat.id);
                              if (e.key === "Escape") setRenamingCatId(null);
                            }}
                            style={{ ...inputStyle, flex: 1 }}
                          />
                          <button
                            onClick={() => void saveRename(cat.id)}
                            style={{ fontSize: 12, color: "#fff", background: "#2563eb", border: "none", borderRadius: 4, padding: "5px 10px", cursor: "pointer", fontWeight: 600 }}
                          >
                            {cm.save}
                          </button>
                          <button
                            onClick={() => setRenamingCatId(null)}
                            style={{ fontSize: 12, color: "#64748b", background: "transparent", border: "none", cursor: "pointer" }}
                          >
                            {cm.cancel}
                          </button>
                        </div>
                        {renameError && <p style={{ color: "#dc2626", fontSize: 12, margin: "4px 0 0" }}>{renameError}</p>}
                      </div>
                    ) : (
                      <div
                        onClick={() => loadCatMappings(cat.id)}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", cursor: "pointer" }}
                      >
                        <span style={{ fontSize: 13, color: cat.isActive ? "#1e293b" : "#94a3b8", fontWeight: selectedCatId === cat.id ? 600 : 400, flex: 1 }}>
                          {cat.name}
                        </span>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); startRename(cat); }}
                            style={{ fontSize: 11, color: "#2563eb", background: "transparent", border: "none", cursor: "pointer" }}
                          >
                            {cm.rename}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleCatActive(cat); }}
                            style={{ fontSize: 11, color: cat.isActive ? "#dc2626" : "#15803d", background: "transparent", border: "none", cursor: "pointer" }}
                          >
                            {cat.isActive ? cm.deactivate : cm.activate}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add category form */}
            <form onSubmit={createCategory} style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 8 }}>{b.newCategoryTitle}</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder={b.categoryNamePlaceholder}
                  style={{ ...inputStyle, flex: 1 }}
                  required
                />
                <button type="submit" style={{ ...inputStyle, background: "#2563eb", color: "#fff", fontWeight: 600, border: "none", cursor: "pointer" }}>
                  {cm.add}
                </button>
              </div>
              {catError && <p style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>{catError}</p>}
            </form>
          </div>

          {/* Right: account mappings for selected category */}
          <div>
            {selectedCatId !== null && categories.find((c) => c.id === selectedCatId) ? (
              <>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: "#374151", marginBottom: 12 }}>
                  {b.expenseAccountsFor.replace("{name}", categories.find((c) => c.id === selectedCatId)?.name ?? "")}
                </h2>
                <div style={cardStyle}>
                  {catMappings.length === 0 ? (
                    <p style={{ padding: "14px", color: "#94a3b8", fontSize: 13 }}>{b.noAccountsMapped}</p>
                  ) : (
                    catMappings.map((m) => (
                      <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderBottom: "1px solid #f1f5f9" }}>
                        <span style={{ fontSize: 13 }}>
                          <span style={{ color: "#64748b", fontFamily: "monospace" }}>{m.accountCode}</span>
                          {" "}
                          <span style={{ color: "#374151" }}>{m.accountName}</span>
                        </span>
                        <button
                          onClick={() => removeMapping(m.accountId)}
                          style={{ fontSize: 11, color: "#dc2626", background: "transparent", border: "none", cursor: "pointer" }}
                        >
                          {cm.remove}
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={addMapping} style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select
                      value={mappingAccountId}
                      onChange={(e) => setMappingAccountId(e.target.value)}
                      style={{ ...inputStyle, flex: 1 }}
                    >
                      <option value="">{b.selectExpenseAccount}</option>
                      {coaAccounts
                        .filter((a) => !catMappings.some((m) => m.accountId === a.id))
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} – {a.name}
                          </option>
                        ))}
                    </select>
                    <button type="submit" style={{ ...inputStyle, background: "#2563eb", color: "#fff", fontWeight: 600, border: "none", cursor: "pointer" }}>
                      {cm.map}
                    </button>
                  </div>
                  {mappingError && <p style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>{mappingError}</p>}
                </form>

                {unmapped && unmapped.unmappedCount > 0 && (
                  <div style={{ marginTop: 16, padding: "10px 14px", background: "#fef3c7", borderRadius: 6, fontSize: 12 }}>
                    <strong style={{ color: "#92400e" }}>{b.unmappedAccountsTitle}</strong>
                    {unmapped.accounts.map((a, i) => (
                      <div key={i} style={{ color: "#78350f", marginTop: 4 }}>
                        <span style={{ fontFamily: "monospace" }}>{a.code}</span> – {a.name} ({a.count} line{a.count !== 1 ? "s" : ""})
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: "#94a3b8", fontSize: 13, padding: 20 }}>
                {b.selectCategoryHint}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB: Manual Entries ──────────────────────────────────────── */}
      {tab === "actuals" && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "#374151", marginBottom: 12 }}>
            {b.manualEntriesTitle.replace("{year}", String(year))}
          </h2>
          <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>
            {b.manualEntriesDesc}
          </p>

          {/* Add form */}
          <div style={{ ...cardStyle, padding: 20, marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 12 }}>{b.addEntryTitle}</h3>
            <form onSubmit={addManualActual}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
                <div>
                  <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>{b.categoryLabel}</label>
                  <select
                    value={newActual.budgetCategoryId}
                    onChange={(e) => setNewActual((p) => ({ ...p, budgetCategoryId: e.target.value }))}
                    style={{ ...inputStyle, minWidth: 180 }}
                    required
                  >
                    <option value="">{cm.selectNone}</option>
                    {categories.filter((c) => c.isActive).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>{b.monthLabel}</label>
                  <input
                    type="month"
                    value={newActual.month}
                    onChange={(e) => setNewActual((p) => ({ ...p, month: e.target.value }))}
                    style={inputStyle}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>
                    {b.amountLabel.replace("{currency}", report?.baseCurrency ?? "")}
                  </label>
                  <input
                    type="text"
                    placeholder="0.00"
                    value={newActual.amount}
                    onChange={(e) => setNewActual((p) => ({ ...p, amount: e.target.value }))}
                    style={{ ...inputStyle, width: 100, textAlign: "right" }}
                    required
                  />
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>{b.descriptionLabel}</label>
                  <input
                    type="text"
                    placeholder="e.g. Payroll Aug 2026"
                    value={newActual.description}
                    onChange={(e) => setNewActual((p) => ({ ...p, description: e.target.value }))}
                    style={{ ...inputStyle, width: "100%" }}
                  />
                </div>
                <button type="submit" style={{ ...inputStyle, background: "#2563eb", color: "#fff", fontWeight: 600, border: "none", cursor: "pointer" }}>
                  {cm.add}
                </button>
              </div>
              {actualError && <p style={{ color: "#dc2626", fontSize: 12, marginTop: 6 }}>{actualError}</p>}
            </form>
          </div>

          {/* Entries list */}
          <div style={cardStyle}>
            {manualActuals.filter((e) => e.month.startsWith(String(year))).length === 0 ? (
              <p style={{ padding: 20, color: "#94a3b8", fontSize: 13 }}>
                {b.noManualEntries.replace("{year}", String(year))}
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>{b.colMonth}</th>
                    <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>{b.colCategory}</th>
                    <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>{b.colDescription}</th>
                    <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>{b.colSource}</th>
                    <th style={{ textAlign: "right", padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>{b.colAmount}</th>
                    <th style={{ width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {manualActuals
                    .filter((e) => e.month.startsWith(String(year)))
                    .sort((a, b) => a.month.localeCompare(b.month))
                    .map((entry) => {
                      const cat = categories.find((c) => c.id === entry.budgetCategoryId);
                      return (
                        <tr key={entry.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "8px 12px", fontSize: 13, color: "#374151" }}>{entry.month}</td>
                          <td style={{ padding: "8px 12px", fontSize: 13, color: "#374151" }}>{cat?.name ?? entry.budgetCategoryId}</td>
                          <td style={{ padding: "8px 12px", fontSize: 13, color: "#374151" }}>{entry.description ?? "—"}</td>
                          <td style={{ padding: "8px 12px", fontSize: 12, color: "#64748b" }}>{entry.source}</td>
                          <td style={{ padding: "8px 12px", fontSize: 13, color: "#374151", textAlign: "right", fontFamily: "monospace" }}>
                            {fmt(entry.amount)}
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            <button
                              onClick={() => deleteManualActual(entry.id)}
                              style={{ fontSize: 11, color: "#dc2626", background: "transparent", border: "none", cursor: "pointer" }}
                            >
                              {cm.del}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
