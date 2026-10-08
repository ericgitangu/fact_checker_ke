CREATE TYPE "public"."claim_source_status" AS ENUM('pending', 'accepted', 'rejected', 'duplicate');--> statement-breakpoint
CREATE TABLE "claim_source_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"url" text NOT NULL,
	"note" text,
	"submitter_device_hash" text NOT NULL,
	"status" "claim_source_status" DEFAULT 'pending' NOT NULL,
	"credibility_tier" "credibility_tier",
	"resolved_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "claim_source_submissions" ADD CONSTRAINT "claim_source_submissions_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_source_submissions_check_id_status_idx" ON "claim_source_submissions" USING btree ("check_id","status");--> statement-breakpoint
CREATE INDEX "claim_source_submissions_check_url_idx" ON "claim_source_submissions" USING btree ("check_id","url");