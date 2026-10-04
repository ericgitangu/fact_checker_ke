CREATE TYPE "public"."fetch_candidate_status" AS ENUM('pending', 'emitted', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."ingest_source" AS ENUM('submission', 'fetch');--> statement-breakpoint
CREATE TYPE "public"."spend_engine" AS ENUM('fetch', 'submission');--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'fetch.poll.scheduled';--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'fetch.candidate';--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'fetch.observation';--> statement-breakpoint
CREATE TABLE "engine_spend_daily" (
	"engine" "spend_engine" NOT NULL,
	"day" date NOT NULL,
	"usd_spent" numeric(10, 6) DEFAULT '0' NOT NULL,
	"daily_budget_usd" numeric(10, 2) NOT NULL,
	"hard_stopped" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_candidates" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"claim_text" text NOT NULL,
	"score" double precision NOT NULL,
	"status" "fetch_candidate_status" DEFAULT 'pending' NOT NULL,
	"submission_id" uuid,
	"trend_count" integer DEFAULT 1 NOT NULL,
	"platforms_seen" text[] NOT NULL,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"native_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "ingest_source" "ingest_source" DEFAULT 'submission' NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "ingest_source" "ingest_source" DEFAULT 'submission' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "engine_spend_daily_engine_day_idx" ON "engine_spend_daily" USING btree ("engine","day");--> statement-breakpoint
CREATE INDEX "fetch_candidates_status_idx" ON "fetch_candidates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "fetch_observations_platform_native_id_idx" ON "fetch_observations" USING btree ("platform","native_id");--> statement-breakpoint
CREATE INDEX "fetch_observations_content_hash_idx" ON "fetch_observations" USING btree ("content_hash");