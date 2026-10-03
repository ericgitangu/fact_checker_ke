CREATE TYPE "public"."event_type" AS ENUM('submission.received', 'submission.analyzed', 'check.drafted', 'check.failed', 'check.published');--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" uuid PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" "event_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_messages" (
	"message_id" text NOT NULL,
	"handler" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" "event_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("created_at") WHERE "outbox"."published_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_aggregate_idx" ON "outbox" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "processed_messages_message_handler_idx" ON "processed_messages" USING btree ("message_id","handler");--> statement-breakpoint
CREATE INDEX "submission_events_submission_id_idx" ON "submission_events" USING btree ("submission_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_events_event_id_idx" ON "submission_events" USING btree ("event_id");--> statement-breakpoint
-- The column default (`'received'::submission_status`) holds a
-- dependency on the enum type that `DROP TYPE` below refuses to break
-- implicitly (no CASCADE -- we don't want to cascade-drop anything else
-- that might depend on it later). Drop the default before the type
-- swap, then restore it once the new enum exists.
ALTER TABLE "public"."submissions" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."submissions" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
-- ADR-0017 state-machine rename: the pre-ADR-0017 catch-all "processing"
-- value is retired in favour of the two named hops ("analyzing",
-- "analyzed"/"verifying" distinguish which hop is in flight). Any
-- existing row still carrying "processing" is mapped to "analyzing" (the
-- first in-flight hop) so the enum swap below never fails a USING cast
-- against live data -- not just a from-scratch dev DB.
UPDATE "public"."submissions" SET "status" = 'analyzing' WHERE "status" = 'processing';--> statement-breakpoint
DROP TYPE "public"."submission_status";--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('received', 'analyzing', 'analyzed', 'verifying', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "public"."submissions" ALTER COLUMN "status" SET DATA TYPE "public"."submission_status" USING "status"::"public"."submission_status";--> statement-breakpoint
ALTER TABLE "public"."submissions" ALTER COLUMN "status" SET DEFAULT 'received'::"public"."submission_status";