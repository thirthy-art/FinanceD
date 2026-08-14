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
- Saved rates are never automatically refreshed or overwritten
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
- A meaningless empty invoice should not be approved, but due date is not required

## Database & Migrations
- Versioned migrations via Drizzle (`npm run db:migrate`)
- Do not use `drizzle-kit push` after initial setup
- Seed is idempotent (`npm run db:seed`)

## Development Workflow
- Work directly on `main`
- Do not create `claude/...` branches without explicit approval
- Preserve existing behaviour outside the approved task
- Run relevant verification (test, lint, build) before and after changes
- No speculative enterprise workflow or features
