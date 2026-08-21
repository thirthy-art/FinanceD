"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/i18n/context";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/tiff", "image/webp"];

export default function NewInvoiceUploadButton({ label }: { label: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlightRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    if (inFlightRef.current) return;
    setError("");

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(t.newInvoice.unsupportedType);
      return;
    }

    inFlightRef.current = true;
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("requestId", crypto.randomUUID());

      const response = await fetch("/api/invoices/upload", { method: "POST", body: formData });
      const result = await response.json().catch(() => ({})) as { error?: unknown; invoiceId?: unknown };

      if (!response.ok) {
        throw new Error(typeof result.error === "string" ? result.error : "Upload failed. Please retry.");
      }
      if (typeof result.invoiceId !== "number") {
        throw new Error(t.newInvoice.uploadWithoutId);
      }

      router.replace(`/invoices/${result.invoiceId}`);
    } catch (uploadError: unknown) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
      setUploading(false);
    } finally {
      inFlightRef.current = false;
    }
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void upload(file);
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.tiff,.webp"
        onChange={handleChange}
        disabled={uploading}
        style={{ display: "none" }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        style={{
          background: uploading ? "#93c5fd" : "#2563eb",
          color: "#fff",
          padding: "8px 14px",
          border: "none",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 600,
          cursor: uploading ? "default" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {uploading ? t.newInvoice.processing : label}
      </button>
      {error && (
        <span role="alert" style={{ maxWidth: 240, color: "#dc2626", fontSize: 12, lineHeight: 1.3 }}>
          {error}
        </span>
      )}
    </div>
  );
}
