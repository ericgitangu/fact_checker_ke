CREATE TYPE "public"."check_lifecycle" AS ENUM('verifying', 'preliminary', 'awaiting_sources', 'editor_review', 'published', 'dismissed', 'archived_expired');--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "lifecycle_state" "check_lifecycle";--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "source_kind" text;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "authoritative" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "checks_lifecycle_state_idx" ON "checks" USING btree ("lifecycle_state","last_activity_at");--> statement-breakpoint
-- ADR-0038 backfill: populate the new editorial track for every existing row so
-- the column is valid immediately and the feed can read lifecycle_state. isDraft/
-- publishedAt remain the authoritative publish gate; this only derives the
-- orthogonal lifecycle from (isDraft, publishedAt, submission.status).
--   published (isDraft=false ∧ publishedAt set) -> published
--   submission failed                            -> dismissed
--   submission ready + still a draft             -> awaiting_sources (open thread)
--   otherwise (still processing)                 -> verifying
-- last_activity_at seeds the expiry clock from publishedAt (if any) else created_at.
UPDATE "checks" c SET
  "lifecycle_state" = CASE
    WHEN c."is_draft" = false AND c."published_at" IS NOT NULL THEN 'published'::"public"."check_lifecycle"
    WHEN s."status" = 'failed' THEN 'dismissed'::"public"."check_lifecycle"
    WHEN s."status" = 'ready' THEN 'awaiting_sources'::"public"."check_lifecycle"
    ELSE 'verifying'::"public"."check_lifecycle"
  END,
  "last_activity_at" = COALESCE(c."published_at", c."created_at")
FROM "submissions" s
WHERE c."submission_id" = s."id" AND c."lifecycle_state" IS NULL;
