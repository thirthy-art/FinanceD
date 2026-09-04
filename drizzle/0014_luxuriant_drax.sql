CREATE TYPE "public"."cash_forecast_category" AS ENUM('customer_receipts', 'financing_inflow', 'other_inflow', 'payroll', 'tax_vat', 'rent', 'debt_service', 'other_outflow');--> statement-breakpoint
CREATE TYPE "public"."cash_forecast_direction" AS ENUM('inflow', 'outflow');--> statement-breakpoint
CREATE TABLE "cash_forecast_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"date" varchar(10) NOT NULL,
	"description" varchar(200) NOT NULL,
	"direction" "cash_forecast_direction" NOT NULL,
	"category" "cash_forecast_category" NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cash_forecast_item_amount_nonnegative" CHECK ("cash_forecast_items"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cash_forecast_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"opening_cash_balance" numeric(18, 4) DEFAULT '0' NOT NULL,
	"minimum_cash_buffer" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cash_forecast_settings_company" UNIQUE("company_id"),
	CONSTRAINT "cash_forecast_settings_minimum_buffer_nonnegative" CHECK ("cash_forecast_settings"."minimum_cash_buffer" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cash_forecast_items" ADD CONSTRAINT "cash_forecast_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_forecast_settings" ADD CONSTRAINT "cash_forecast_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;