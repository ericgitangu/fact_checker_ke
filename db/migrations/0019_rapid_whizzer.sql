ALTER TYPE "public"."billing_provider" ADD VALUE 'mpesa' BEFORE 'manual';--> statement-breakpoint
CREATE TABLE "pending_checkout_subjects" (
	"provider" "billing_provider" NOT NULL,
	"reference" text NOT NULL,
	"device_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_checkout_subjects_provider_reference_pk" PRIMARY KEY("provider","reference")
);
--> statement-breakpoint
ALTER TABLE "pending_checkout_subjects" ADD CONSTRAINT "pending_checkout_subjects_device_token_hash_device_tokens_token_hash_fk" FOREIGN KEY ("device_token_hash") REFERENCES "public"."device_tokens"("token_hash") ON DELETE cascade ON UPDATE no action;