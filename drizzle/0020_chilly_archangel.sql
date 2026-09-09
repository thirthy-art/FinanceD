CREATE TABLE "company_access_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"user_id" text,
	"normalized_email" varchar(320) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" varchar(16) NOT NULL,
	"source" varchar(64) NOT NULL,
	"invite_id" integer,
	CONSTRAINT "ck_company_access_events_event_type" CHECK ("company_access_events"."event_type" in ('invite_created', 'invite_claimed', 'membership_granted', 'membership_revoked', 'membership_existing_at_audit_start')),
	CONSTRAINT "ck_company_access_events_actor" CHECK ("company_access_events"."actor" in ('admin', 'system')),
	CONSTRAINT "ck_company_access_events_source" CHECK ("company_access_events"."source" in ('operator_cli', 'oauth_invite_claim', 'audit_bootstrap'))
);
--> statement-breakpoint
ALTER TABLE "company_access_events" ADD CONSTRAINT "company_access_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_access_events" ADD CONSTRAINT "company_access_events_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_access_events" ADD CONSTRAINT "company_access_events_invite_id_company_access_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."company_access_invites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_company_access_events_invite_event" ON "company_access_events" USING btree ("invite_id","event_type") WHERE "company_access_events"."invite_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_company_access_events_company_email_occurred" ON "company_access_events" USING btree ("company_id","normalized_email","occurred_at","id");--> statement-breakpoint
CREATE INDEX "idx_company_access_events_company_user_occurred" ON "company_access_events" USING btree ("company_id","user_id","occurred_at","id");--> statement-breakpoint
INSERT INTO "company_access_events" (
	"company_id",
	"user_id",
	"normalized_email",
	"event_type",
	"actor",
	"source"
)
SELECT
	member."company_id",
	member."user_id",
	lower(btrim(auth_user."email")),
	'membership_existing_at_audit_start',
	'system',
	'audit_bootstrap'
FROM "company_members" AS member
INNER JOIN "auth_users" AS auth_user ON auth_user."id" = member."user_id";
