# FinanceD Architecture Map

Architecture map and module-boundary audit. Repository: `thirthy-art/FinanceD`.
Inspected at: `origin/main 2d47180e640766183084fe1cc3e153bda0d237fb` · 2026-08-21.

## Contents

1. Executive Summary
2. Repository / Module Map
3. Source-of-Truth Map
4. Business-Rule Map
5. Module Dependency Matrix
6. Module-by-Module Independence Verdict
7. Key Data / Call Flows
8. Boundary Findings
9. Boundaries That Are Already Healthy
10. Final Product-Level Verdict

## 1. Executive Summary

FinanceD is a Next.js App Router financial-operations application for SMEs. The current MVP has seven product domains: Supplier Invoices, Vendors, Chart of Accounts, Cost Centres, Cash Forecast / Payables, Budget, and Companies, plus shared infrastructure.

The codebase is a modular monolith. Product domains live in one application, share PostgreSQL through Drizzle ORM, and use intentional shared helpers. Boundaries are logical—API route ownership, table ownership, company scoping, and server validation—not separate processes or schemas.

The principal intentional read dependency is Budget → Supplier Invoices: the Budget report reads approved invoice lines to derive recognized actuals. Cash Forecast likewise reads unpaid invoice data. Vendor merge is the only deliberate cross-domain write, updating invoice vendor foreign keys transactionally.

No P0 or P1 boundary violations are evident at this inspected commit. The maintenance observations below are future, observe-first notes rather than current work.

## 2. Repository / Module Map

### Directory structure

```text
app/
  api/
    invoices/            Invoice CRUD, upload, AI extraction, documents, export
    budget/              Categories, entries, actuals, report, seed
    cash-flow/           Payables XLSX export
    companies/           Company list, creation, active selection
    settings/
      chart-of-accounts/ CoA CRUD
      cost-centres/      Cost centre CRUD
      vendors/           Vendor CRUD and merge
      company/           Company settings
  invoices/              Upload and invoice detail pages
  budget/                Budget v1 UI
  cash-flow/             Cash Forecast UI
  settings/              Company and master-data UI

src/
  db/                    Connection, schema, migration runner, seed
  lib/
    active-company.ts    Active company resolution and cookie
    ai-*.ts              Provider, extraction schema, reconciliation
    document-storage.ts  Local/S3 binary storage boundary
    invoice-lines.ts     Line normalization, numbering, approval rules
    invoice-validation.ts Decimal validation and FX calculations
    budget-actuals.ts    Budget categorization and actual aggregation
    recognition.ts       Immediate/Prepaid recognition schedule
    decimal.ts           Shared Decimal configuration
  components/            Invoice, company, cash-flow, and navigation UI
  i18n/                  English, Russian, and Hebrew messages

drizzle/                 Versioned SQL migrations
```

### Module ownership

| Module | API routes | Primary tables owned |
|---|---|---|
| Supplier Invoices | `app/api/invoices/*` | `supplier_invoices`, `supplier_invoice_documents`, `supplier_invoice_lines` |
| Vendors | `app/api/settings/vendors/*` | `vendors` |
| Chart of Accounts | `app/api/settings/chart-of-accounts/*` | `chart_of_accounts` |
| Cost Centres | `app/api/settings/cost-centres/*` | `cost_centres` |
| Cash Forecast | `app/api/cash-flow/*` | None; read model over invoice data |
| Budget | `app/api/budget/*` | `budget_categories`, `budget_category_accounts`, `budget_entries`, `budget_actual_entries` |
| Companies | `app/api/companies/*`, `app/api/settings/company/*` | `companies` |

### Database relationships and precision

| Table | Key relationships / constraints |
|---|---|
| `companies` | Configurable `base_currency` (schema default EUR) |
| `chart_of_accounts` | Company FK, self-parent FK, unique company/code |
| `cost_centres` | Company FK, unique company/code |
| `vendors` | Company FK, partial uniqueness for normalized non-null tax ID |
| `supplier_invoices` | Company/vendor/cost-centre/expense-account references; draft/approved; canonical `payment_status`; idempotent upload request; signed `line_net_adjustment` default zero |
| `supplier_invoice_documents` | Invoice FK; original metadata, storage reference, extracted text |
| `supplier_invoice_lines` | Invoice FK with cascade delete; unique invoice/position; Immediate/Prepaid recognition |
| Budget tables | Company/category/account/cost-centre relationships and month-level uniqueness rules |

Original invoice amounts, line amounts, the signed adjustment, and FX rates use `numeric(38,18)`; base invoice amounts use `numeric(18,4)`; Budget amounts use `numeric(18,2)`. Application monetary values remain decimal strings and arithmetic is performed through `decimal.js`.

## 3. Source-of-Truth Map

