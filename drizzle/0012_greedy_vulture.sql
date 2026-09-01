CREATE TYPE "public"."vendor_status" AS ENUM('draft', 'active');--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "vendor_status" "vendor_status" DEFAULT 'active' NOT NULL;