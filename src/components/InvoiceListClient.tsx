"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Search } from "lucide-react";
import InvoicePaymentFilter from "@/src/components/InvoicePaymentFilter";
import NewInvoiceUploadButton from "@/src/components/NewInvoiceUploadButton";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";
import { formatDisplayAmount } from "@/src/lib/invoice-validation";
import styles from "@/app/invoice-list.module.css";

export type InvoiceListRow = {
  id: number;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  currency: string;
  currencyType: "fiat" | "crypto";
  grossAmount: string | null;
  status: string;
  paymentStatus: "Paid" | "Unpaid";
  vendorName: string | null;
};

type InvoiceListLabels = {
  title: string;
  exportAll: string;
  exportAllDescription: string;
  colInvoice: string;
  colWorkflow: string;
  colDate: string;
  colAmount: string;
  review: string;
  paymentFilterLabel: string;
  paymentFilterAll: string;
  noFilterResults: string;
  noInvoicesTitle: string;
  noInvoicesDesc: string;
  uploadInvoice: string;
  deleted: string;
  searchVendor: string;
  selectInvoice: string;
  selectAll: string;
  deleteSelected: string;
  deleteConfirmation: string;
  deletedCount: string;
  partialDelete: string;
  deletionFailed: string;
  deleting: string;
};

type CommonLabels = {
  none: string;
  statusApproved: string;
  statusDraft: string;
  statusPaid: string;
  statusUnpaid: string;
};

type DeleteResponse = { deleted?: boolean; error?: string; warning?: string };
export type BulkDeleteResult = {
  deletedIds: number[];
  failures: Array<{ id: number; message: string }>;
  warnings: Array<{ id: number; message: string }>;
};

const DELETE_CONCURRENCY = 4;

export function filterInvoicesByVendor(rows: InvoiceListRow[], search: string): InvoiceListRow[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return rows;
  return rows.filter((invoice) => invoice.vendorName?.toLocaleLowerCase().includes(query) ?? false);
}

export function visibleSelectableInvoiceIds(rows: InvoiceListRow[]): number[] {
  return rows.filter((invoice) => invoice.status === "draft").map((invoice) => invoice.id);
}

export function withoutDeletedInvoices(rows: InvoiceListRow[], deletedIds: ReadonlySet<number>): InvoiceListRow[] {
  return rows.filter((invoice) => !deletedIds.has(invoice.id));
}

export async function deleteInvoicesWithConcurrency(
  ids: number[],
  request: (id: number) => Promise<Response>,
  concurrency = DELETE_CONCURRENCY,
  failureMessage = "Request failed",
): Promise<BulkDeleteResult> {
  const result: BulkDeleteResult = { deletedIds: [], failures: [], warnings: [] };
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < ids.length) {
      const id = ids[nextIndex++];
      try {
        const response = await request(id);
        const body = await response.json().catch(() => ({})) as DeleteResponse;
        if (!response.ok || !body.deleted) {
          result.failures.push({ id, message: body.error || failureMessage });
          continue;
        }
        result.deletedIds.push(id);
        if (body.warning) result.warnings.push({ id, message: body.warning });
      } catch (error) {
        result.failures.push({ id, message: error instanceof Error ? error.message : failureMessage });
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), ids.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return result;
}

function withCount(template: string, count: number) {
  return template.replace("{count}", String(count));
}

function withDeleteCounts(template: string, deleted: number, failed: number) {
  return template.replace("{deleted}", String(deleted)).replace("{failed}", String(failed));
}

function workflowBadge(status: string, labels: CommonLabels) {
  const approved = status === "approved";
  return <span className={`${styles.workflow} ${approved ? styles.approved : ""}`}>{approved ? labels.statusApproved : labels.statusDraft}</span>;
}

function paymentBadge(status: "Paid" | "Unpaid", labels: CommonLabels) {
  const paid = status === "Paid";
  return <span className={`${styles.payment} ${paid ? styles.paid : ""}`}>{paid ? labels.statusPaid : labels.statusUnpaid}</span>;
}

