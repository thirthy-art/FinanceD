"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/i18n/context";

interface VendorSummary {
  id: number;
  name: string;
  taxId: string | null;
  invoiceCount: number;
}

export default function VendorActions({
  source,
  targets,
  initialMode = "idle",
}: {
  source: VendorSummary;
  targets: VendorSummary[];
  initialMode?: "idle" | "merge";
}) {
  const { t } = useI18n();
  const va = t.vendorActions;
  const cm = t.common;

  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "delete" | "merge">(initialMode);
  const [targetId, setTargetId] = useState("");
  const [mergeReviewed, setMergeReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const target = useMemo(() => targets.find((candidate) => String(candidate.id) === targetId), [targetId, targets]);

  async function deleteVendor() {
    if (busy) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/settings/vendors/${source.id}`, { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Vendor deletion failed.");
      setBusy(false);
      return;
    }
    router.push("/settings/vendors?action=deleted");
    router.refresh();
  }

  async function mergeVendor() {
    if (busy || !target) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/settings/vendors/${source.id}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetVendorId: target.id }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Vendor merge failed.");
      setBusy(false);
      return;
    }
    router.push("/settings/vendors?action=merged");
    router.refresh();
  }

  return (
    <div id="vendor-actions" style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #e2e8f0" }}>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => { setMode("merge"); setError(""); }} style={buttonStyle}>{va.mergeVendor}</button>
        <button onClick={() => { setMode("delete"); setError(""); }} style={{ ...buttonStyle, color: "#fff", background: "#dc2626", borderColor: "#dc2626" }}>{va.deleteVendor}</button>
      </div>

      {mode === "delete" && (
        <div role="dialog" aria-modal="true" style={dialogStyle}>
          <strong>{va.deleteTitle.replace("{name}", source.name)}</strong>
          <p style={{ margin: "8px 0" }}>{va.deleteDesc}</p>
          <p style={{ margin: "8px 0", color: source.invoiceCount > 0 ? "#b91c1c" : "#475569" }}>
            {va.associatedInvoices.replace("{count}", String(source.invoiceCount))}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button disabled={busy} onClick={deleteVendor} style={{ ...buttonStyle, color: "#fff", background: "#dc2626", borderColor: "#dc2626" }}>
              {busy ? va.deleting : va.confirmDeletion}
            </button>
            <button disabled={busy} onClick={() => setMode("idle")} style={buttonStyle}>{cm.cancel}</button>
          </div>
        </div>
      )}

      {mode === "merge" && (
        <div role="dialog" aria-modal="true" style={dialogStyle}>
          <strong>{va.mergeDuplicate}</strong>
          <p style={{ margin: "8px 0" }}>
            {va.mergeSource
              .replace("{name}", source.name)
              .replace("{count}", String(source.invoiceCount))
              .replace("{taxId}", source.taxId ?? cm.none)}
          </p>
          <label style={{ display: "block", marginBottom: 8 }}>
            {va.vendorToKeep}
            <select value={targetId} onChange={(event) => { setTargetId(event.target.value); setMergeReviewed(false); }} style={{ display: "block", marginTop: 4, padding: 7, minWidth: 280 }}>
              <option value="">{va.selectTarget}</option>
              {targets.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} · {candidate.invoiceCount} invoice(s) · {candidate.taxId ?? "No Tax ID"}
                </option>
              ))}
            </select>
          </label>
          {target && (
            <p style={{ margin: "8px 0" }}>
              {va.mergeTarget
                .replace("{name}", target.name)
                .replace("{count}", String(target.invoiceCount))
                .replace("{taxId}", target.taxId ?? cm.none)}
            </p>
          )}
          <p style={{ margin: "8px 0", color: "#475569" }}>{va.mergeDesc}</p>
          <div style={{ display: "flex", gap: 8 }}>
            {!mergeReviewed ? (
              <button disabled={!target} onClick={() => setMergeReviewed(true)} style={buttonStyle}>{va.reviewMerge}</button>
            ) : (
              <button disabled={busy || !target} onClick={mergeVendor} style={{ ...buttonStyle, color: "#fff", background: "#b45309", borderColor: "#b45309" }}>
                {busy ? va.merging : va.confirmMerge}
              </button>
            )}
            <button disabled={busy} onClick={() => setMode("idle")} style={buttonStyle}>{cm.cancel}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" style={{ color: "#b91c1c", marginTop: 10 }}>{error}</p>}
    </div>
  );
}

const buttonStyle: React.CSSProperties = { padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", cursor: "pointer", fontWeight: 600 };
const dialogStyle: React.CSSProperties = { marginTop: 14, maxWidth: 620, padding: 16, border: "1px solid #cbd5e1", borderRadius: 8, background: "#f8fafc" };
