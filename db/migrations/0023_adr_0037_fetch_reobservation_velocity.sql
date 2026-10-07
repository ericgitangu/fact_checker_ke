DROP INDEX "fetch_observations_platform_native_id_idx";--> statement-breakpoint
ALTER TABLE "fetch_observations" ADD COLUMN "engagement" jsonb;--> statement-breakpoint
CREATE INDEX "fetch_observations_platform_native_id_idx" ON "fetch_observations" USING btree ("platform","native_id","observed_at");
--> statement-breakpoint
-- ADR-0037 ROLLBACK (down) — drizzle migrations are up-only, so this is the
-- manual reverse, kept here as the project's documented convention. Run it
-- BY HAND only; it is NOT auto-applied.
--
-- WARNING: re-adding the UNIQUE index is NOT safe on its own once the
-- FETCH_VELOCITY_REOBSERVE path has written more than one observation per
-- (platform, native_id) — those are the very duplicate rows this migration
-- exists to allow, and a bare CREATE UNIQUE INDEX will fail with a
-- "could not create unique index ... duplicate key" error. You MUST collapse
-- the history down to one row per item FIRST (keeping the most recent):
--
--   DROP INDEX "fetch_observations_platform_native_id_idx";
--   DELETE FROM "fetch_observations" a
--     USING "fetch_observations" b
--     WHERE a.platform = b.platform
--       AND a.native_id = b.native_id
--       AND (a.observed_at < b.observed_at
--            OR (a.observed_at = b.observed_at AND a.id < b.id));
--   ALTER TABLE "fetch_observations" DROP COLUMN "engagement";
--   CREATE UNIQUE INDEX "fetch_observations_platform_native_id_idx"
--     ON "fetch_observations" USING btree ("platform","native_id");