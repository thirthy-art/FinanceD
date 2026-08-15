"use client";

import Link from "next/link";
import { useState } from "react";

interface VendorListActionsProps {
  vendor: {
    id: number;
    name: string;
    invoiceCount: number;
    possibleDuplicate: boolean;
  };
  onDeleted: () => void | Promise<void>;
  onError: (message: string) => void;
}

export default function VendorListActions({ vendor, onDeleted, onError }: VendorListActionsProps) {
  const [deleting, setDeleting] = useState(false);

  async function deleteVendor() {
    if (deleting || !window.confirm(`Permanently delete ${vendor.name}? This action cannot be undone.`)) return;

    setDeleting(true);
    onError("");
    try {
      const response = await fetch(`/api/settings/vendors/${vendor.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        onError(result.error ?? "Vendor deletion failed.");
        return;
      }
      await onDeleted();
    } catch {
      onError("Vendor deletion failed.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {vendor.invoiceCount === 0 && (
        <button
          type="button"
          disabled={deleting}
          onClick={deleteVendor}
          style={{ ...actionStyle, color: "#fff", background: "#dc2626", borderColor: "#dc2626", opacity: deleting ? 0.6 : 1 }}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      )}
      {vendor.possibleDuplicate && vendor.invoiceCount > 0 && (
        <Link href={`/settings/vendors/${vendor.id}?action=merge#vendor-actions`} style={{ ...actionStyle, color: "#92400e", background: "#fffbeb", borderColor: "#fbbf24", textDecoration: "none" }}>
          Merge / resolve duplicate
        </Link>
      )}
    </>
  );
}

const actionStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 8px",
  border: "1px solid #cbd5e1",
  borderRadius: 5,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};
