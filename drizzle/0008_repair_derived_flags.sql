ALTER TABLE "supplier_invoice_lines" ADD COLUMN IF NOT EXISTS "net_amount_derived" boolean NOT NULL DEFAULT false;
ALTER TABLE "supplier_invoice_lines" ADD COLUMN IF NOT EXISTS "vat_amount_derived" boolean NOT NULL DEFAULT false;
ALTER TABLE "supplier_invoice_lines" ADD COLUMN IF NOT EXISTS "gross_amount_derived" boolean NOT NULL DEFAULT false;
