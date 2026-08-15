CREATE TYPE "public"."recognition_treatment" AS ENUM('Immediate', 'Prepaid');--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD COLUMN "recognition_treatment" "recognition_treatment" DEFAULT 'Immediate' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD COLUMN "recognition_start_date" varchar(10);--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD COLUMN "recognition_end_date" varchar(10);--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD COLUMN "accounting_account_number" varchar(50);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "external_vendor_number" varchar(100);