export default function InvoiceListClient({
  rows,
  hasAnyInvoices,
  paymentFilter,
  showSingleDeleteNotice,
  labels,
  common,
}: {
  rows: InvoiceListRow[];
  hasAnyInvoices: boolean;
  paymentFilter: "all" | "paid" | "unpaid";
  showSingleDeleteNotice: boolean;
  labels: InvoiceListLabels;
  common: CommonLabels;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [deletedIds, setDeletedIds] = useState<Set<number>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [issues, setIssues] = useState<Array<{ id: number; message: string; kind: "warning" | "failure" }>>([]);

  const remainingRows = useMemo(() => withoutDeletedInvoices(rows, deletedIds), [rows, deletedIds]);
  const visibleRows = useMemo(() => filterInvoicesByVendor(remainingRows, search), [remainingRows, search]);
  const visibleSelectableIds = useMemo(() => visibleSelectableInvoiceIds(visibleRows), [visibleRows]);
  const allVisibleSelected = visibleSelectableIds.length > 0 && visibleSelectableIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = !allVisibleSelected && visibleSelectableIds.some((id) => selectedIds.has(id));

  function toggleInvoice(id: number, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleSelectableIds.forEach((id) => next.delete(id));
      else visibleSelectableIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function deleteSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0 || deleting || !window.confirm(withCount(labels.deleteConfirmation, ids.length))) return;

    setDeleting(true);
    setNotice(null);
    setIssues([]);
    const result = await deleteInvoicesWithConcurrency(
      ids,
      (id) => fetch(`/api/invoices/${id}`, { method: "DELETE" }),
      DELETE_CONCURRENCY,
      labels.deletionFailed,
    );

    if (result.deletedIds.length > 0) {
      setDeletedIds((current) => new Set([...current, ...result.deletedIds]));
      setSelectedIds((current) => {
        const next = new Set(current);
        result.deletedIds.forEach((id) => next.delete(id));
        return next;
      });
    }

    setIssues([
      ...result.warnings.map((issue) => ({ ...issue, kind: "warning" as const })),
      ...result.failures.map((issue) => ({ ...issue, kind: "failure" as const })),
    ]);
    setNotice(result.failures.length === 0
      ? { tone: "success", message: withCount(labels.deletedCount, result.deletedIds.length) }
      : {
          tone: result.deletedIds.length > 0 ? "success" : "error",
          message: withDeleteCounts(labels.partialDelete, result.deletedIds.length, result.failures.length),
        });
    setDeleting(false);
    if (result.deletedIds.length > 0) router.refresh();
  }

  function selectionCheckbox(invoice: InvoiceListRow, location: "desktop" | "mobile") {
    const selectable = invoice.status === "draft";
    const label = `${labels.selectInvoice}: ${invoice.vendorName ?? common.none}, ${invoice.invoiceNumber ?? common.none}, #${invoice.id}`;
    return (
      <label className={`${styles.checkboxHitArea} ${location === "mobile" ? styles.mobileCheckbox : ""}`}>
        <input
          type="checkbox"
          className={styles.checkbox}
          aria-label={label}
          checked={selectable && selectedIds.has(invoice.id)}
          disabled={!selectable || deleting}
          onChange={(event) => toggleInvoice(invoice.id, event.currentTarget.checked)}
        />
      </label>
    );
  }

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.toolbarFilters}>
          <InvoicePaymentFilter
            label={labels.paymentFilterLabel}
            allLabel={labels.paymentFilterAll}
            unpaidLabel={common.statusUnpaid}
            paidLabel={common.statusPaid}
            value={paymentFilter}
          />
          <label className={styles.searchField}>
            <span className="sr-only">{labels.searchVendor}</span>
            <Search size={16} aria-hidden="true" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder={`${labels.searchVendor}…`}
              aria-label={labels.searchVendor}
            />
          </label>
        </div>
        <div className={styles.toolbarActions}>
          {selectedIds.size > 0 && (
            <Button type="button" variant="destructive" size="sm" disabled={deleting} onClick={() => void deleteSelected()}>
              {deleting ? labels.deleting : withCount(labels.deleteSelected, selectedIds.size)}
            </Button>
          )}
          <form action="/api/invoices/export" method="get" className={styles.export}>
            <Button type="submit" variant="secondary" size="sm" aria-label={labels.exportAllDescription}>
              {labels.exportAll} · <bdi>XLSX</bdi>
            </Button>
          </form>
        </div>
      </div>

      {showSingleDeleteNotice && !notice && (
        <div className={`${styles.notice} ui-alert ui-alert-success`} role="status">{labels.deleted}</div>
      )}
      {notice && (
        <div className={`${styles.notice} ui-alert ${notice.tone === "success" ? "ui-alert-success" : "ui-alert-error"}`} role="status">
          {notice.message}
        </div>
      )}
      {issues.length > 0 && (
        <div className={`${styles.notice} ui-alert ui-alert-warning`} role="alert">
          <ul className={styles.issueList}>
            {issues.map((issue) => <li key={`${issue.kind}-${issue.id}`}>#{issue.id}: {issue.message}</li>)}
          </ul>
        </div>
      )}

      {!hasAnyInvoices ? (
        <div className={styles.empty}>
          <div className="mb-2 text-base font-semibold text-[var(--heading)]">{labels.noInvoicesTitle}</div>
          <div className="mb-5">{labels.noInvoicesDesc}</div>
          <NewInvoiceUploadButton label={labels.uploadInvoice} />
        </div>
      ) : visibleRows.length === 0 ? (
        <div className={styles.empty}>{labels.noFilterResults}</div>
      ) : (
        <>
          <div className={styles.desktop}>
            <Table className={styles.table}>
              <colgroup>
                <col className={styles.selectionColumn} />
                <col className={styles.identityColumn} />
                <col className={styles.dateColumn} />
                <col className={styles.workflowColumn} />
                <col className={styles.amountColumn} />
                <col className={styles.actionColumn} />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className={styles.selectionCell}>
                    <label className={styles.checkboxHitArea}>
                      <input
                        type="checkbox"
                        className={styles.checkbox}
                        aria-label={labels.selectAll}
                        checked={allVisibleSelected}
                        disabled={visibleSelectableIds.length === 0 || deleting}
                        ref={(node) => { if (node) node.indeterminate = someVisibleSelected; }}
                        onChange={toggleAllVisible}
                      />
                    </label>
                  </TableHead>
                  <TableHead scope="col">{labels.colInvoice}</TableHead>
                  <TableHead scope="col">{labels.colDate}</TableHead>
                  <TableHead scope="col">{labels.colWorkflow}</TableHead>
                  <TableHead scope="col" className={styles.amountHeading}>{labels.colAmount} / {labels.paymentFilterLabel}</TableHead>
                  <TableHead scope="col"><span className="sr-only">{labels.review}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className={styles.selectionCell}>{selectionCheckbox(invoice, "desktop")}</TableCell>
                    <TableCell>
                      <Link href={`/invoices/${invoice.id}`} className={styles.identity}>
                        <span className="sr-only">{labels.review}: </span>
                        <span className={styles.vendor}><bdi>{invoice.vendorName ?? common.none}</bdi></span>
                        <span className={styles.reference}><bdi>{invoice.invoiceNumber ?? common.none}</bdi><bdi className={styles.id}>#{invoice.id}</bdi></span>
                      </Link>
                    </TableCell>
                    <TableCell className={styles.date}><bdi>{invoice.invoiceDate ?? common.none}</bdi></TableCell>
                    <TableCell>{workflowBadge(invoice.status, common)}</TableCell>
                    <TableCell>
                      <div className={styles.money}>
                        <span className={styles.amount} dir="ltr">
                          {invoice.grossAmount ? <><span className={styles.currency}>{invoice.currency}</span>{" "}{formatDisplayAmount(invoice.grossAmount, invoice.currencyType)}</> : common.none}
                        </span>
                        {paymentBadge(invoice.paymentStatus, common)}
                      </div>
                    </TableCell>
                    <TableCell className={styles.actionCell}>
                      <Link href={`/invoices/${invoice.id}`} className={styles.review} aria-label={`${labels.review}: ${invoice.vendorName ?? common.none}, ${invoice.invoiceNumber ?? common.none}, #${invoice.id}`}>
                        <ChevronRight size={16} aria-hidden="true" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className={styles.mobile}>
            {visibleRows.map((invoice) => (
              <article key={invoice.id} className={styles.mobileArticle}>
                {selectionCheckbox(invoice, "mobile")}
                <Link className={styles.mobileRow} href={`/invoices/${invoice.id}`}>
                  <span className="sr-only">{labels.review}: </span>
                  <span className={styles.mobileIdentity}>
                    <span className={styles.vendor}><bdi>{invoice.vendorName ?? common.none}</bdi></span>
                    <span className={styles.reference}><bdi>{invoice.invoiceNumber ?? common.none}</bdi><bdi className={styles.id}>#{invoice.id}</bdi></span>
                  </span>
                  <span className={styles.money}>
                    <span className={styles.amount} dir="ltr">
                      {invoice.grossAmount ? <><span className={styles.currency}>{invoice.currency}</span>{" "}{formatDisplayAmount(invoice.grossAmount, invoice.currencyType)}</> : common.none}
                    </span>
                    <span className="sr-only">{labels.paymentFilterLabel}: </span>
                    {paymentBadge(invoice.paymentStatus, common)}
                  </span>
                  <span className={styles.date}><span className="sr-only">{labels.colDate}: </span><bdi>{invoice.invoiceDate ?? common.none}</bdi></span>
                  <span className={styles.mobileWorkflow}><span>{labels.colWorkflow}: </span>{workflowBadge(invoice.status, common)}</span>
                  <ChevronRight className={styles.mobileChevron} size={16} aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}
