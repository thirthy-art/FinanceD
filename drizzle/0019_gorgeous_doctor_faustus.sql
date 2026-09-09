CREATE TABLE "company_access_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"normalized_email" varchar(320) NOT NULL,
	"claimed_by_user_id" text,
	"claimed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_company_access_invites_company_email" UNIQUE("company_id","normalized_email")
);
--> statement-breakpoint
ALTER TABLE "company_access_invites" ADD CONSTRAINT "company_access_invites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_access_invites" ADD CONSTRAINT "company_access_invites_claimed_by_user_id_auth_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;