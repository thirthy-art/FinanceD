CREATE TYPE "public"."payment_fee_basis" AS ENUM('source_amount', 'balance_amount');--> statement-breakpoint
CREATE TYPE "public"."payment_ingestion_source" AS ENUM('csv', 'xlsx', 'api');--> statement-breakpoint
CREATE TABLE "payment_balance_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"payment_account_id" integer NOT NULL,
	"asset_code" varchar(20) NOT NULL,
	"asset_type" "currency_type" NOT NULL,
	"reported_available_balance" numeric(38, 18) NOT NULL,
	"reported_reserve_balance" numeric(38, 18),
	"as_of" timestamp NOT NULL,
	"ingestion_source" "payment_ingestion_source" NOT NULL,
	"provider_snapshot_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reconciliation_imports" DROP CONSTRAINT "uq_reconciliation_import_company_source_hash";--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD COLUMN "client_funds_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "payment_accounts" SET "client_funds_eligible" = true WHERE "account_type" = 'psp';--> statement-breakpoint
ALTER TABLE "payment_events" ADD COLUMN "provider_event_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payment_events" ADD COLUMN "related_provider_event_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payment_events" ADD COLUMN "final_receipt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_fee_rules" ADD COLUMN "fee_basis" "payment_fee_basis" DEFAULT 'source_amount' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_fee_rules" ADD COLUMN "fee_asset_code" varchar(20);--> statement-breakpoint
ALTER TABLE "reconciliation_imports" ADD COLUMN "ingestion_source" "payment_ingestion_source";--> statement-breakpoint
ALTER TABLE "payment_balance_snapshots" ADD CONSTRAINT "payment_balance_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_balance_snapshots" ADD CONSTRAINT "payment_balance_snapshots_payment_account_id_payment_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."payment_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_balance_snapshot_provider_id" ON "payment_balance_snapshots" USING btree ("company_id","payment_account_id","provider_snapshot_id") WHERE "payment_balance_snapshots"."provider_snapshot_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_event_account_provider_id" ON "payment_events" USING btree ("company_id","payment_account_id","provider_event_id") WHERE "payment_events"."provider_event_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reconciliation_import_legacy_hash" ON "reconciliation_imports" USING btree ("company_id","source_kind","content_hash") WHERE "reconciliation_imports"."payment_account_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reconciliation_import_account_hash" ON "reconciliation_imports" USING btree ("company_id","source_kind","payment_account_id","content_hash") WHERE "reconciliation_imports"."payment_account_id" is not null;
