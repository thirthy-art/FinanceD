# FinanceD — Architecture Rules

## Product
FinanceD is modular pre-accounting and cash-visibility software for SMEs. It is not a full ERP or accounting ledger.

## V1 Scope
Supplier and customer invoices, payments and allocations, petty cash, cash visibility, monthly forecast and budget, OCR/LLM-assisted document extraction, accounting-compatible exports.

Not in V1: internal double-entry ledger, journal posting, period closing, reversal/repost workflows, controls & reconciliation, multi-user permissions, multi-company administration.

## Stack
- Next.js (App Router), TypeScript, PostgreSQL, Drizzle ORM, Tailwind
- One repository, one Next.js app, no monorepo, no microservices

## Central Database
- PostgreSQL is the single source of truth
- Future business modules communicate only through the database
- No direct imports or calls between business modules
- No X → Y → Z module dependency chains
- No event bus, dependency-injection framework, or repository abstraction
- Removing a module's UI/code must not cascade into unrelated business code
- The central schema remains available regardless of which modules are enabled
- Modules may read the central schema directly; each writes only its own records

## Monetary Values
- Monetary values are decimal strings, never JavaScript floating-point numbers
- Original-currency amounts: `numeric(38,18)` — supports crypto with up to 18 decimal places
- Base-currency amounts: `numeric(18,4)` — company base currency is always fiat
- FX rates: `numeric(38,18)`
- Use `decimal.js` (configured in `src/lib/decimal.ts`) for all application-side arithmetic
- Do not use `Number()`, `parseFloat()`, `parseInt()`, or `Math.*` on monetary values
- Do not convert crypto values to integer cents
- Currency/asset codes: `varchar(20)` — accommodates crypto symbols longer than 3 chars
- Each invoice stores its own `currencyType` (`fiat` or `crypto`) for validation and display

## FX Rates
- Each invoice owns its saved FX rate (`fxRateToBase`)
- Direction: 1 unit of invoice currency = fxRateToBase units of company base currency
- Base amount = original amount × fxRateToBase
- If invoice currency equals company base currency, fxRateToBase is set to "1"
- If invoice currency differs, fxRateToBase is left null until the user provides it
- Saved rates are never automatically refreshed or overwritten
- Market rates are never fetched automatically
- Invoices on the same date can have different rates
- Changing a rate recalculates only base amounts, never original amounts
- Changing a rate does not change the invoice status

## Invoice Behaviour
- OCR/LLM extraction results are suggestions only — never auto-approve
- The user explicitly approves each invoice
- Approved invoices remain manually editable
- Valid edits do not require reapproval or a modification reason
- Due date is optional
- Original uploaded documents are immutable

## Validation
- Fiat: net + VAT must equal gross within 0.01 tolerance (per-line rounding)
- Crypto: net + VAT must equal gross exactly (no tolerance)
- All arithmetic uses `decimal.js`, never floating-point
- Invalid nonblank decimal input returns a controlled 400/422 error, never a DB 500
- Blank optional monetary fields become null, not "0"
- fxRateToBase, when present, must be greater than zero
- Ambiguous decimal formats (e.g. "1,234") are rejected with a request for correction

## Approval Requirements
- Approval requires: vendor, invoice number, invoice date, currency, net amount, VAT amount (including valid zero), gross amount, attached source document
- Foreign-currency invoices also require a positive FX rate
- Due date is optional
- A meaningless empty invoice cannot be approved
- Vendor creation and invoice update are wrapped in a DB transaction
- An approved→draft downgrade via the ordinary edit form is blocked

## Database & Migrations
- Versioned migrations via Drizzle (`npm run db:migrate`)
- Do not use `drizzle-kit push` after initial setup
- Seed is idempotent (`npm run db:seed`)

## Rounding
- Base-amount conversion (original × fxRateToBase → 4dp) uses `ROUND_HALF_UP`
- Rounding is applied explicitly via a local argument, not through a global Decimal config
- The rounding constant is exported from `src/lib/decimal.ts` as `BASE_ROUNDING`

## Development Workflow
- Never commit or push directly to `main`
- Start from the latest `main`; work in an isolated task or review branch
- Run verification (test, lint, build) before committing
- Commit and push only the review branch
- Do not merge into `main` without explicit owner approval
- Destructive database changes require explicit owner approval
- Preserve existing behaviour outside the approved task scope
- No speculative enterprise workflow or features
