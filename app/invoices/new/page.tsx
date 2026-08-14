"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export default function NewInvoicePage() {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlightRef = useRef(false);
  const pendingUploadRef = useRef<{ file: File; requestId: string } | null>(null);

  async function handleFile(file: File, requestId = crypto.randomUUID()) {
    if (inFlightRef.current) return;
    setError("");
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/tiff", "image/webp"];
    if (!allowed.includes(file.type)) {
      pendingUploadRef.current = null;
      setCanRetry(false);
      setError("Unsupported file type. Upload a PDF, JPEG, PNG, TIFF, or WebP.");
      return;
    }
    pendingUploadRef.current = { file, requestId };
    setCanRetry(false);
    inFlightRef.current = true;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("requestId", requestId);
      const res = await fetch("/api/invoices/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({})) as { error?: unknown; invoiceId?: unknown };
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Upload failed. Please retry.");
      if (typeof json.invoiceId !== "number") throw new Error("Upload completed without an invoice identifier. Please retry.");
      pendingUploadRef.current = null;
      setCanRetry(false);
      router.replace(`/invoices/${json.invoiceId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setCanRetry(true);
      setUploading(false);
    } finally {
      inFlightRef.current = false;
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (uploading) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function retryUpload() {
    const pending = pendingUploadRef.current;
    if (pending) handleFile(pending.file, pending.requestId);
  }

  return (
    <div style={{ maxWidth: 540, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1e3a5f", marginBottom: 24 }}>
        Upload Supplier Invoice
      </h1>

      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragging ? "#2563eb" : "#cbd5e1"}`,
          borderRadius: 12,
          padding: "60px 24px",
          textAlign: "center",
          cursor: uploading ? "default" : "pointer",
          background: dragging ? "#eff6ff" : "#fff",
          transition: "all 0.15s",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.tiff,.webp"
          style={{ display: "none" }}
          onChange={onInputChange}
          disabled={uploading}
        />
        {uploading ? (
          <div>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1e3a5f" }}>
              Processing…
            </div>
            <div style={{ color: "#64748b", marginTop: 8 }}>
              Extracting text from your document
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📂</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1e3a5f", marginBottom: 8 }}>
              Drop invoice here or click to browse
            </div>
            <div style={{ color: "#64748b", fontSize: 13 }}>
              Supported: PDF, JPEG, PNG, TIFF, WebP
            </div>
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: "12px 16px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            color: "#dc2626",
            fontSize: 14,
          }}
        >
          <div>{error}</div>
          {canRetry && (
            <button
              type="button"
              onClick={retryUpload}
              disabled={uploading}
              style={{ marginTop: 10, padding: "7px 12px", border: "none", borderRadius: 6, background: "#dc2626", color: "#fff", cursor: uploading ? "default" : "pointer", fontWeight: 600 }}
            >
              Retry upload
            </button>
          )}
        </div>
      )}

      <div style={{ marginTop: 32, padding: 16, background: "#f0f9ff", borderRadius: 8, border: "1px solid #bae6fd" }}>
        <div style={{ fontWeight: 600, color: "#0c4a6e", marginBottom: 8, fontSize: 13 }}>
          What happens after upload?
        </div>
        <ul style={{ color: "#0369a1", fontSize: 13, paddingLeft: 20, lineHeight: 1.8 }}>
          <li>Text PDFs: fields extracted automatically</li>
          <li>Images (JPEG/PNG): OCR applied to extract text</li>
          <li>Scanned PDFs: enter fields manually</li>
          <li>All fields remain editable before saving</li>
        </ul>
      </div>
    </div>
  );
}
