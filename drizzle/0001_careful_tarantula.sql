CREATE TABLE "supplier_invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"position" integer NOT NULL,
	"line_number" varchar(100),
	"description_original" text,
	"description" text,
	"quantity" numeric(38, 18),
	"unit" varchar(100),
	"unit_price" numeric(38, 18),
	"net_amount" numeric(38, 18),
	"vat_rate" numeric(38, 18),
	"vat_amount" numeric(38, 18),
	"gross_amount" numeric(38, 18),
	"source_page" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_invoice_line_position" UNIQUE("invoice_id","position")
);
--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "upload_request_id" varchar(100);--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_upload_request_id_unique" UNIQUE("upload_request_id");