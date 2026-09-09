"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/i18n/context";
import CompanyAccessState, { companyAccessCode, type CompanyAccessCode } from "@/src/components/CompanyAccessState";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Alert } from "@/src/components/ui/feedback";
import { PageDescription, PageHeader, PageHeading, PageTitle } from "@/src/components/ui/page";

export default function NewInvoicePage() {
  const router = useRouter();
  const { t } = useI18n();
  const n = t.newInvoice;
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const [accessCode, setAccessCode] = useState<CompanyAccessCode | null>(null);
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
      setError(n.unsupportedType);
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
      const json = await res.json().catch(() => ({})) as { error?: unknown; invoiceId?: unknown; code?: unknown };
      const denied = companyAccessCode(json);
      if (denied) {
        setAccessCode(denied);
        setUploading(false);
        return;
      }
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Upload failed. Please retry.");
      if (typeof json.invoiceId !== "number") throw new Error(n.uploadWithoutId);
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

  if (accessCode) return <CompanyAccessState code={accessCode} />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader>
        <PageHeading>
          <PageTitle>{n.title}</PageTitle>
          <PageDescription>{n.supportedFormats}</PageDescription>
        </PageHeading>
      </PageHeader>

      <Card
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`invoice-upload-zone${dragging ? " invoice-upload-zone-active" : ""}${uploading ? " invoice-upload-zone-busy" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.tiff,.webp"
          className="sr-only"
          onChange={onInputChange}
          disabled={uploading}
        />
        {uploading ? (
          <div>
            <div className="invoice-upload-icon" aria-hidden="true">⏳</div>
            <div className="invoice-upload-title">
              {n.processing}
            </div>
            <div className="invoice-upload-copy">
              {n.extractingText}
            </div>
          </div>
        ) : (
          <div>
            <div className="invoice-upload-icon" aria-hidden="true">📂</div>
            <div className="invoice-upload-title">
              {n.dropHere}
            </div>
            <div className="invoice-upload-copy">
              {n.supportedFormats}
            </div>
          </div>
        )}
      </Card>

      {error && (
        <Alert tone="error" className="mt-4">
          <div>{error}</div>
          {canRetry && (
            <Button
              type="button"
              onClick={retryUpload}
              disabled={uploading}
              variant="destructive"
              size="sm"
              className="mt-3"
            >
              {n.retryUpload}
            </Button>
          )}
        </Alert>
      )}
    </div>
  );
}
