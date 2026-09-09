# FinanceD Operations

Practical runbook for FinanceD private-beta operations.

## Local development

Prerequisites are Node.js 22 (`.nvmrc`; `package.json` requires Node 22 or newer) and PostgreSQL.

```bash
nvm use
npm install
cp .env.example .env
# Configure DATABASE_URL, AUTH_SECRET, and at least one OAuth provider.
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
| `AUTH_SECRET` | Yes | High-entropy Auth.js signing/encryption secret. |
| `AUTH_URL` | Production | Canonical Auth.js origin. Set to `https://financedapp.concept.me.uk` on Render so OAuth starts and returns on the same host. |
| `AUTH_TRUST_HOST` | Render | Set to `true` so Auth.js accepts Render's forwarded host headers. |
| `AUTH_GOOGLE_ID` | Google login | Google OAuth client ID. |
| `AUTH_GOOGLE_SECRET` | Google login | Google OAuth client secret. |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Microsoft login | Microsoft Entra application/client ID. |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Microsoft login | Microsoft Entra client secret. |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | Microsoft login | Entra v2 issuer for the selected tenant/account policy. |
| `DOCUMENT_STORAGE_BACKEND` | No; defaults to `local` | `local` or `s3`. |
| `UPLOAD_DIR` | Local backend only; defaults to `./uploads` | Local binary-document directory. |
| `DOCUMENT_STORAGE_S3_ENDPOINT` | S3 backend | S3-compatible endpoint. |
| `DOCUMENT_STORAGE_S3_REGION` | S3 backend | Region; example default is `auto`. |
| `DOCUMENT_STORAGE_S3_BUCKET` | S3 backend | Bucket name. |
| `DOCUMENT_STORAGE_S3_ACCESS_KEY_ID` | S3 backend | Access key identifier. |
| `DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY` | S3 backend | Secret access key. |
| `AI_SETTINGS_ENCRYPTION_KEY` | Company AI settings | Base64-encoded 32-byte deployment master key used for AES-256-GCM encryption of company provider keys stored in PostgreSQL. |
| `AI_LEGACY_LOCAL_DEVELOPMENT` | No | Explicitly enables legacy environment AI credentials outside production only; keep unset/`false` on Render. |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | Local legacy mode only | Legacy OpenAI-compatible local development configuration. |
| `MIMO_API_KEY`, `MIMO_BASE_URL`, `MIMO_MODEL` | Local legacy mode only | Backward-compatible local development configuration names. |

Never place actual values for credentials, connection strings, bucket identifiers, or account details in documentation or source control.

Google's callback is `/api/auth/callback/google`; Microsoft's is `/api/auth/callback/microsoft-entra-id`. In production these resolve below the `AUTH_URL` origin, so provider redirect URIs must use `https://financedapp.concept.me.uk/api/auth/callback/<provider>` and must not use the Render service URL. A provider is enabled only when all of its documented variables are present. Auth.js identity, OAuth account, and database-session rows are persisted in PostgreSQL.

## Private-beta onboarding and removal

There is no invitation or user-administration UI. Run provisioning commands only in a trusted server/operations environment with `DATABASE_URL` configured.

Create a new client company and grant its first user access:

```bash
npm run auth:provision -- --company-name "Acme Ltd" --email alice@acme.com
```

The command refuses to create the company when a case-insensitive, whitespace-trimmed company name already exists. Use the reported existing company ID with the existing-company command instead; do not create a replacement company.

Grant another user access to an existing company:

```bash
npm run auth:grant -- --company-id 3 --email bob@acme.com
```

The company ID is authoritative and the command reports both its ID and name. If the normalized email already belongs to an Auth.js user, the command creates `company_members` immediately. Otherwise it creates an idempotent pending access record. After a successful OAuth/OIDC sign-in, FinanceD matches the provider-authenticated email, creates every explicitly invited membership, and marks those access records claimed. No company is created during sign-in, and an uninvited identity has no company access.

Both provisioning commands trim and lowercase email addresses without provider-specific rewriting. Repeating a grant cannot create duplicate effective access. Multiple users may belong to one company, and one user may be explicitly granted multiple companies.

Remove an existing user's company membership with `npm run auth:revoke -- <email> <companyId>`. This command requires an existing Auth.js user and company. These operator commands never expose an HTTP endpoint; `company_members` remains the application authorization source.

## Company access audit trail