| Concept | Source of truth | Writers | Consumers | Form |
|---|---|---|---|---|
| Active company | Validated `financed_company_id` cookie, or the sole existing company | Active-company route; explicit company creation sets cookie | Pages and APIs through active-company helpers | Cookie validated against DB |
| Company creation/selection | `companies` rows plus active-company cookie | Company creation and active selection APIs | All company-scoped modules | Explicit when none exists or selection is ambiguous; no silent company creation |
| Company base currency | `companies.base_currency` | Company creation/settings | Invoice FX, Cash Forecast display, Budget report | Persisted |
| Invoice header | `supplier_invoices` | Upload creates draft; invoice PATCH edits | Review, Cash Forecast, Budget, export | Persisted |
| Invoice lines | `supplier_invoice_lines` | Invoice PATCH atomically replaces supplied lines | Review, Budget actuals, export | Persisted |
| Invoice line-net adjustment | `supplier_invoices.line_net_adjustment` | Invoice PATCH | Approval reconciliation, UI, export | Persisted signed value, default zero |
| Original document | Document row plus local/S3 binary | Upload; invoice deletion removes exclusively owned binary | Viewer and AI extraction | Persisted metadata + binary |
| Vendor | `vendors` | Vendor routes; invoice save may match/create; merge | Invoice and Cash Forecast | Persisted |
| CoA / cost centres | Corresponding company-scoped tables | Settings routes | Invoice validation; Budget mapping/scoping | Persisted |
| Recognition treatment | Line treatment and start/end fields | Invoice PATCH | Budget actual calculation | Persisted |
| Paid/unpaid state | `supplier_invoices.payment_status` and `paid_date` | Invoice PATCH/manual UI action | Invoice list/export and Cash Forecast | Persisted; payment status is canonical |
| Budget planned/manual data | Budget tables | Budget APIs | Budget report | Persisted |
| Budget invoice actuals | Approved invoice lines evaluated at query time | Derived from persisted invoice data | Budget report | Derived, not separately persisted |
| AI extraction before save | Client preview state | Extract response and explicit apply action | Invoice review form | Derived; never automatically saved |

No competing persisted source of truth was found for these concepts.

## 4. Business-Rule Map

| Rule | Primary enforcement | Notes |
|---|---|---|
| Company isolation | Active-company helpers plus company predicates in routes | Document reads join through the company-scoped invoice |
| No implicit first company | Company resolver | One existing company may resolve; zero or multiple require selection/creation |
| Header arithmetic | `invoice-validation.ts`, invoice PATCH | Net + VAT ≈ gross under fiat/crypto tolerance |
| Approval completeness | Invoice PATCH | Vendor, number, date, currency, amounts, and source document required; foreign currency requires FX |
| Approved lifecycle | Invoice PATCH | Approved invoices remain editable; approved → draft is rejected |
| Line account validity | `invoice-lines.ts`, invoice PATCH | Active company posting accounts; prepaid lines also require prepaid asset account |
| Recognition validity | `invoice-lines.ts` | Prepaid requires valid start/end dates and accounts |
| Line/header reconciliation | `checkLineTotalsForApproval()` | Net uses `sum(line net) + lineNetAdjustment`; VAT and gross checks remain independent |
| Adjustment semantics | Invoice schema/PATCH/line validation | Signed, invoice-level, not a synthetic line; does not change header/line values or base/FX calculations |
| Automatic line numbering | `fillMissingLineNumbers()` in UI/application mapping and invoice PATCH | Blank values get 1-based position; nonblank values are preserved; numbering alone does not make an empty UI line persist |
| AI extraction arithmetic | `ai-invoice-reconciliation.ts` | Deterministic reconciliation occurs after schema validation and before preview |
| Payment source of truth | `supplier_invoices.payment_status` | Cash Forecast reads only `Unpaid`; reverting to Unpaid clears paid date |
| Budget actual eligibility | Budget report | Only approved invoices are read; line account and recognition schedule drive attribution |
| Budget entry precedence | `resolveBudgetForMonth()` | A company-level category/month budget takes precedence over cost-centre entries |

## 5. Module Dependency Matrix

`READ` reads data, `WRITE` mutates data, `REF` uses master data, and `INFRA` uses shared company infrastructure.

| From / To | Companies | Vendors | CoA | Cost Centres | Invoices | Documents | Budget |
|---|---|---|---|---|---|---|---|
| Vendors | INFRA | — | — | — | READ / merge WRITE | — | — |
| CoA | INFRA | — | — | — | — | — | — |
| Cost Centres | INFRA | — | — | — | — | — | — |
| Invoices | INFRA | REF + optional create | REF | REF | — | WRITE/READ | — |
| Cash Forecast | INFRA | READ | — | — | READ unpaid | — | — |
| Budget | INFRA | — | REF | REF | READ approved lines | — | — |

The Budget → Invoice read dependency is intentional: approved supplier invoice actuals are part of Budget v1. Cash Forecast → Invoice is likewise its product purpose. Vendor merge's transactionally scoped FK rewrite is a deliberate data-quality operation.

## 6. Module-by-Module Independence Verdict

