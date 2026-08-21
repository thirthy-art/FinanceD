# FinanceD

FinanceD is modular pre-accounting and cash-visibility software for SMEs. The current MVP covers company-scoped supplier invoices, vendors, chart of accounts, cost centres, Cash Forecast / payables, and Budget v1. It is not a general ledger or full ERP.

## Supplier invoice workflow

1. Create or select a company and its configurable base currency.
2. Upload a supplier invoice as PDF, JPEG, PNG, TIFF, or WebP. The immutable original is stored through the document-storage abstraction.
3. FinanceD extracts embedded PDF text or runs local image OCR and proposes initial fields. Optional AI extraction uses PDF text first for born-digital PDFs and vision for images or scanned PDFs; **Try image AI** explicitly renders a PDF for vision processing.
4. Review the preview, explicitly apply desired AI suggestions, and edit the invoice header and lines. Blank line numbers receive 1-based positional numbers; an invoice-level signed line-net adjustment can reconcile line net totals without changing header or line amounts.
5. Save a draft or approve after server validation. Track the invoice as paid or unpaid, view the original, and export invoice or payable data.

AI results are suggestions only: extraction does not persist invoice changes until the user applies them and saves.

## Stack

- Next.js 16 App Router, React 19, and TypeScript
- PostgreSQL with Drizzle ORM and versioned migrations
- Tailwind CSS
- `decimal.js` for monetary arithmetic
- Local or S3-compatible document storage (the deployed target supports Cloudflare R2)
- Optional OpenAI-compatible AI extraction provider

## Local setup

Prerequisites: Node.js 22 (see `.nvmrc`) and PostgreSQL.

```bash
nvm use
npm install
cp .env.example .env
# Set DATABASE_URL and any optional storage/AI configuration.
npm run db:migrate
npm run db:seed # optional, idempotent demo data
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production needs a PostgreSQL `DATABASE_URL`, a durable document-storage configuration, and—only if AI extraction is enabled—an AI provider key, endpoint, and model. See [Operations](docs/OPERATIONS.md) for the exact repository-supported variables and migration procedure.

## Data and storage policies

- PostgreSQL is the source of truth for business records. Original document metadata is stored in PostgreSQL; binary files are stored through `src/lib/document-storage.ts` using local disk or an S3-compatible backend.
- Original-currency amounts and FX rates use decimal strings with up to 18 decimal places; base-currency amounts use 4 decimal places. Monetary arithmetic uses `decimal.js`, never JavaScript floating point.
- Each invoice stores its own FX rate in the direction `1 invoice currency unit = fxRateToBase base currency units`. Rates are never auto-refreshed.

## Documentation

- [MVP status](docs/MVP_STATUS.md)
- [Operations runbook](docs/OPERATIONS.md)
- [Architecture map](docs/FinanceD_Architecture_Map.md)
- [Future ideas](docs/FUTURE_IDEAS.md)
