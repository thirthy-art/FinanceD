CREATE TABLE "ai_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"mimo_model" varchar(200),
	"mimo_api_key_encrypted" text,
	"openrouter_api_key_encrypted" text,
	"openrouter_fallback_1_model" varchar(200) DEFAULT 'xiaomi/mimo-v2.5' NOT NULL,
	"openrouter_fallback_2_model" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ck_ai_settings_singleton" CHECK ("ai_settings"."id" = 1)
);
