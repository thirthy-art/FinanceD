# FinanceD

Modular pre-accounting and cash-visibility software for SMEs.

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- PostgreSQL 15+

## Setup

```bash
# 1. Use correct Node version
nvm use

# 2. Install dependencies
npm install

# 3. Copy and configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL

# 4. Apply versioned migrations
npm run db:migrate

# 5. Seed demo data (idempotent — safe to run multiple times)
npm run db:seed

# 6. Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## What it does

1. Upload a supplier invoice as PDF or image (JPEG/PNG/TIFF/WebP)
2. Text is extracted automatically (embedded text for PDFs; OCR via tesseract.js for images)
3. Extracted fields are pre-filled in the review form
4. Edit any field, fix discrepancies, assign a vendor and expense account
5. Save as draft or approve the invoice

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `UPLOAD_DIR` | `./uploads` | Directory for storing uploaded documents |

## Commands

```
npm run dev          # development server
npm test             # run tests
npm run lint         # lint
npm run build        # production build
npm run db:generate  # generate new migration after schema changes
npm run db:migrate   # apply versioned migrations
npm run db:seed      # seed demo data (idempotent)
```

## Monetary precision

- Original-currency amounts support up to 18 decimal places (crypto-safe)
- Base-currency amounts use 4 decimal places (fiat)
- All monetary arithmetic uses `decimal.js` — never JavaScript floating-point
- Each invoice stores its own FX rate; rates are never auto-refreshed

## OCR support

| Input | Method |
|---|---|
| PDF with embedded text | `pdf-parse` (pure JS) |
| JPEG / PNG / TIFF image | `tesseract.js` (WASM) |
| Scanned PDF (no text) | Manual entry (graceful fallback) |

## Build for production

```bash
npm run build
npm start
```
