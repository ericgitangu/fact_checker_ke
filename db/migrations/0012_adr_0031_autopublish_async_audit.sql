CREATE TYPE "public"."async_audit_outcome" AS ENUM('pending', 'confirmed', 'error_found');--> statement-breakpoint
CREATE TABLE "async_audit_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"tier" "risk_tier" NOT NULL,
	"publish_mode" text NOT NULL,
	"sample_rate_at_queue_time" double precision NOT NULL,
	"outcome" "async_audit_outcome" DEFAULT 'pending' NOT NULL,
	"audited_by" uuid,
	"audited_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "async_audit_queue" ADD CONSTRAINT "async_audit_queue_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "async_audit_queue" ADD CONSTRAINT "async_audit_queue_audited_by_users_id_fk" FOREIGN KEY ("audited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "async_audit_queue_check_id_idx" ON "async_audit_queue" USING btree ("check_id");--> statement-breakpoint
CREATE INDEX "async_audit_queue_outcome_idx" ON "async_audit_queue" USING btree ("outcome");