- **Supplier Invoices — B:** owns header, document metadata, and line tables; intentionally references vendor, CoA, and cost-centre master data. Storage is hidden behind a shared boundary.
- **Vendors — B:** owns vendor records. Delete guards read invoice references; merge intentionally rewrites invoice vendor FKs transactionally.
- **Chart of Accounts — A:** owns accounts; other modules reference them. Deletion is soft deactivation.
- **Cost Centres — A:** owns cost centres; invoices and Budget use optional references.
- **Cash Forecast / Payables — C:** owns no table and is intentionally a read model over unpaid invoices.
- **Budget — C:** owns its four tables and intentionally reads approved invoice lines for actuals without writing invoice data.
- **Companies — A:** owns companies and exposes centralized resolution. Company creation is explicit; there is no first-boot auto-create path.

## 7. Key Data / Call Flows

### A. New invoice upload

```text
POST multipart upload
→ validate type, 25 MB limit, active company, and request idempotency
→ extract PDF text or run local image OCR
→ store immutable binary through local/S3 storage abstraction
→ transaction: create draft invoice + document metadata/extracted text
→ run local heuristic field parser
→ return invoice id and suggested fields
→ browser opens review page
```

### B. AI invoice extraction

```text
POST /api/invoices/{id}/extract[?mode=image]
→ validate active company and locate its document
→ load optional OpenAI-compatible provider configuration
→ normal born-digital PDF: send stored extracted text
→ image or scanned PDF: send image input; render PDF pages when needed
→ mode=image: ignore available PDF text and force rendered-page vision path
→ schema-validate provider JSON
→ deterministically reconcile invoice arithmetic
→ return extraction + reconciliation metadata
→ preview in client; user explicitly applies suggestions, then separately saves
```

### C. Invoice save and approval

```text
PATCH company-scoped invoice
→ validate decimal strings, references, status transition, and FX
→ normalize supplied lines and fill blank line numbers by 1-based position
→ for approval: validate required fields/document/header arithmetic
→ validate VAT rates, recognition, and active posting account codes
→ reconcile line totals; adjustment participates only in line-net comparison
→ transactionally resolve/create vendor, update header, replace supplied lines
→ recalculate base net/VAT/gross only when their inputs or FX change
```

### D. Cash Forecast / Payables

```text
Read company invoices joined to vendors where payment_status = Unpaid
→ bucket by due date (overdue, weeks, later, or missing)
→ sum by invoice currency and show funding-through-month-end summary
→ render page or export XLSX
```

### E. Budget report

```text
Read company categories, budgets, manual actuals, and account mappings
→ read approved company invoices and their lines
→ resolve line account to Budget category
→ derive Immediate/Prepaid monthly recognition in base currency
→ combine invoice actuals and manual actuals
→ return budget, actual, and variance per category/month
```

## 8. Boundary Findings

No current P0 or P1 correctness, ownership, or company-isolation finding was identified in the focused update of the supplied map.

The following prior audit observations remain useful only as **observe-first / future maintenance** notes:

- A future CoA UI may warn when deactivating an account used by a Budget mapping.
- The Budget report aggregates approved invoices and lines in application memory; revisit only when measured volume makes this material.
- Invoice-line accounting codes are stored as strings. Revisit rename implications if CoA code renaming is introduced.

They are not MVP blockers and are not implementation work in this documentation pass. See [Future Ideas](FUTURE_IDEAS.md).

## 9. Boundaries That Are Already Healthy

- **Active company:** `active-company.ts` centralizes cookie validation and resolution. It never silently creates a company; the company APIs and selection component provide the explicit creation/selection path.
- **Document storage:** upload, read, and delete callers use `document-storage.ts`; backend selection is transparent. S3 object keys are company-scoped, while local deletion uses a path-safety guard.
- **Decimal arithmetic:** `decimal.ts` and invoice validation helpers centralize monetary parsing, comparison, rounding, and base conversion.
- **Invoice-line invariants:** normalization, fallback numbering, empty-line semantics, recognition validation, account validation, and reconciliation are shared helpers and rechecked server-side before persistence/approval.
- **AI boundary:** AI is on demand, optional, company-scoped, schema-validated, reconciled before preview, and separated into extract → preview/apply → save stages.
- **Recognition:** the Immediate/Prepaid schedule is a pure helper consumed by Budget actual aggregation.
- **Payment status:** one persisted invoice field is canonical; Cash Forecast is a read-only consumer.
- **Budget mapping:** mapping writes validate account suitability, while the report's approved-Invoice dependency stays read-only.

## 10. Final Product-Level Verdict

FinanceD is a modular monolith in practice and that remains appropriate for the MVP. Logical ownership is clear, shared infrastructure is deliberate, and the PostgreSQL database is the integration boundary.

The intentional dependencies are healthy: all modules use Companies for scope; Invoices reference AP master data; Cash Forecast reads unpaid invoices; Budget reads approved invoice lines; Vendor merge performs a controlled data-quality rewrite. The dependency to watch as the product grows remains Budget → Invoices because report quality and eventual performance depend on invoice-line accounting and recognition data.

Nothing in this focused architecture update blocks continued product development. Future observations should remain demand-led rather than becoming speculative architecture work.

---

`origin/main 2d47180e640766183084fe1cc3e153bda0d237fb` · 2026-08-21
