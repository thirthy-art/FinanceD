"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/i18n/context";
import { Button } from "@/src/components/ui/button";
import { Alert } from "@/src/components/ui/feedback";
import { Select } from "@/src/components/ui/select";

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
    <div id="vendor-actions" className="vendor-actions">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => { setMode("merge"); setError(""); }}>{va.mergeVendor}</Button>
        <Button variant="destructive" onClick={() => { setMode("delete"); setError(""); }}>{va.deleteVendor}</Button>
      </div>

      {mode === "delete" && (
        <div role="dialog" aria-modal="true" className="vendor-action-panel">
          <strong>{va.deleteTitle.replace("{name}", source.name)}</strong>
          <p style={{ margin: "8px 0" }}>{va.deleteDesc}</p>
          <p style={{ margin: "8px 0", color: source.invoiceCount > 0 ? "#b91c1c" : "#475569" }}>
            {va.associatedInvoices.replace("{count}", String(source.invoiceCount))}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" disabled={busy} onClick={deleteVendor}>
              {busy ? va.deleting : va.confirmDeletion}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setMode("idle")}>{cm.cancel}</Button>
          </div>
        </div>
      )}

      {mode === "merge" && (
        <div role="dialog" aria-modal="true" className="vendor-action-panel">
          <strong>{va.mergeDuplicate}</strong>
          <p style={{ margin: "8px 0" }}>
            {va.mergeSource
              .replace("{name}", source.name)
              .replace("{count}", String(source.invoiceCount))
              .replace("{taxId}", source.taxId ?? cm.none)}
          </p>
          <label className="ui-label mb-2">
            {va.vendorToKeep}
            <Select className="mt-1 max-w-lg" value={targetId} onChange={(event) => { setTargetId(event.target.value); setMergeReviewed(false); }}>
              <option value="">{va.selectTarget}</option>
              {targets.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} · {candidate.invoiceCount} invoice(s) · {candidate.taxId ?? "No Tax ID"}
                </option>
              ))}
            </Select>
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
          <div className="flex flex-wrap gap-2">
            {!mergeReviewed ? (
              <Button disabled={!target} onClick={() => setMergeReviewed(true)}>{va.reviewMerge}</Button>
            ) : (
              <Button className="bg-[var(--warning)] hover:bg-[var(--warning)]" disabled={busy || !target} onClick={mergeVendor}>
                {busy ? va.merging : va.confirmMerge}
              </Button>
            )}
            <Button variant="secondary" disabled={busy} onClick={() => setMode("idle")}>{cm.cancel}</Button>
          </div>
        </div>
      )}
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
    </div>
  );
}
