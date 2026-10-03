CREATE TYPE "public"."risk_tier" AS ENUM('A', 'B', 'C');--> statement-breakpoint
CREATE TYPE "public"."training_label_source" AS ENUM('editor_correction', 'user_agree', 'user_dispute');--> statement-breakpoint
CREATE TABLE "check_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"quote" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"advocate_signoff_ref" text,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_eval_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid,
	"claim_id" uuid,
	"source" "training_label_source" NOT NULL,
	"actor_ref" text NOT NULL,
	"label" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "calibrated_confidence" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "what_would_change_this" text;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "risk_tier" "risk_tier";--> statement-breakpoint
ALTER TABLE "check_evidence" ADD CONSTRAINT "check_evidence_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_evidence" ADD CONSTRAINT "check_evidence_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_flags" ADD CONSTRAINT "policy_flags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_eval_labels" ADD CONSTRAINT "training_eval_labels_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_eval_labels" ADD CONSTRAINT "training_eval_labels_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_evidence_check_id_idx" ON "check_evidence" USING btree ("check_id");--> statement-breakpoint
CREATE INDEX "training_eval_labels_check_id_idx" ON "training_eval_labels" USING btree ("check_id");--> statement-breakpoint
CREATE INDEX "training_eval_labels_source_idx" ON "training_eval_labels" USING btree ("source");