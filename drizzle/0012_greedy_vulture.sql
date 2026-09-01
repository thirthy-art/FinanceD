DO $$
BEGIN
	IF to_regtype('public.vendor_status') IS NULL THEN
		CREATE TYPE "public"."vendor_status" AS ENUM('draft', 'active');
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "vendor_status" "vendor_status" DEFAULT 'active' NOT NULL;
