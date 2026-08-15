ALTER TABLE "chart_of_accounts" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD COLUMN "is_posting" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "normalized_tax_id" varchar(50);--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_parent_id_chart_of_accounts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
WITH normalized AS (
  SELECT
    "id",
    "company_id",
    regexp_replace(upper(trim("tax_id")), '[^A-Z0-9]', '', 'g') AS "value"
  FROM "vendors"
  WHERE "tax_id" IS NOT NULL
), candidates AS (
  SELECT
    "id",
    "value",
    count(*) OVER (PARTITION BY "company_id", "value") AS "occurrences"
  FROM normalized
  WHERE "value" <> ''
)
UPDATE "vendors"
SET "normalized_tax_id" = candidates."value"
FROM candidates
WHERE "vendors"."id" = candidates."id"
  AND candidates."occurrences" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vendors_company_normalized_tax_id" ON "vendors" USING btree ("company_id","normalized_tax_id") WHERE "vendors"."normalized_tax_id" is not null;
