CREATE TYPE "public"."claim_type" AS ENUM('checkable', 'opinion', 'prediction', 'rhetoric');--> statement-breakpoint
CREATE TYPE "public"."credibility_tier" AS ENUM('tier1_primary', 'tier2_established_media', 'tier3_general', 'tier4_unverified');--> statement-breakpoint
CREATE TYPE "public"."demonstration_status" AS ENUM('rumoured', 'announced', 'confirmed', 'ongoing', 'ended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."llm_stage" AS ENUM('normalize', 'transcribe', 'extract', 'retrieve', 'draft');--> statement-breakpoint
CREATE TYPE "public"."rating" AS ENUM('True', 'MostlyTrue', 'Misleading', 'False', 'Unproven', 'NotCheckable');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('received', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."waitlist_source" AS ENUM('site', 'web');--> statement-breakpoint
CREATE TABLE "checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"submission_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"rating" "rating",
	"is_draft" boolean DEFAULT true NOT NULL,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "checks_published_requires_rating" CHECK ("checks"."published_at" is null or "checks"."rating" is not null)
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"check_id" uuid NOT NULL,
	"text" text NOT NULL,
	"claim_type" "claim_type" NOT NULL,
	"span_start" integer,
	"span_end" integer,
	"embedding" vector(384),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credibility_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"domain" text NOT NULL,
	"credibility_tier" "credibility_tier" NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credibility_registry_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "demonstrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"title" text NOT NULL,
	"area" text NOT NULL,
	"county" text NOT NULL,
	"status" "demonstration_status" NOT NULL,
	"date" date,
	"summary" text NOT NULL,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"stage" "llm_stage" NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"publisher" text NOT NULL,
	"credibility_tier" "credibility_tier" NOT NULL,
	"published_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"excerpt" text
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"url" text,
	"text" text,
	"submitted_by" text,
	"status" "submission_status" DEFAULT 'received' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_url_or_text" CHECK (("submissions"."url" is not null and "submissions"."text" is null) or ("submissions"."url" is null and "submissions"."text" is not null))
);
--> statement-breakpoint
CREATE TABLE "waitlist_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"source" "waitlist_source" DEFAULT 'site' NOT NULL,
	"referrer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credibility_registry" ADD CONSTRAINT "credibility_registry_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demonstrations" ADD CONSTRAINT "demonstrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checks_org_id_idx" ON "checks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "checks_submission_id_idx" ON "checks" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "claims_org_id_idx" ON "claims" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "claims_check_id_idx" ON "claims" USING btree ("check_id");--> statement-breakpoint
CREATE INDEX "demonstrations_org_id_idx" ON "demonstrations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "llm_calls_org_id_idx" ON "llm_calls" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "llm_calls_stage_idx" ON "llm_calls" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "sources_org_id_idx" ON "sources" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "submissions_org_id_idx" ON "submissions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_signups_email_idx" ON "waitlist_signups" USING btree ("email");