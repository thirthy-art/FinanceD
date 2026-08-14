<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# FinanceD — Agent Instructions

## Product
FinanceD is modular pre-accounting and cash-visibility software for SMEs. It is not a full ERP or accounting ledger.

## V1 Scope
Supplier and customer invoices, payments and allocations, petty cash, cash visibility, monthly forecast and budget, OCR/LLM-assisted document extraction, accounting-compatible exports.

Not in V1: internal double-entry ledger, journal posting, period closing, reversal/repost workflows, controls & reconciliation, multi-user permissions, multi-company administration.

## Stack
Next.js (App Router), TypeScript, PostgreSQL, Drizzle ORM, Tailwind. Single repository, single app.

## Architecture Rules
- PostgreSQL is the single source of truth
- Future business modules communicate only through the database — no direct imports between modules
- No X → Y → Z module dependency chains
- No microservices, event bus, or DI framework
- The central schema remains available regardless of which modules are enabled

## Monetary Safety (Critical)
- Monetary values are decimal strings throughout the entire stack — DB, API, UI
- Never use JavaScript `Number()`, `parseFloat()`, `Math.*`, or floating-point arithmetic on monetary values
- Use `decimal.js` (via `src/lib/decimal.ts`) for all monetary arithmetic
- Original amounts: `numeric(38,18)` — supports crypto with 18 decimal places
- Base amounts: `numeric(18,4)` — company base currency is fiat
- FX rates: `numeric(38,18)` per invoice, never auto-refreshed
- Currency codes: `varchar(20)` for crypto symbols
- `currencyType` enum (`fiat`/`crypto`) on each invoice governs validation tolerance and display

## FX Rate Rules
- Each invoice stores its own exchange rate
- Direction: 1 invoice currency unit = fxRateToBase base currency units
- Changing rate recalculates base amounts only, never original amounts
- Rate changes do not alter invoice status

## Invoice Behaviour
- OCR/LLM results are suggestions only
- Approved invoices remain editable; valid edits do not force reapproval
- Due date is optional
- Original documents are immutable

## Development
- Work on `main` unless explicitly directed otherwise
- Run `npm test`, `npm run lint`, `npm run build` before committing
- Versioned migrations: `npm run db:migrate` (do not use `drizzle-kit push`)
- Idempotent seed: `npm run db:seed`
- Preserve existing behaviour outside the approved task scope

## Setup
```bash
nvm use            # Node 22
npm install
cp .env.example .env   # set DATABASE_URL
npm run db:migrate
npm run db:seed
npm run dev
```

## Key Commands
```
npm run dev          # development server
npm test             # run tests
npm run lint         # lint
npm run build        # production build
npm run db:generate  # generate new migration from schema changes
npm run db:migrate   # apply migrations
npm run db:seed      # seed demo data (idempotent)
```