`company_access_events` is the durable, append-only application history of company access administration. It records the company, a normalized email snapshot, an optional Auth.js user, an optional invite, the event type, the occurrence time, the actor category, and the application mechanism. Deleting a membership never deletes its events. User and invite deletion sets the corresponding event reference to null while retaining the normalized email and history. Company deletion is intentionally restricted by the event foreign key so ordinary lifecycle changes cannot silently erase company audit history.

The event types have one meaning each:

- `invite_created`: a new effective pending invitation was created.
- `invite_claimed`: a pending invitation was claimed for a persisted Auth.js user.
- `membership_granted`: a new `company_members` row created current access.
- `membership_revoked`: an existing `company_members` row was deleted.
- `membership_existing_at_audit_start`: the migration observed an already-existing membership when reliable auditing began; it is not a claim about the original grant time or mechanism.

Actors are deliberately abstract. `admin` means the generic administrative identity in FinanceD's current single-operator model; it does not identify an individual operator. `system` means an automatic application action. Mechanism is recorded separately: `operator_cli` identifies the trusted operator commands, `oauth_invite_claim` identifies automatic first-login claiming, and `audit_bootstrap` identifies the migration boundary.

The grant and invite flows are transactionally audited. A new pending record produces one `invite_created` event. Granting an existing Auth.js user creates `membership_granted` only when a membership is actually inserted. A successful OAuth/OIDC claim produces `invite_claimed` and, only when it creates access, `membership_granted`. Revocation produces `membership_revoked` only when an existing membership is actually deleted. Conflict-safe inserts, locked claims, mutation `RETURNING` results, and database constraints keep retries and concurrent attempts from producing misleading duplicate events.

Inspect history by company, normalized email, or both:

```bash
npm run auth:access-history -- --company-id 3
npm run auth:access-history -- --email alice@example.com
npm run auth:access-history -- --company-id 3 --email alice@example.com
```

The read-only report shows events, current access, and reconstructed access periods. `membership_granted` or `membership_existing_at_audit_start` opens a period; `membership_revoked` closes it; an open audited period with a current membership is shown through `present`.

Reliable access event auditing begins when migration `0020_chilly_archangel.sql` is deployed. Existing memberships are recorded as present at audit start with `actor = system` and `source = audit_bootstrap`. Their prior grant time, actor, invitation state, and mechanism are not inferred. The existing `company_members.created_at` value is not presented as an independently observed audit event.

`company_members` remains the sole source of truth for current company authorization. Pending invites and audit rows are observational records only: neither can authorize company data, and active-company resolution does not consult either table.

## Document storage

`src/lib/document-storage.ts` is the storage boundary used by upload, viewing, extraction, and deletion.

- With `DOCUMENT_STORAGE_BACKEND=local`, files are written under `UPLOAD_DIR`. This is suitable for local development only unless the host volume is deliberately durable and backed up.
- With `DOCUMENT_STORAGE_BACKEND=s3`, the application uses the configured S3-compatible endpoint and stores company-scoped keys under `companies/{companyId}/invoice-documents/`. Database rows retain an opaque `object:` reference.
- Cloudflare R2 is the current production target and is S3-compatible. The repository does not contain the live R2 bucket, credentials, lifecycle policy, EU-jurisdiction setting, or Render environment values; verify them externally.
- PostgreSQL document metadata and the corresponding binary object must be treated as one recoverable record. Database-only recovery does not restore missing binaries.

## AI provider configuration

AI extraction is optional. Core upload, local PDF text extraction / image OCR, heuristic prefill, manual review, and saving continue without an AI key. If no key is configured, the on-demand AI route returns a configuration error rather than blocking upload.

The `/settings/ai` page configures the active company's fixed provider chain: MiMo Direct, OpenRouter using the first fallback model, and an optional second OpenRouter model. Auth.js plus company membership is the sole authorization mechanism for these settings. Runtime provider keys are encrypted before persistence with AES-256-GCM; set `AI_SETTINGS_ENCRYPTION_KEY` to a base64-encoded 32-byte secret in Render environment configuration and never commit its value. Losing or replacing this master key makes previously stored provider keys unreadable, so handle rotation as an explicit operational change.

Production extraction reads only the active company's `company_ai_settings` row. A company without a key receives a not-configured response and cannot consume another company's key or a deployment-global key. Legacy `AI_*`/`MIMO_*` credentials work only outside production when `AI_LEGACY_LOCAL_DEVELOPMENT=true`; this is an explicit local-development compatibility path and must remain disabled on Render. A provider key entered in the browser is sent only to the server, encrypted before storage, and is never returned by settings APIs.

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
