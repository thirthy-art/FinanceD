# FinanceD — Architecture Rules

## Stack
- Next.js (App Router), TypeScript, PostgreSQL, Drizzle ORM, Tailwind
- One repository, one Next.js app, no monorepo, no microservices
- Business areas live in `src/modules/`; shared DB and utils in `src/db/` and `src/lib/`

## Principles
- Add a dependency only when it solves a concrete current requirement
- No authentication beyond what a local single-user app needs
- AI is optional assistance, never required

## Accounting invariants
- Money fields: `numeric(18,2)` — never floating point
- Foreign currency: store original amount + FX rate + base amount + rate source
- Every future journal entry must satisfy debit = credit; reject unbalanced entries
- Original source documents are immutable
- Post-approval corrections use reversal + repost, not silent history rewrites

## Chart of Accounts
- Neutral account codes — no country-specific statutory plan
- User-configurable: add / edit / deactivate accounts

## Current scope (Milestone 1)
Supplier invoice capture only. Not implemented:
cash-flow, forecast, budget, customer invoices, petty cash, payment matching,
bank reconciliation, accounting export, multi-user auth, AI extraction.
