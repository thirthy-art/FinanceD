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
ALTER TABLE "reconciliation_matches" DROP CONSTRAINT "match_player_transaction_unique";--> statement-breakpoint
ALTER TABLE "reconciliation_matches" DROP CONSTRAINT "match_psp_transaction_unique";--> statement-breakpoint
DROP INDEX "match_player_psp_unique";--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD COLUMN "run_id" integer;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD COLUMN "match_reason" varchar(255);--> statement-breakpoint
ALTER TABLE "reconciliation_transactions" ADD COLUMN "status_provided" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "reconciliation_transactions"
SET "amount" = abs("amount")
WHERE "amount" < 0;--> statement-breakpoint
UPDATE "reconciliation_transactions"
SET "status_provided" = true
WHERE "source" = 'psp_transactions' AND "status" IS NOT NULL;--> statement-breakpoint
INSERT INTO "reconciliation_runs" (
	"company_id", "player_ledger_import_id", "psp_import_id", "status", "created_at", "updated_at"
)
SELECT
	m."company_id", player_tx."import_id", psp_tx."import_id", 'completed', MIN(m."created_at"), now()
FROM "reconciliation_matches" m
INNER JOIN "reconciliation_transactions" player_tx
	ON player_tx."id" = m."player_transaction_id"
INNER JOIN "reconciliation_transactions" psp_tx
	ON psp_tx."id" = m."psp_transaction_id"
GROUP BY m."company_id", player_tx."import_id", psp_tx."import_id"
ON CONFLICT ("company_id", "player_ledger_import_id", "psp_import_id") DO NOTHING;--> statement-breakpoint
UPDATE "reconciliation_matches" m
SET
	"run_id" = r."id",
	"match_reason" = 'legacy deterministic identifier match'
FROM "reconciliation_transactions" player_tx,
	"reconciliation_transactions" psp_tx,
	"reconciliation_runs" r
WHERE player_tx."id" = m."player_transaction_id"
	AND psp_tx."id" = m."psp_transaction_id"
	AND r."company_id" = m."company_id"
	AND r."player_ledger_import_id" = player_tx."import_id"
	AND r."psp_import_id" = psp_tx."import_id";--> statement-breakpoint
INSERT INTO "reconciliation_run_items" ("company_id", "run_id", "transaction_id", "match_status")
SELECT r."company_id", r."id", t."id", t."match_status"
FROM "reconciliation_runs" r
INNER JOIN "reconciliation_transactions" t
	ON t."company_id" = r."company_id"
	AND (t."import_id" = r."player_ledger_import_id" OR t."import_id" = r."psp_import_id")
ON CONFLICT ("run_id", "transaction_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ALTER COLUMN "run_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ALTER COLUMN "match_reason" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_run_items" ADD CONSTRAINT "reconciliation_run_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_run_items" ADD CONSTRAINT "reconciliation_run_items_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_run_items" ADD CONSTRAINT "reconciliation_run_items_transaction_id_reconciliation_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."reconciliation_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_player_ledger_import_id_reconciliation_imports_id_fk" FOREIGN KEY ("player_ledger_import_id") REFERENCES "public"."reconciliation_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_psp_import_id_reconciliation_imports_id_fk" FOREIGN KEY ("psp_import_id") REFERENCES "public"."reconciliation_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_player_psp_unique" ON "reconciliation_matches" USING btree ("run_id","player_transaction_id","psp_transaction_id");--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "match_player_transaction_unique" UNIQUE("run_id","player_transaction_id");--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "match_psp_transaction_unique" UNIQUE("run_id","psp_transaction_id");--> statement-breakpoint
ALTER TABLE "reconciliation_transactions" ADD CONSTRAINT "reconciliation_transaction_amount_nonnegative" CHECK ("reconciliation_transactions"."amount" >= 0);
