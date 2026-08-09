# FinanceD

Supplier invoice capture and review application.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env with your database URL

# 3. Push schema to database
npm run db:push

# 4. Seed initial data (chart of accounts, cost centres)
npx tsx src/db/seed.ts

# 5. Run development server
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
