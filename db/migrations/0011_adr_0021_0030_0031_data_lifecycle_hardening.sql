CREATE TABLE "funnel_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"funnel_post_url" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"platform" text NOT NULL,
	"ai_disclosed" boolean NOT NULL,
	"revenue_cents" integer,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funnel_audit_log_posted_after_published" CHECK ("funnel_audit_log"."posted_at" >= "funnel_audit_log"."published_at")
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "device_token_hash" text;--> statement-breakpoint
ALTER TABLE "funnel_audit_log" ADD CONSTRAINT "funnel_audit_log_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_audit_log" ADD CONSTRAINT "funnel_audit_log_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "funnel_audit_log_check_id_idx" ON "funnel_audit_log" USING btree ("check_id");--> statement-breakpoint
CREATE INDEX "submissions_device_token_hash_idx" ON "submissions" USING btree ("device_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "training_eval_labels_check_actor_idx" ON "training_eval_labels" USING btree ("check_id","actor_ref");