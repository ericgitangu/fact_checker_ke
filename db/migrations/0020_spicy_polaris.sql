ALTER TABLE "submissions" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "engagement" jsonb;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "virality_score" numeric(12, 4);--> statement-breakpoint
CREATE INDEX "submissions_fetch_trending_idx" ON "submissions" USING btree ("virality_score" DESC NULLS LAST,"created_at" DESC NULLS LAST) WHERE "submissions"."ingest_source" = 'fetch';