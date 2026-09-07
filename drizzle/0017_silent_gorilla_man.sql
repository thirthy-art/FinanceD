ALTER TYPE "public"."payment_ingestion_source" ADD VALUE 'manual';--> statement-breakpoint
CREATE TABLE "payment_import_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"import_id" integer NOT NULL,
	"payment_event_id" integer NOT NULL,
	"source_row_number" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_payment_import_event" UNIQUE("import_id","payment_event_id"),
	CONSTRAINT "uq_payment_import_source_row" UNIQUE("import_id","source_row_number")
);
--> statement-breakpoint
DROP INDEX "uq_payment_balance_snapshot_provider_id";--> statement-breakpoint
ALTER TABLE "payment_events" ADD COLUMN "related_payment_account_id" integer;--> statement-breakpoint
ALTER TABLE "payment_import_events" ADD CONSTRAINT "payment_import_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_import_events" ADD CONSTRAINT "payment_import_events_import_id_reconciliation_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."reconciliation_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_import_events" ADD CONSTRAINT "payment_import_events_payment_event_id_payment_events_id_fk" FOREIGN KEY ("payment_event_id") REFERENCES "public"."payment_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_related_payment_account_id_payment_accounts_id_fk" FOREIGN KEY ("related_payment_account_id") REFERENCES "public"."payment_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "payment_import_events" ("company_id", "import_id", "payment_event_id", "source_row_number")
SELECT "company_id", "import_id", "id", "source_row_number"
FROM "payment_events"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "payment_events"
SET "related_payment_account_id" = "payment_account_id"
WHERE "related_provider_event_id" IS NOT NULL
  AND "event_type" = 'reserve_release'
  AND "related_payment_account_id" IS NULL;--> statement-breakpoint
UPDATE "payment_events" AS relationship
SET "related_event_id" = target."id"
FROM "payment_events" AS target
WHERE relationship."related_provider_event_id" IS NOT NULL
  AND target."company_id" = relationship."company_id"
  AND target."payment_account_id" = relationship."related_payment_account_id"
  AND target."provider_event_id" = relationship."related_provider_event_id";--> statement-breakpoint
UPDATE "payment_events" AS relationship
SET "related_event_id" = NULL
WHERE relationship."related_provider_event_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "payment_events" AS target
    WHERE target."company_id" = relationship."company_id"
      AND target."payment_account_id" = relationship."related_payment_account_id"
      AND target."provider_event_id" = relationship."related_provider_event_id"
  );--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_balance_snapshot_provider_id" ON "payment_balance_snapshots" USING btree ("company_id","payment_account_id","asset_code","provider_snapshot_id") WHERE "payment_balance_snapshots"."provider_snapshot_id" is not null;
