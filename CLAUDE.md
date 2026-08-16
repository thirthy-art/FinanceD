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
- If invoice currency equals company base currency, fxRateToBase is set to `"1"`
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
- Blank optional monetary fields become null, not `"0"`
- fxRateToBase, when present, must be greater than zero
- Ambiguous decimal formats (e.g. `"1,234"`) are rejected with a request for correction

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

## Repository State and Git Workflow

`main` is the canonical accepted baseline for FinanceD.

Before implementation, perform a lightweight Git preflight:
- confirm the current branch
- confirm the worktree is clean, or report existing uncommitted changes before touching them
- ensure new task work starts from current `main`
- if already working on a task branch, inspect only the relevant difference between that branch and `main`

Do not perform a broad repository/history audit before every normal task.

Only expand into a broader Git/repository audit when the repository state is genuinely ambiguous, for example when:
- it is unclear what has been merged
- multiple branches contain potentially unique work
- the current branch has an unexpected history
- a regression cannot be attributed confidently
- a previous agent's reported state conflicts with the repository

The repository and Git history are the source of truth for implementation state. Do not infer current repository state from an old chat, handoff, task description, or previous agent report.

## Branch Discipline
- Never commit or push implementation work directly to `main`
- Start normal work from current `main` in an isolated task/review branch
- Prefer one active task branch at a time when practical
- Multiple temporary branches are acceptable when genuinely needed for testing, recovery, or isolated experiments
- Do not create speculative branches
- After a branch has been merged, validated, and contains no unique unmerged work, it may be deleted
- Keep an old branch only when it intentionally preserves unique unmerged work or a temporary recovery state
- Do not merge into `main` without explicit owner approval

## Regression and Recovery
If an unvalidated change reaches `main` and causes a regression:
- do not automatically pile additional speculative fixes onto `main`
- first establish what change caused the regression
- preserve existing work through Git history or a temporary branch if necessary
- evaluate whether revert or an isolated forward fix is safer
- do not treat a revert as loss of the underlying committed work

## UI and Responsive Changes
UI changes require human visual validation before merge.

Passing tests, lint, or build does not by itself mean a UI change is accepted.

For UI work:
- preserve existing responsive behaviour outside the requested scope
- test the affected view at relevant desktop and mobile widths
- do not make unrelated layout changes merely because another issue is noticed
- report unrelated UI issues separately
- avoid changing shared components unless the task actually requires it
- verify shared-component changes against their other known usages
- preserve normal browser pinch-to-zoom behaviour on mobile
- do not add `user-scalable=no`, restrictive `maximum-scale`, or equivalent zoom-blocking behaviour unless explicitly requested

For significant responsive/UI changes, provide a preview or screenshot for owner validation before merge.

## Testing and Usage Discipline
Verification should be proportional to the change.

- Run targeted tests for the touched behaviour first
- Run broader tests when shared logic, schema, migrations, money handling, or cross-cutting behaviour is affected
- Run lint/build where relevant before considering a branch ready
- Do not add large speculative test suites, premature abstractions, hypothetical defensive guards, or unrelated refactors
- Prefer a focused implementation that satisfies the current product requirement
- Preserve existing working behaviour outside the approved task scope

## Product Governance
- The product owner decides product behaviour and scope
- Do not invent product requirements to fill ambiguity when existing behaviour can be preserved
- Do not silently expand a narrow task into architecture work
- Shared accounting rules, money/currency handling, database conventions, and module interfaces must not be changed incidentally
- Destructive database changes require explicit owner approval
- No speculative enterprise workflow or features

## Documentation Role
`CLAUDE.md` and `AGENTS.md` contain durable repository rules and operating constraints.

They are not current-task handoffs.

Do not store temporary branch state, current implementation progress, pending validation notes, or other rapidly changing task status in these files.
