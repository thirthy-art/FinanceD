CREATE TABLE "budget_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_budget_category_company_name" UNIQUE("company_id","name")
);
--> statement-breakpoint
CREATE TABLE "budget_category_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"budget_category_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	CONSTRAINT "uq_budget_category_account" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "budget_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"budget_category_id" integer NOT NULL,
	"month" varchar(7) NOT NULL,
	"cost_centre_id" integer,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_actual_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"budget_category_id" integer NOT NULL,
	"month" varchar(7) NOT NULL,
	"cost_centre_id" integer,
	"amount" numeric(18, 2) NOT NULL,
	"description" varchar(500),
	"source" varchar(100) DEFAULT 'Manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_category_accounts" ADD CONSTRAINT "budget_category_accounts_budget_category_id_budget_categories_id_fk" FOREIGN KEY ("budget_category_id") REFERENCES "public"."budget_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_category_accounts" ADD CONSTRAINT "budget_category_accounts_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_budget_category_id_budget_categories_id_fk" FOREIGN KEY ("budget_category_id") REFERENCES "public"."budget_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_cost_centre_id_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."cost_centres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_actual_entries" ADD CONSTRAINT "budget_actual_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_actual_entries" ADD CONSTRAINT "budget_actual_entries_budget_category_id_budget_categories_id_fk" FOREIGN KEY ("budget_category_id") REFERENCES "public"."budget_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_actual_entries" ADD CONSTRAINT "budget_actual_entries_cost_centre_id_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."cost_centres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Partial unique indexes for budget_entries to correctly handle nullable cost_centre_id
CREATE UNIQUE INDEX "uq_budget_entry_no_cc" ON "budget_entries" ("company_id","budget_category_id","month") WHERE "cost_centre_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_budget_entry_with_cc" ON "budget_entries" ("company_id","budget_category_id","month","cost_centre_id") WHERE "cost_centre_id" IS NOT NULL;
