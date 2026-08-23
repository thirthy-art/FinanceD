"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentEvidenceElement } from "@/src/lib/experimental/document-evidence";
import {
  MAX_LAYOUT_PROBE_LABEL,
  validateLayoutProbeFile,
} from "./layout-probe-shared";
import {
  buildEvidenceIndex,
  evidenceBoxPosition,
  isLayoutProbeResult,
  logicalTableForCandidate,
  pageAspectRatio,
  resolveElementText,
  type LayoutProbeResult,
} from "./layout-probe-view";
import styles from "./layout-probe.module.css";

type ProbeStatus = "idle" | "loading" | "validation-error" | "server-error" | "success";

function formatBox(box: { x: string; y: string; width: string; height: string }): string {
  return `x ${box.x}, y ${box.y}, w ${box.width}, h ${box.height}`;
}

function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export default function LayoutProbeTool() {
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const fileUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<ProbeStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<LayoutProbeResult | null>(null);
  const [selectedPage, setSelectedPage] = useState(1);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    },
    [],
  );

  const evidenceIndex = useMemo(
    () => (result ? buildEvidenceIndex(result.evidence) : null),
    [result],
  );

  function selectFile(nextFile: File | null) {
    if (fileUrlRef.current) {
      URL.revokeObjectURL(fileUrlRef.current);
      fileUrlRef.current = null;
    }
    if (nextFile) fileUrlRef.current = URL.createObjectURL(nextFile);
    setFile(nextFile);
    setFileUrl(fileUrlRef.current);
    setResult(null);
    setSelectedElementId(null);
    setErrorMessage(null);
    if (!nextFile) {
      setStatus("idle");
      return;
    }
    const validationError = validateLayoutProbeFile(nextFile);
    if (validationError) {
      setStatus("validation-error");
      setErrorMessage(validationError);
    } else {
      setStatus("idle");
    }
  }

  async function runInspection() {
    if (!file || status === "loading") return;
    const validationError = validateLayoutProbeFile(file);
    if (validationError) {
      setStatus("validation-error");
      setErrorMessage(validationError);
      return;
    }
    setStatus("loading");
    setErrorMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/dev/layout-probe", { method: "POST", body });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isLayoutProbeResult(payload)) {
        const serverMessage =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : `Inspection failed with HTTP ${response.status}.`;
        setStatus("server-error");
        setErrorMessage(serverMessage);
        return;
      }
      setResult(payload);
      setSelectedPage(payload.evidence.pages[0]?.page ?? 1);
      setSelectedElementId(null);
      setStatus("success");
    } catch {
      setStatus("server-error");
      setErrorMessage("The inspection request failed before a response was received.");
    }
  }

  const pages = result?.evidence.pages ?? [];
  const currentPage = pages.find((page) => page.page === selectedPage) ?? pages[0] ?? null;
  const selectedElement: DocumentEvidenceElement | null =
    selectedElementId && evidenceIndex ? (evidenceIndex.get(selectedElementId) ?? null) : null;
  const pageTables = result && currentPage
    ? result.tables.filter((table) => table.page === currentPage.page)
    : [];

  function selectPage(pageNumber: number) {
    setSelectedPage(pageNumber);
    setSelectedElementId(null);
  }

  function idChip(id: string) {
    return (
      <button
        key={id}
        type="button"
        className={styles.idChip}
        onClick={() => setSelectedElementId(id)}
      >
        {id}
      </button>
    );
  }

  return (
    <div className={styles.tool}>
      <header className={styles.header}>
        <h1 className={styles.title}>Layout probe (developer tool)</h1>
        <p>
          Deterministic inspection of born-digital PDF layout evidence. The uploaded invoice
          content stays in memory for this request only: FinanceD does not persist it to the
          database, document storage, or logs. The extracted evidence may contain sensitive
          invoice text — do not share results from real invoices.
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="layout-probe-select">
        <h2 id="layout-probe-select" className={styles.panelTitle}>
          1. Select one PDF
        </h2>
        <div
          className={styles.dropzone}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const dropped = event.dataTransfer.files[0] ?? null;
            if (fileInputRef.current) fileInputRef.current.value = "";
            selectFile(dropped);
          }}
        >
          <label className={styles.fileLabel} htmlFor="layout-probe-file">
            Invoice PDF (exactly one, up to {MAX_LAYOUT_PROBE_LABEL})
          </label>
          <input
            id="layout-probe-file"
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className={styles.fileInput}
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
          />
          <p className={styles.dropHint}>…or drop a PDF onto this area.</p>
        </div>
        {file && (
          <p className={styles.fileSummary}>
            Selected: {file.name} ({formatFileSize(file.size)})
          </p>
        )}
        <button
          type="button"
          className={styles.runButton}
          onClick={runInspection}
          disabled={!file || status === "loading"}
        >
          {status === "loading" ? "Inspecting…" : "Run inspection"}
        </button>
        <div aria-live="polite" className={styles.statusArea}>
          {status === "idle" && !file && <p>Idle — choose a PDF to begin.</p>}
          {status === "loading" && <p role="status">Inspecting {file?.name}…</p>}
          {(status === "validation-error" || status === "server-error") && errorMessage && (
            <p role="alert" className={styles.errorText}>
              {status === "validation-error" ? "Validation error: " : "Server error: "}
              {errorMessage}
            </p>
          )}
          {status === "success" && (
            <p role="status" className={styles.successText}>
              Inspection complete — {pages.length} page(s),{" "}
              {result?.evidence.pages.reduce((total, page) => total + page.elements.length, 0)}{" "}
              evidence elements, {result?.tables.length ?? 0} table candidate(s),{" "}
              {result?.logicalTables?.length ?? 0} logical line-item table(s).
            </p>
          )}
        </div>
      </section>

      {status === "success" && result && evidenceIndex && currentPage && (
        <>
          <section className={styles.panel} aria-labelledby="layout-probe-inspect">
            <h2 id="layout-probe-inspect" className={styles.panelTitle}>
              2. Inspect evidence
            </h2>
            {pages.length > 1 && (
              <div className={styles.pageSelector} role="group" aria-label="Evidence page">
                {pages.map((page) => (
                  <button
                    key={page.page}
                    type="button"
                    aria-pressed={page.page === currentPage.page}
                    className={
                      page.page === currentPage.page
                        ? `${styles.pageButton} ${styles.pageButtonSelected}`
                        : styles.pageButton
                    }
                    onClick={() => selectPage(page.page)}
                  >
                    Page {page.page}
                  </button>
                ))}
              </div>
            )}
            <div className={styles.viewerGrid}>
              <figure className={styles.viewerPane}>
                <figcaption className={styles.viewerCaption}>
                  PDF preview (browser-local file)
                </figcaption>
                {fileUrl && (
                  <iframe
                    src={fileUrl}
                    title="Selected PDF preview"
                    className={styles.previewFrame}
                  />
                )}
              </figure>
              <figure className={styles.viewerPane}>
                <figcaption className={styles.viewerCaption}>
                  Evidence map — page {currentPage.page} ({currentPage.dimensions.width} ×{" "}
                  {currentPage.dimensions.height} {currentPage.dimensions.unit})
                </figcaption>
                <div
                  className={styles.evidenceMap}
                  role="group"
                  aria-label={`Evidence map for page ${currentPage.page}`}
                  style={{ aspectRatio: pageAspectRatio(currentPage.dimensions) }}
                >
                  {currentPage.elements.map((element) => {
                    const isSelected = element.id === selectedElementId;
                    return (
                      <button
                        key={element.id}
                        type="button"
                        className={
                          isSelected
                            ? `${styles.evidenceBox} ${styles.evidenceBoxSelected}`
                            : styles.evidenceBox
                        }
                        style={evidenceBoxPosition(element.normalizedBbox)}
                        onClick={() => setSelectedElementId(element.id)}
                        aria-pressed={isSelected}
                        aria-label={`Evidence element ${element.id}: ${element.text}`}
                        title={element.text}
                      >
                        {isSelected && (
                          <span aria-hidden="true" className={styles.selectedMarker}>
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </figure>
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="layout-probe-element">
            <h2 id="layout-probe-element" className={styles.panelTitle}>
              Selected element
            </h2>
            {selectedElement ? (
              <dl className={styles.detailList}>
                <div>
                  <dt>ID</dt>
                  <dd>{selectedElement.id}</dd>
                </div>
                <div>
                  <dt>Text</dt>
                  <dd>{selectedElement.text}</dd>
                </div>
                <div>
                  <dt>Page</dt>
                  <dd>{selectedElement.page}</dd>
                </div>
                <div>
                  <dt>contentOrder</dt>
                  <dd>{selectedElement.contentOrder}</dd>
                </div>
                <div>
                  <dt>visualOrder</dt>
                  <dd>{selectedElement.visualOrder}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{selectedElement.source}</dd>
                </div>
                <div>
                  <dt>bbox</dt>
                  <dd>{formatBox(selectedElement.bbox)}</dd>
                </div>
                <div>
                  <dt>normalizedBbox</dt>
                  <dd>{formatBox(selectedElement.normalizedBbox)}</dd>
                </div>
              </dl>
            ) : (
              <p className={styles.muted}>
                Select an evidence box on the map to inspect its deterministic coordinates.
              </p>
            )}
          </section>

          <section className={styles.panel} aria-labelledby="layout-probe-tables">
            <h2 id="layout-probe-tables" className={styles.panelTitle}>
              Table candidates — page {currentPage.page}
            </h2>
            {pageTables.length === 0 ? (
              <p className={styles.muted}>No table candidates on this page.</p>
            ) : (
              pageTables.map((table) => (
                <article key={table.id} className={styles.tableCard}>
                  <h3 className={styles.tableTitle}>
                    {table.id} — {table.rowCount} row(s) × {table.columnCount} column(s)
                    <span className={styles.roleBadge}>{table.classification.role}</span>
                    {logicalTableForCandidate(result, table.id) && (
                      <span className={styles.roleBadge}>
                        {logicalTableForCandidate(result, table.id)?.id}
                      </span>
                    )}
                  </h3>
                  <p className={styles.muted}>{table.classification.reason}</p>
                  <div className={styles.tableScroll}>
                    <table className={styles.candidateTable}>
                      <tbody>
                        {table.rows.map((row) => (
                          <tr key={row.rowIndex}>
                            {Array.from({ length: table.columnCount }, (_, columnIndex) => {
                              const cell = row.cells.find(
                                (candidate) => candidate.columnIndex === columnIndex,
                              );
                              return (
                                <td key={columnIndex}>
                                  {cell && (
                                    <>
                                      <span className={styles.cellText}>
                                        {resolveElementText(evidenceIndex, cell.evidenceElementIds)}
                                      </span>
                                      <span className={styles.cellIds}>
                                        {cell.evidenceElementIds.map(idChip)}
                                      </span>
                                    </>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {table.excludedSparseLineElementIds.length > 0 && (
                    <div className={styles.sparseLines}>
                      <p className={styles.muted}>
                        Excluded sparse lines ({table.excludedSparseLineElementIds.length}):
                      </p>
                      <ul>
                        {table.excludedSparseLineElementIds.map((ids, index) => (
                          <li key={index}>
                            {ids.map(idChip)}
                            <span className={styles.cellText}>
                              {" "}
                              — “{resolveElementText(evidenceIndex, ids)}”
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              ))
            )}
          </section>

          <section className={styles.panel} aria-labelledby="layout-probe-logical">
            <h2 id="layout-probe-logical" className={styles.panelTitle}>
              Cross-page logical tables
            </h2>
            {(result.logicalTables ?? []).length === 0 ? (
              <p className={styles.muted}>No line-item candidates to link.</p>
            ) : (
              (result.logicalTables ?? []).map((logical) => (
                <article key={logical.id} className={styles.tableCard}>
                  <h3 className={styles.tableTitle}>
                    {logical.id} — page(s) {logical.pages.join(", ")} — {logical.rowCount}{" "}
                    logical row(s) ({logical.dataRowCount} data)
                    {logical.candidateIds.length > 1 && (
                      <span className={styles.roleBadge}>linked across pages</span>
                    )}
                  </h3>
                  <p className={styles.muted}>
                    Candidates: {logical.candidateIds.join(", ")} · repeated header row(s):{" "}
                    {logical.repeatedHeaderRowCount}
                  </p>
                  {logical.links.length > 0 && (
                    <ul className={styles.muted}>
                      {logical.links.map((link) => (
                        <li key={`${link.fromCandidateId}-${link.toCandidateId}`}>
                          {link.fromCandidateId} → {link.toCandidateId} (page {link.fromPage} →{" "}
                          {link.toPage}): {link.reasons.join("; ")}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))
            )}
          </section>

          <section className={styles.panel} aria-labelledby="layout-probe-raw">
            <h2 id="layout-probe-raw" className={styles.panelTitle}>
              Raw deterministic output
            </h2>
            <details className={styles.rawDetails}>
              <summary>Show raw JSON (may contain sensitive invoice text)</summary>
              <pre className={styles.rawJson}>{JSON.stringify(result, null, 2)}</pre>
            </details>
          </section>
        </>
      )}
    </div>
  );
}
