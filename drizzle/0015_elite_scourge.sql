CREATE TYPE "public"."payment_account_type" AS ENUM('psp', 'wallet', 'exchange', 'bank', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_balance_direction" AS ENUM('credit', 'debit', 'none');--> statement-breakpoint
CREATE TYPE "public"."payment_event_type" AS ENUM('deposit', 'withdrawal', 'refund', 'chargeback', 'fee', 'adjustment', 'settlement', 'transfer', 'reserve_hold', 'reserve_release', 'conversion', 'unknown');--> statement-breakpoint
CREATE TABLE "payment_account_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"payment_account_id" integer NOT NULL,
	"asset_code" varchar(20) NOT NULL,
	"asset_type" "currency_type" NOT NULL,
	"opening_available_balance" numeric(38, 18) DEFAULT '0' NOT NULL,
	"opening_reserve_balance" numeric(38, 18) DEFAULT '0' NOT NULL,
	"opening_balance_date" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_payment_account_asset" UNIQUE("payment_account_id","asset_code")
);
--> statement-breakpoint
CREATE TABLE "payment_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"provider_name" varchar(255),
	"account_type" "payment_account_type" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_payment_account_company_name" UNIQUE("company_id","name")
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"payment_account_id" integer NOT NULL,
	"import_id" integer NOT NULL,
	"source_row_number" integer NOT NULL,
	"source_row_id" varchar(255),
	"external_id" varchar(255),
	"reference" text,
	"event_date" varchar(10) NOT NULL,
	"event_type" "payment_event_type" NOT NULL,
	"balance_direction" "payment_balance_direction" NOT NULL,
	"balance_amount" numeric(38, 18) NOT NULL,
	"balance_asset_code" varchar(20) NOT NULL,
	"balance_asset_type" "currency_type" NOT NULL,
	"source_amount" numeric(38, 18),
	"source_asset_code" varchar(20),
	"source_asset_type" "currency_type",
	"actual_fee_amount" numeric(38, 18),
	"actual_fee_asset_code" varchar(20),
	"expected_fx_rate" numeric(38, 18),
	"reported_available_balance" numeric(38, 18),
	"reported_reserve_balance" numeric(38, 18),
	"expected_release_date" varchar(10),
	"destination_account_id" integer,
	"destination_amount" numeric(38, 18),
	"destination_asset_code" varchar(20),
	"destination_asset_type" "currency_type",
	"expected_destination_amount" numeric(38, 18),
	"expected_destination_rate" numeric(38, 18),
	"related_event_id" integer,
	"status" varchar(50),
	"status_provided" boolean DEFAULT false NOT NULL,
	"raw_identifiers" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_payment_event_import_row" UNIQUE("import_id","source_row_number"),
	CONSTRAINT "payment_event_magnitude_nonnegative" CHECK ("payment_events"."balance_amount" >= 0),
	CONSTRAINT "payment_event_source_nonnegative" CHECK ("payment_events"."source_amount" is null or "payment_events"."source_amount" >= 0),
	CONSTRAINT "payment_event_fee_nonnegative" CHECK ("payment_events"."actual_fee_amount" is null or "payment_events"."actual_fee_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_fee_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"payment_account_id" integer NOT NULL,
	"event_type" "payment_event_type" NOT NULL,
	"asset_code" varchar(20),
	"percentage_rate" numeric(38, 18) DEFAULT '0' NOT NULL,
	"fixed_amount" numeric(38, 18) DEFAULT '0' NOT NULL,
	"fixed_asset_code" varchar(20),
	"effective_from" varchar(10) NOT NULL,
	"effective_to" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_fee_rule_nonnegative" CHECK ("payment_fee_rules"."percentage_rate" >= 0 and "payment_fee_rules"."fixed_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_reserve_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"payment_account_id" integer NOT NULL,
	"asset_code" varchar(20),
	"reserve_percentage" numeric(38, 18),
	"hold_period_days" integer,
	"effective_from" varchar(10) NOT NULL,
	"effective_to" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reserve_rule_valid" CHECK (("payment_reserve_rules"."reserve_percentage" is null or "payment_reserve_rules"."reserve_percentage" >= 0) and ("payment_reserve_rules"."hold_period_days" is null or "payment_reserve_rules"."hold_period_days" >= 0))
);
--> statement-breakpoint
CREATE TABLE "reconciliation_payment_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"player_transaction_id" integer NOT NULL,
	"payment_event_id" integer NOT NULL,
	"match_reason" varchar(255) NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_match_player_unique" UNIQUE("run_id","player_transaction_id"),
	CONSTRAINT "payment_match_event_unique" UNIQUE("run_id","payment_event_id")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_payment_run_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"payment_event_id" integer NOT NULL,
	"match_status" "reconciliation_match_status" DEFAULT 'unmatched' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_reconciliation_payment_run_item" UNIQUE("run_id","payment_event_id")
);
--> statement-breakpoint
ALTER TABLE "reconciliation_imports" ADD COLUMN "payment_account_id" integer;--> statement-breakpoint
ALTER TABLE "payment_account_assets" ADD CONSTRAINT "payment_account_assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_account_assets" ADD CONSTRAINT "payment_account_assets_payment_account_id_payment_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."payment_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_account_id_payment_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."payment_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_import_id_reconciliation_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."reconciliation_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_destination_account_id_payment_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."payment_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_related_event_id_payment_events_id_fk" FOREIGN KEY ("related_event_id") REFERENCES "public"."payment_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fee_rules" ADD CONSTRAINT "payment_fee_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fee_rules" ADD CONSTRAINT "payment_fee_rules_payment_account_id_payment_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."payment_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reserve_rules" ADD CONSTRAINT "payment_reserve_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reserve_rules" ADD CONSTRAINT "payment_reserve_rules_payment_account_id_payment_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."payment_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_payment_matches" ADD CONSTRAINT "reconciliation_payment_matches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_payment_matches" ADD CONSTRAINT "reconciliation_payment_matches_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_payment_matches" ADD CONSTRAINT "reconciliation_payment_matches_player_transaction_id_reconciliation_transactions_id_fk" FOREIGN KEY ("player_transaction_id") REFERENCES "public"."reconciliation_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_payment_matches" ADD CONSTRAINT "reconciliation_payment_matches_payment_event_id_payment_events_id_fk" FOREIGN KEY ("payment_event_id") REFERENCES "public"."payment_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_payment_run_items" ADD CONSTRAINT "reconciliation_payment_run_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_payment_run_items" ADD CONSTRAINT "reconciliation_payment_run_items_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_payment_run_items" ADD CONSTRAINT "reconciliation_payment_run_items_payment_event_id_payment_events_id_fk" FOREIGN KEY ("payment_event_id") REFERENCES "public"."payment_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_imports" ADD CONSTRAINT "reconciliation_imports_payment_account_id_payment_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."payment_accounts"("id") ON DELETE no action ON UPDATE no action;