# FinanceD Operations

Practical runbook for the repository state at `2d47180e640766183084fe1cc3e153bda0d237fb`.

## Local development

Prerequisites are Node.js 22 (`.nvmrc`; `package.json` requires Node 22 or newer) and PostgreSQL.

```bash
nvm use
npm install
cp .env.example .env
# Configure DATABASE_URL.
npm run db:migrate
npm run db:seed # optional; idempotent demo data
npm run dev
```

The development application is served at `http://localhost:3000` by default. Do not commit `.env` or secrets.

## Database migrations

- Drizzle schema changes are represented by versioned SQL migrations under `drizzle/`.
- Generate a migration after an intentional schema change with `npm run db:generate`, then review the generated SQL.
- Apply committed migrations with:

  ```bash
  npm run db:migrate
  ```

- `src/db/migrate.ts` reads `DATABASE_URL` and runs the versioned migration folder.
- Do not use manual production column additions/removals in Neon as the normal deployment process. Production schema changes must flow through reviewed, versioned migrations and the configured migration/deployment workflow.
- `npm run build` runs `next build`; it does **not** imply `npm run db:migrate`.

No Render manifest, deployment workflow, or production migration command is represented in this repository. Verify in Render that the deployed service uses the intended build/start commands and that an explicit, controlled step applies `npm run db:migrate` against the production `DATABASE_URL`.

## Environment configuration

The exact variables documented by `.env.example` are:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `DOCUMENT_STORAGE_BACKEND` | No; defaults to `local` | `local` or `s3`. |
| `UPLOAD_DIR` | Local backend only; defaults to `./uploads` | Local binary-document directory. |
| `DOCUMENT_STORAGE_S3_ENDPOINT` | S3 backend | S3-compatible endpoint. |
| `DOCUMENT_STORAGE_S3_REGION` | S3 backend | Region; example default is `auto`. |
| `DOCUMENT_STORAGE_S3_BUCKET` | S3 backend | Bucket name. |
| `DOCUMENT_STORAGE_S3_ACCESS_KEY_ID` | S3 backend | Access key identifier. |
| `DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY` | S3 backend | Secret access key. |
| `AI_API_KEY` | AI only | Preferred provider credential. |
| `AI_BASE_URL` | AI only | Preferred OpenAI-compatible base URL. |
| `AI_MODEL` | AI only | Preferred model name. |
| `AI_SETTINGS_ENCRYPTION_KEY` | Runtime AI settings only | Base64-encoded 32-byte deployment master key used for AES-256-GCM encryption of provider keys stored in PostgreSQL. |
| `AI_SETTINGS_ADMIN_SECRET` | Runtime AI settings control plane | Separate high-entropy deployment secret used to authorize access to `/settings/ai` and its APIs. It is not persisted. |
| `MIMO_API_KEY` | AI fallback config name | Backward-compatible credential name. |
| `MIMO_BASE_URL` | AI fallback config name | Backward-compatible base URL. |
| `MIMO_MODEL` | AI fallback config name | Backward-compatible model name. |

Never place actual values for credentials, connection strings, bucket identifiers, or account details in documentation or source control.

## Document storage

`src/lib/document-storage.ts` is the storage boundary used by upload, viewing, extraction, and deletion.

- With `DOCUMENT_STORAGE_BACKEND=local`, files are written under `UPLOAD_DIR`. This is suitable for local development only unless the host volume is deliberately durable and backed up.
- With `DOCUMENT_STORAGE_BACKEND=s3`, the application uses the configured S3-compatible endpoint and stores company-scoped keys under `companies/{companyId}/invoice-documents/`. Database rows retain an opaque `object:` reference.
- Cloudflare R2 is the current production target and is S3-compatible. The repository does not contain the live R2 bucket, credentials, lifecycle policy, EU-jurisdiction setting, or Render environment values; verify them externally.
- PostgreSQL document metadata and the corresponding binary object must be treated as one recoverable record. Database-only recovery does not restore missing binaries.

## AI provider configuration

AI extraction is optional. Core upload, local PDF text extraction / image OCR, heuristic prefill, manual review, and saving continue without an AI key. If no key is configured, the on-demand AI route returns a configuration error rather than blocking upload.

The deployment-global `/settings/ai` page configures a fixed provider chain: MiMo Direct, OpenRouter using the first fallback model, and an optional second OpenRouter model. The provider endpoints are built in. Set a separate high-entropy `AI_SETTINGS_ADMIN_SECRET` in Render to protect this page and its settings APIs with a short-lived HttpOnly authorization cookie. If the admin secret is absent, the settings control plane fails closed while invoice extraction continues to use any existing database or environment provider configuration. Runtime provider keys are encrypted before persistence with AES-256-GCM; set `AI_SETTINGS_ENCRYPTION_KEY` to a base64-encoded 32-byte secret in Render environment configuration and never commit its value. Losing or replacing this master key makes previously stored provider keys unreadable, so handle rotation as an explicit operational change.

The legacy OpenAI-compatible `AI_*` and `MIMO_*` variables remain bootstrap fallbacks. They are used when no runtime settings row exists, and their MiMo credential remains available when the first runtime save changes only the model. This prevents a settings migration from disabling a working deployment. A provider key entered in the browser is sent only to the server, encrypted before storage, and is never returned by settings APIs.

For normal extraction:

- a born-digital PDF with usable stored text sends text to the provider;
- JPEG, PNG, and WebP documents send image input;
- a PDF without usable text is rendered page-by-page and sent as images;
- **Try image AI** adds `mode=image` and forces the PDF image path even when extracted text exists;
- structured output is schema-validated and deterministically arithmetic-reconciled before preview.

The result is returned to client-side preview state. The user must explicitly apply it and then save; extraction alone does not persist header or line changes. Do not log provider keys or document payloads.

## Backups and recovery notes

No automated backup orchestration or restore procedure is defined in this repository.

- **PostgreSQL:** verify Neon backup/restore or point-in-time recovery settings externally and test the chosen recovery process. A database restore contains business records and document references, not R2/local binary content.
- **Invoice documents:** verify R2 durability, retention/lifecycle, and recovery controls externally. For local storage, back up the configured `UPLOAD_DIR` separately if the data matters.
- **Application deploy:** Git history and the pinned application commit reconstruct application code and versioned migrations. External Render environment variables and service configuration require separate controlled records.

Coordinate database and object recovery to a compatible point where possible, then check that document references resolve through the application.

## Useful operational checks

```bash
npm run build       # production compilation
npx tsc --noEmit    # TypeScript check
npm test -- <path>  # focused test selection when relevant
npm run db:migrate  # apply versioned migrations to the configured database
```

Also confirm that `DATABASE_URL` targets the intended database, the selected storage backend has all required variables, an S3/R2 object can be written and read through the application, and AI variables are present only when AI extraction is intended.
