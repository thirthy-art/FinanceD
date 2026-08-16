ALTER TABLE "supplier_invoice_lines" ADD COLUMN "net_amount_derived" boolean NOT NULL DEFAULT false;
ALTER TABLE "supplier_invoice_lines" ADD COLUMN "vat_amount_derived" boolean NOT NULL DEFAULT false;
ALTER TABLE "supplier_invoice_lines" ADD COLUMN "gross_amount_derived" boolean NOT NULL DEFAULT false;
