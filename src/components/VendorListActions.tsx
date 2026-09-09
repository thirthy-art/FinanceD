"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/src/i18n/context";
import { buttonVariants } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";

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
  const { t } = useI18n();
  const va = t.vendorActions;
  const cm = t.common;

  const [deleting, setDeleting] = useState(false);

  async function deleteVendor() {
    const confirmMsg = va.permanentDeleteLabel.replace("{name}", vendor.name);
    if (deleting || !window.confirm(confirmMsg)) return;

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
          className={buttonVariants({ variant: "destructive", size: "sm" })}
        >
          {deleting ? cm.deleting : cm.del}
        </button>
      )}
      {vendor.possibleDuplicate && vendor.invoiceCount > 0 && (
        <Link href={`/settings/vendors/${vendor.id}?action=merge#vendor-actions`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "border-[var(--warning-border)] bg-[var(--warning-muted)] text-[var(--warning)]")}>
          {va.mergeResolve}
        </Link>
      )}
    </>
  );
}
