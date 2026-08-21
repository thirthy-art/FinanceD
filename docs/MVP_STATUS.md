# FinanceD MVP Status

Snapshot for `origin/main` at `2d47180e640766183084fe1cc3e153bda0d237fb` (2026-08-21).

## MVP definition

FinanceD currently gives an SME a company-scoped workflow for capturing supplier invoices, reviewing and approving their accounting data, tracking unpaid payables, and comparing budget with actual recognized invoice costs. It is pre-accounting and cash-visibility software, not a full ledger or ERP.

## Current modules

- **Companies:** explicit company creation and active-company selection. A single existing company may resolve automatically; zero or multiple companies require an explicit choice. Base currency is configurable.
- **Supplier Invoices:** document upload, review, editable headers and lines, draft/approval lifecycle, paid/unpaid tracking, original-document viewing, and XLSX export.
- **Vendors:** company-scoped vendor management, identity matching, duplicate assistance, and merge.
- **Chart of Accounts:** company-scoped hierarchical accounts used for invoice validation and Budget category mapping.
- **Cost Centres:** optional company-scoped references on invoices and Budget entries.
- **Cash Forecast / Payables:** a read-only view and XLSX export of unpaid supplier invoices, bucketed by due date and summarized by currency.
- **Budget v1:** categories, account mappings, monthly budgets, manual actuals, and budget/actual/variance reporting. Approved supplier invoice lines feed actuals through their recognition schedule.

## Supplier invoice capabilities

- Upload PDF, JPEG, PNG, TIFF, and WebP files up to the route's 25 MB limit.
- Store the immutable original using local storage or the S3-compatible durable storage backend, with its metadata in PostgreSQL.
- Extract embedded PDF text locally; run local OCR for uploaded images; derive initial field suggestions using local heuristics.
- Optionally call an OpenAI-compatible AI provider. Born-digital PDFs normally send extracted text; images and scanned PDFs use image input. **Try image AI** forces PDF page rendering and image processing.
- Run deterministic arithmetic reconciliation on structured AI output before returning it for review.
- Preview AI output, then explicitly apply selected header and line suggestions; no extraction response is automatically persisted.
- Edit invoice headers and line items. Blank line numbers receive 1-based positional fallback values in the UI flow and again before server persistence; genuine nonblank line numbers remain unchanged. A line number by itself does not make an otherwise-empty UI line persist.
- Set per-line **Immediate** or **Prepaid** recognition, including required recognition dates and expense/prepaid account assignment for prepaid lines.
- Assign active posting accounting accounts and an optional cost centre.
- Store a signed invoice-level `lineNetAdjustment` (default `0`) to reconcile `sum(line net) + adjustment` with header net. It is not a synthetic line and does not alter line/header VAT, gross, original amounts, or base/FX amounts.
- Approve only after server validation of required fields, source document, amount arithmetic, FX requirements, line totals, recognition fields, VAT rates, and account validity. Approved invoices remain editable but cannot be downgraded to draft.
- Track `Paid` / `Unpaid` and an optional paid date, export invoice and payable workbooks, and view the stored original document.

## Current accounting and data rules

- Business data and document access are scoped through the active company and company-filtered queries.
- Original amounts and FX rates are decimal strings backed by `numeric(38,18)`; base invoice amounts are `numeric(18,4)`. Budget values use `numeric(18,2)`. Monetary calculations use `decimal.js`.
- The company base currency is configurable. Each invoice owns a fixed `fxRateToBase`; changing the rate recalculates base amounts only and does not change original amounts or status.
- Invoice approval is server-authoritative. Header net plus VAT must equal gross within currency tolerance; when lines exist, line totals are checked independently against their corresponding header totals, with `lineNetAdjustment` participating only in net reconciliation.
- `supplierInvoices.paymentStatus` is the canonical paid/unpaid state; setting an invoice back to `Unpaid` clears its paid date.
- Only approved supplier invoices feed Budget invoice-derived actuals. Line account mapping and Immediate/Prepaid recognition determine category and month allocation; manual actuals remain separate persisted records.

## Deployment and current infrastructure

The current production topology is a Render application, Neon PostgreSQL, and Cloudflare R2 (S3-compatible durable document storage, EU jurisdiction). The repository contains the application-side database, S3-compatible storage, and AI configuration contracts, but not the Render/Neon/R2 resource definitions or console settings. Those external settings must be verified in their respective services.

## Known MVP limitations / intentionally deferred items

FinanceD does not yet provide an internal double-entry ledger, journal posting, period closing, bank reconciliation, multi-user permissions, or multi-company administration. Structural PDF extraction, vendor-to-account learning, provider fallback, richer diagnostics, and scale-oriented improvements are possible future directions, not current commitments or blockers; see [Future Ideas](FUTURE_IDEAS.md).
