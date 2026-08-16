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

## Before Starting Work

Perform a lightweight Git preflight, not a full repository audit:

1. Confirm the current branch.
2. Confirm the worktree is clean, or report existing uncommitted changes before touching them.
3. Ensure new task work starts from current `main`.
4. If already on a task branch, inspect only its relevant diff against `main`.

Do not infer the repository's current state from an old chat, handoff, or previous agent report.

Do not inspect large portions of Git history unless repository state is genuinely ambiguous.

If the repository state is ambiguous, stop implementation and establish the actual state first.

## Development Workflow
- `main` is the canonical accepted baseline
- Never commit or push implementation work directly to `main`
- Start work from current `main` on an isolated task/review branch
- Prefer one active task branch when practical; temporary extra branches are acceptable for testing or recovery
- Keep changes scoped to the requested task
- Preserve existing behaviour outside the approved task scope
- Do not silently refactor unrelated areas
- Do not merge into `main` without explicit owner approval
- Destructive database changes require explicit owner approval
- Versioned migrations: `npm run db:migrate` — do not use `drizzle-kit push`
- Seed remains idempotent via `npm run db:seed`

After a branch is merged, validated, and contains no unique unmerged work, it may be deleted.

Do not keep branches indefinitely merely as historical archives; merged commits remain in Git history.

## UI Work
UI changes require owner visual validation before merge.

Tests, lint, and build are necessary where relevant but do not constitute visual acceptance.

For UI changes:
- preserve responsive behaviour outside the requested scope
- check affected desktop and mobile layouts
- do not fix unrelated UI issues discovered during the task
- report unrelated issues separately
- avoid touching shared components unless necessary
- if a shared component changes, verify its other known usages
- preserve browser pinch-to-zoom on mobile
- do not disable zoom with viewport restrictions unless explicitly requested
- provide a preview or screenshot for significant responsive changes before merge

## Regression Handling
If an unvalidated change reaches `main` and causes a regression:
- do not automatically stack speculative fixes on top
- identify the offending change
- preserve committed work through Git history or a temporary branch when needed
- evaluate revert versus an isolated forward fix
- remember that reverting a committed change does not erase the underlying commit from history

## Verification and Usage Discipline
Use verification proportional to the change.

- Run targeted tests for touched behaviour first
- Use broader tests for shared logic, schema, migrations, monetary logic, or cross-cutting changes
- Run lint/build where relevant before declaring the branch ready
- Do not add broad speculative test coverage unrelated to the task
- Avoid unnecessary hypothetical/theoretical defensive guards
- Avoid premature abstractions
- Avoid unrelated refactors
- Prefer the smallest implementation that correctly satisfies the current product requirement

## Documentation
`AGENTS.md` and `CLAUDE.md` contain durable repository rules.

Do not turn them into task handoffs or status reports.

Temporary branch names, pending validation, current feature progress, or other fast-changing task state belongs in the task/chat/PR, not these files.

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
```bash
npm run dev          # development server
npm test             # tests
npm run lint         # lint
npm run build        # production build
npm run db:generate  # generate new migration from schema changes
npm run db:migrate   # apply migrations
npm run db:seed      # seed demo data (idempotent)
```
