CREATE TYPE "public"."reconciliation_match_status" AS ENUM('matched', 'unmatched', 'ambiguous');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_source" AS ENUM('player_ledger', 'psp_transactions');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_transaction_type" AS ENUM('deposit', 'withdrawal');--> statement-breakpoint
CREATE TABLE "reconciliation_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"source_kind" "reconciliation_source" NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'parsed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_reconciliation_import_company_source_hash" UNIQUE("company_id","source_kind","content_hash")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"player_transaction_id" integer NOT NULL,
	"psp_transaction_id" integer NOT NULL,
	"match_reason" varchar(255) NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "match_player_transaction_unique" UNIQUE("run_id","player_transaction_id"),
	CONSTRAINT "match_psp_transaction_unique" UNIQUE("run_id","psp_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_run_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"transaction_id" integer NOT NULL,
	"match_status" "reconciliation_match_status" DEFAULT 'unmatched' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_reconciliation_run_item" UNIQUE("run_id","transaction_id")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"player_ledger_import_id" integer NOT NULL,
	"psp_import_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_reconciliation_run_company_import_pair" UNIQUE("company_id","player_ledger_import_id","psp_import_id")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"import_id" integer NOT NULL,
	"source" "reconciliation_source" NOT NULL,
	"external_id" varchar(255),
	"player_id" varchar(255),
	"transaction_type" "reconciliation_transaction_type" NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"currency" varchar(20) NOT NULL,
	"event_date" varchar(10),
	"reference" text,
	"status" varchar(50),
	"status_provided" boolean DEFAULT false NOT NULL,
	"match_status" "reconciliation_match_status" DEFAULT 'unmatched' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_transaction_amount_nonnegative" CHECK ("reconciliation_transactions"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reconciliation_imports" ADD CONSTRAINT "reconciliation_imports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_player_transaction_id_reconciliation_transactions_id_fk" FOREIGN KEY ("player_transaction_id") REFERENCES "public"."reconciliation_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_psp_transaction_id_reconciliation_transactions_id_fk" FOREIGN KEY ("psp_transaction_id") REFERENCES "public"."reconciliation_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_run_items" ADD CONSTRAINT "reconciliation_run_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_run_items" ADD CONSTRAINT "reconciliation_run_items_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_run_items" ADD CONSTRAINT "reconciliation_run_items_transaction_id_reconciliation_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."reconciliation_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_player_ledger_import_id_reconciliation_imports_id_fk" FOREIGN KEY ("player_ledger_import_id") REFERENCES "public"."reconciliation_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_psp_import_id_reconciliation_imports_id_fk" FOREIGN KEY ("psp_import_id") REFERENCES "public"."reconciliation_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_transactions" ADD CONSTRAINT "reconciliation_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_transactions" ADD CONSTRAINT "reconciliation_transactions_import_id_reconciliation_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."reconciliation_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_player_psp_unique" ON "reconciliation_matches" USING btree ("run_id","player_transaction_id","psp_transaction_id");