CREATE TYPE "public"."payment_status" AS ENUM('Unpaid', 'Paid');--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "payment_status" "payment_status" DEFAULT 'Unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "paid_date" varchar(10);