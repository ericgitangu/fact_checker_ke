CREATE TYPE "public"."billing_provider" AS ENUM('paystack', 'stripe', 'manual');--> statement-breakpoint
CREATE TYPE "public"."entitlement_status" AS ENUM('active', 'expired', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."entitlement_tier" AS ENUM('premium');--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_token_hash" text,
	"user_id" uuid,
	"tier" "entitlement_tier" DEFAULT 'premium' NOT NULL,
	"status" "entitlement_status" NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"provider_ref" text,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_one_subject" CHECK (("entitlements"."device_token_hash" IS NOT NULL) <> ("entitlements"."user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_device_token_hash_device_tokens_token_hash_fk" FOREIGN KEY ("device_token_hash") REFERENCES "public"."device_tokens"("token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_provider_event_idx" ON "billing_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "entitlements_device_token_hash_idx" ON "entitlements" USING btree ("device_token_hash");--> statement-breakpoint
CREATE INDEX "entitlements_user_id_idx" ON "entitlements" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_provider_ref_idx" ON "entitlements" USING btree ("provider","provider_ref") WHERE "entitlements"."provider_ref" is not null;