"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export default function NewInvoicePage() {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError("");
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/tiff", "image/webp"];
    if (!allowed.includes(file.type)) {
      setError("Unsupported file type. Upload a PDF, JPEG, PNG, TIFF, or WebP.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/invoices/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      router.push(`/invoices/${json.invoiceId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
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
          {error}
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
